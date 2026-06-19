package insforge

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ConnectionState represents the current state of the realtime connection.
type ConnectionState string

const (
	ConnectionStateDisconnected ConnectionState = "disconnected"
	ConnectionStateConnecting   ConnectionState = "connecting"
	ConnectionStateConnected    ConnectionState = "connected"
)

// RealtimeMessage is a message received from a channel.
type RealtimeMessage struct {
	Channel string
	Payload any
}

// EventHandler is a callback invoked when a message arrives on a channel.
type EventHandler func(msg RealtimeMessage)

// realtimeEnvelope is the wire format for realtime messages.
type realtimeEnvelope struct {
	Type    string `json:"type"`
	Channel string `json:"channel,omitempty"`
	Payload any    `json:"payload,omitempty"`
}

// RealtimeClient provides real-time pub/sub via WebSocket.
type RealtimeClient struct {
	http         *httpClient
	mu           sync.RWMutex
	conn         *websocket.Conn
	state        ConnectionState
	socketID     string
	handlers     map[string][]EventHandler
	onceHandlers map[string][]EventHandler
	subscriptions map[string]bool
	stopCh       chan struct{}
}

func newRealtimeClient(h *httpClient) *RealtimeClient {
	return &RealtimeClient{
		http:          h,
		state:         ConnectionStateDisconnected,
		handlers:      make(map[string][]EventHandler),
		onceHandlers:  make(map[string][]EventHandler),
		subscriptions: make(map[string]bool),
	}
}

// Connect establishes the WebSocket connection to the InsForge realtime server.
func (r *RealtimeClient) Connect() error {
	r.mu.Lock()
	r.state = ConnectionStateConnecting
	r.mu.Unlock()

	// Construct WebSocket URL from base URL
	wsURL := r.http.baseURL
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)
	wsURL += "/realtime/websocket"

	// Add auth token as query param
	u, err := url.Parse(wsURL)
	if err != nil {
		r.mu.Lock()
		r.state = ConnectionStateDisconnected
		r.mu.Unlock()
		return fmt.Errorf("insforge: realtime: parse URL: %w", err)
	}
	q := u.Query()
	q.Set("token", r.http.bearerToken())
	u.RawQuery = q.Encode()

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
		Subprotocols:     []string{"insforge-realtime"},
	}
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+r.http.bearerToken())

	conn, _, err := dialer.Dial(u.String(), headers)
	if err != nil {
		r.mu.Lock()
		r.state = ConnectionStateDisconnected
		r.mu.Unlock()
		return fmt.Errorf("insforge: realtime: dial: %w", err)
	}

	stopCh := make(chan struct{})
	r.mu.Lock()
	r.conn = conn
	r.state = ConnectionStateConnected
	r.stopCh = stopCh
	r.mu.Unlock()

	go r.readLoop(conn, stopCh)
	return nil
}

// readLoop processes incoming WebSocket messages.
func (r *RealtimeClient) readLoop(conn *websocket.Conn, stopCh chan struct{}) {
	defer func() {
		r.mu.Lock()
		r.state = ConnectionStateDisconnected
		r.conn = nil
		r.socketID = ""
		r.stopCh = nil
		r.mu.Unlock()
	}()

	for {
		select {
		case <-stopCh:
			return
		default:
		}

		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var env realtimeEnvelope
		if err := json.Unmarshal(data, &env); err != nil {
			continue
		}

		switch env.Type {
		case "connected":
			if sid, ok := env.Payload.(map[string]any); ok {
				if id, ok := sid["socketId"].(string); ok {
					r.mu.Lock()
					r.socketID = id
					r.mu.Unlock()
				}
			}
		case "message":
			if env.Channel != "" {
				r.dispatch(env.Channel, RealtimeMessage{
					Channel: env.Channel,
					Payload: env.Payload,
				})
			}
		}
	}
}

// Disconnect closes the WebSocket connection.
func (r *RealtimeClient) Disconnect() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopCh != nil {
		close(r.stopCh)
		r.stopCh = nil
	}
	if r.conn != nil {
		_ = r.conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		r.conn.Close()
		r.conn = nil
	}
	r.state = ConnectionStateDisconnected
}

// Subscribe subscribes to a channel and registers a handler.
func (r *RealtimeClient) Subscribe(channel string, handler EventHandler) error {
	r.mu.Lock()
	r.handlers[channel] = append(r.handlers[channel], handler)
	alreadySubscribed := r.subscriptions[channel]
	r.subscriptions[channel] = true
	conn := r.conn
	r.mu.Unlock()

	if !alreadySubscribed && conn != nil {
		msg, _ := json.Marshal(realtimeEnvelope{Type: "subscribe", Channel: channel})
		return conn.WriteMessage(websocket.TextMessage, msg)
	}
	return nil
}

// Unsubscribe removes all handlers for a channel.
func (r *RealtimeClient) Unsubscribe(channel string) error {
	r.mu.Lock()
	delete(r.handlers, channel)
	delete(r.onceHandlers, channel)
	delete(r.subscriptions, channel)
	conn := r.conn
	r.mu.Unlock()

	if conn != nil {
		msg, _ := json.Marshal(realtimeEnvelope{Type: "unsubscribe", Channel: channel})
		return conn.WriteMessage(websocket.TextMessage, msg)
	}
	return nil
}

// Publish sends a message to a channel.
func (r *RealtimeClient) Publish(channel string, payload any) error {
	r.mu.RLock()
	conn := r.conn
	r.mu.RUnlock()

	if conn == nil {
		return &InsForgeError{Message: "realtime: not connected"}
	}
	msg, err := json.Marshal(realtimeEnvelope{Type: "publish", Channel: channel, Payload: payload})
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, msg)
}

// On registers a persistent handler for a channel.
func (r *RealtimeClient) On(channel string, handler EventHandler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.handlers[channel] = append(r.handlers[channel], handler)
}

// Off removes all persistent handlers for a channel.
func (r *RealtimeClient) Off(channel string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.handlers, channel)
}

// Once registers a one-time handler for a channel.
func (r *RealtimeClient) Once(channel string, handler EventHandler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.onceHandlers[channel] = append(r.onceHandlers[channel], handler)
}

// IsConnected returns true when the client is connected.
func (r *RealtimeClient) IsConnected() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.state == ConnectionStateConnected
}

// ConnectionStateValue returns the current connection state.
func (r *RealtimeClient) ConnectionStateValue() ConnectionState {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.state
}

// SocketID returns the server-assigned socket ID (available after Connect).
func (r *RealtimeClient) SocketID() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.socketID
}

// GetSubscribedChannels returns the names of currently subscribed channels.
func (r *RealtimeClient) GetSubscribedChannels() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	channels := make([]string, 0, len(r.subscriptions))
	for ch := range r.subscriptions {
		channels = append(channels, ch)
	}
	return channels
}

func (r *RealtimeClient) dispatch(channel string, msg RealtimeMessage) {
	r.mu.Lock()
	persistent := append([]EventHandler(nil), r.handlers[channel]...)
	once := r.onceHandlers[channel]
	delete(r.onceHandlers, channel)
	r.mu.Unlock()

	for _, h := range persistent {
		go h(msg)
	}
	for _, h := range once {
		go h(msg)
	}
}
