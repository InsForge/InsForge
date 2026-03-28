package insforge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	eioOpen    = "0"
	eioMessage = "4"
	sioConnect = "0"
	sioEvent   = "2"
	sioAck     = "3"
)

// EventCallback is the function signature for realtime event handlers.
type EventCallback func(data interface{})

// Realtime provides real-time pub/sub via Socket.IO/WebSocket.
type Realtime struct {
	http        *httpClient
	conn        *websocket.Conn
	mu          sync.RWMutex
	writeMu     sync.Mutex // protects WebSocket writes
	listeners   map[string][]EventCallback
	subscribed  map[string]struct{}
	connected   bool
	sid         string
	ackID       int
	pendingAcks map[int]chan interface{}
}

func newRealtime(h *httpClient) *Realtime {
	return &Realtime{
		http:        h,
		listeners:   make(map[string][]EventCallback),
		subscribed:  make(map[string]struct{}),
		pendingAcks: make(map[int]chan interface{}),
	}
}

// IsConnected reports whether the realtime connection is active.
func (r *Realtime) IsConnected() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.connected
}

// ConnectionState returns the current connection state: "connected", "connecting", or "disconnected".
func (r *Realtime) ConnectionState() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.connected {
		return "connected"
	}
	if r.conn != nil {
		return "connecting"
	}
	return "disconnected"
}

// SocketID returns the Socket.IO session ID if connected.
func (r *Realtime) SocketID() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.sid
}

// GetSubscribedChannels returns the list of currently subscribed channels.
func (r *Realtime) GetSubscribedChannels() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.subscribed))
	for ch := range r.subscribed {
		out = append(out, ch)
	}
	return out
}

// Connect opens a WebSocket connection to the realtime server.
func (r *Realtime) Connect(ctx context.Context) error {
	base := r.http.baseURL
	wsBase := strings.Replace(strings.Replace(base, "https://", "wss://", 1), "http://", "ws://", 1)
	rawURL := fmt.Sprintf("%s/socket.io/?EIO=4&transport=websocket", wsBase)

	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	header := http.Header{}
	conn, _, err := dialer.DialContext(ctx, rawURL, header)
	if err != nil {
		return &InsForgeError{Message: "websocket connect failed: " + err.Error()}
	}
	r.conn = conn

	// Read EIO OPEN packet
	_, _, err = conn.ReadMessage()
	if err != nil {
		return &InsForgeError{Message: "failed to read EIO open: " + err.Error()}
	}

	// Send SIO CONNECT with auth payload (backend reads socket.handshake.auth.token)
	token := r.http.authToken()
	connectMsg := eioMessage + sioConnect
	if token != "" {
		authPayload, _ := json.Marshal(map[string]string{"token": token})
		connectMsg += string(authPayload)
	}
	r.writeMu.Lock()
	writeErr := conn.WriteMessage(websocket.TextMessage, []byte(connectMsg))
	r.writeMu.Unlock()
	if writeErr != nil {
		return &InsForgeError{Message: "failed to send SIO connect: " + writeErr.Error()}
	}

	r.mu.Lock()
	r.connected = true
	r.mu.Unlock()

	go r.recvLoop()
	return nil
}

// Disconnect closes the WebSocket connection.
func (r *Realtime) Disconnect() error {
	r.mu.Lock()
	r.connected = false
	r.mu.Unlock()
	if r.conn != nil {
		return r.conn.Close()
	}
	return nil
}

