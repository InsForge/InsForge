package insforge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// httpClient wraps net/http.Client with InsForge-specific behaviour.
type httpClient struct {
	baseURL     string
	anonKey     string
	accessToken string
	mu          sync.RWMutex
	headers     map[string]string
	client      *http.Client
}

func newHTTPClient(baseURL, anonKey string, headers map[string]string) *httpClient {
	return &httpClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		anonKey: anonKey,
		headers: headers,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *httpClient) setAccessToken(token string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.accessToken = token
}

func (c *httpClient) authToken() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.accessToken != "" {
		return c.accessToken
	}
	return c.anonKey
}

func (c *httpClient) buildRequest(ctx context.Context, method, path string, body interface{}, extraHeaders map[string]string) (*http.Request, error) {
	fullURL := c.baseURL + path
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, fullURL, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	if token := c.authToken(); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range c.headers {
		req.Header.Set(k, v)
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}
	return req, nil
}

func (c *httpClient) do(req *http.Request) (interface{}, error) {
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, &InsForgeError{Message: err.Error(), StatusCode: 0}
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, &InsForgeError{Message: "failed to read response body", StatusCode: resp.StatusCode}
	}

	if resp.StatusCode == 204 || len(raw) == 0 {
		return nil, nil
	}

	var parsed interface{}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, &InsForgeError{Message: string(raw), StatusCode: resp.StatusCode}
	}

	if resp.StatusCode >= 400 {
		if m, ok := parsed.(map[string]interface{}); ok {
			return nil, errorFromBody(m, resp.StatusCode)
		}
		return nil, &InsForgeError{Message: string(raw), StatusCode: resp.StatusCode}
	}
	return parsed, nil
}

func (c *httpClient) get(ctx context.Context, path string, params url.Values, extraHeaders map[string]string) (interface{}, error) {
	fullPath := path
	if len(params) > 0 {
		fullPath += "?" + params.Encode()
	}
	req, err := c.buildRequest(ctx, http.MethodGet, fullPath, nil, extraHeaders)
	if err != nil {
		return nil, err
	}
	return c.do(req)
}

func (c *httpClient) post(ctx context.Context, path string, body interface{}, extraHeaders map[string]string) (interface{}, error) {
	req, err := c.buildRequest(ctx, http.MethodPost, path, body, extraHeaders)
	if err != nil {
		return nil, err
	}
	return c.do(req)
}

func (c *httpClient) put(ctx context.Context, path string, body interface{}, extraHeaders map[string]string) (interface{}, error) {
	req, err := c.buildRequest(ctx, http.MethodPut, path, body, extraHeaders)
	if err != nil {
		return nil, err
	}
	return c.do(req)
}

func (c *httpClient) patch(ctx context.Context, path string, body interface{}, extraHeaders map[string]string) (interface{}, error) {
	req, err := c.buildRequest(ctx, http.MethodPatch, path, body, extraHeaders)
	if err != nil {
		return nil, err
	}
	return c.do(req)
}

func (c *httpClient) delete(ctx context.Context, path string, params url.Values, extraHeaders map[string]string) (interface{}, error) {
	fullPath := path
	if len(params) > 0 {
		fullPath += "?" + params.Encode()
	}
	req, err := c.buildRequest(ctx, http.MethodDelete, fullPath, nil, extraHeaders)
	if err != nil {
		return nil, err
	}
	return c.do(req)
}

func (c *httpClient) uploadRaw(ctx context.Context, path string, data []byte, contentType string) (interface{}, error) {
	fullURL := c.baseURL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, fullURL, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	if token := c.authToken(); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range c.headers {
		req.Header.Set(k, v)
	}
	return c.do(req)
}

func (c *httpClient) downloadBytes(ctx context.Context, path string) ([]byte, error) {
	fullURL := c.baseURL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
	if err != nil {
		return nil, err
	}
	if token := c.authToken(); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range c.headers {
		req.Header.Set(k, v)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, &InsForgeError{Message: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, &InsForgeError{StatusCode: resp.StatusCode, Message: "download failed"}
	}
	return io.ReadAll(resp.Body)
}