// Subscribe subscribes to a channel.
func (r *Realtime) Subscribe(ctx context.Context, channel string) (map[string]interface{}, error) {
	if !r.IsConnected() {
		if err := r.Connect(ctx); err != nil {
			return nil, err
		}
	}

	r.mu.Lock()
	r.ackID++
	id := r.ackID
	ch := make(chan interface{}, 1)
	r.pendingAcks[id] = ch
	r.mu.Unlock()

	payload, _ := json.Marshal([]interface{}{"realtime:subscribe", map[string]interface{}{"channel": channel}})
	msg := fmt.Sprintf("%s%s%d%s", eioMessage, sioEvent, id, string(payload))
	r.writeMu.Lock()
	err := r.conn.WriteMessage(websocket.TextMessage, []byte(msg))
	r.writeMu.Unlock()
	if err != nil {
		return nil, &InsForgeError{Message: "subscribe write failed: " + err.Error()}
	}

	select {
	case result := <-ch:
		m, _ := result.(map[string]interface{})
		if ok, _ := m["ok"].(bool); ok {
			r.mu.Lock()
			r.subscribed[channel] = struct{}{}
			r.mu.Unlock()
		}
		return m, nil
	case <-time.After(10 * time.Second):
		return map[string]interface{}{"ok": false, "channel": channel}, &InsForgeError{Message: "subscribe timeout"}
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Unsubscribe unsubscribes from a channel.
func (r *Realtime) Unsubscribe(channel string) error {
	payload, _ := json.Marshal([]interface{}{"realtime:unsubscribe", map[string]interface{}{"channel": channel}})
	msg := fmt.Sprintf("%s%s%s", eioMessage, sioEvent, string(payload))
	r.writeMu.Lock()
	err := r.conn.WriteMessage(websocket.TextMessage, []byte(msg))
	r.writeMu.Unlock()
	if err != nil {
		return err
	}
	r.mu.Lock()
	delete(r.subscribed, channel)
	r.mu.Unlock()
	return nil
}

// Publish publishes an event to a channel.
func (r *Realtime) Publish(ctx context.Context, channel, event string, payload interface{}) error {
	if !r.IsConnected() {
		if err := r.Connect(ctx); err != nil {
			return err
		}
	}
	data, _ := json.Marshal([]interface{}{"realtime:publish", map[string]interface{}{
		"channel": channel, "event": event, "payload": payload,
	}})
	r.writeMu.Lock()
	err := r.conn.WriteMessage(websocket.TextMessage, []byte(eioMessage+sioEvent+string(data)))
	r.writeMu.Unlock()
	return err
}

// On registers a handler for the given event.
func (r *Realtime) On(event string, cb EventCallback) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.listeners[event] = append(r.listeners[event], cb)
}

// Off removes all handlers for the given event.
func (r *Realtime) Off(event string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.listeners, event)
}

// Once registers a one-time handler that is removed after it fires once.
func (r *Realtime) Once(event string, cb EventCallback) {
	var wrapper EventCallback
	wrapper = func(data interface{}) {
		cb(data)
		r.Off(event)
	}
	r.On(event, wrapper)
}

func (r *Realtime) emit(event string, data interface{}) {
	r.mu.RLock()
	cbs := append([]EventCallback{}, r.listeners[event]...)
	r.mu.RUnlock()
	for _, cb := range cbs {
		cb(data)
	}
}

func (r *Realtime) recvLoop() {
	for {
		_, raw, err := r.conn.ReadMessage()
		if err != nil {
			r.mu.Lock()
			r.connected = false
			r.mu.Unlock()
			r.emit("disconnect", err.Error())
			return
		}
		r.handleMessage(string(raw))
	}
}

func (r *Realtime) handleMessage(raw string) {
	if len(raw) < 2 {
		return
	}
	if string(raw[0]) != eioMessage {
		return
	}
	sio := raw[1:]
	if len(sio) == 0 {
		return
	}
	sioType := string(sio[0])
	rest := sio[1:]

	switch sioType {
	case sioConnect:
		var info map[string]interface{}
		if err := json.Unmarshal([]byte(rest), &info); err == nil {
			if sid, ok := info["sid"].(string); ok {
				r.mu.Lock()
				r.sid = sid
				r.mu.Unlock()
			}
		}
		r.emit("connect", nil)

	case sioEvent:
		ackID, dataStr := parseAckAndData(rest)
		var arr []interface{}
		if err := json.Unmarshal([]byte(dataStr), &arr); err != nil || len(arr) == 0 {
			return
		}
		_ = ackID
		eventName, _ := arr[0].(string)
		var eventData interface{}
		if len(arr) > 1 {
			eventData = arr[1]
		}
		r.emit(eventName, eventData)

	case sioAck:
		ackID, dataStr := parseAckAndData(rest)
		var arr []interface{}
		json.Unmarshal([]byte(dataStr), &arr)
		var result interface{}
		if len(arr) > 0 {
			result = arr[0]
		}
		r.mu.Lock()
		ch, ok := r.pendingAcks[ackID]
		if ok {
			delete(r.pendingAcks, ackID)
		}
		r.mu.Unlock()
		if ok && ch != nil {
			ch <- result
		}
	}
}

func parseAckAndData(s string) (int, string) {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i == 0 {
		return -1, s
	}
	id := 0
	for j := 0; j < i; j++ {
		id = id*10 + int(s[j]-'0')
	}
	return id, s[i:]
}
