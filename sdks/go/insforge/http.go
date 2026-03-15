package insforge

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"
)

// InsForgeError is returned when the InsForge API responds with an error.
type InsForgeError struct {
	Message    string `json:"message"`
	StatusCode int    `json:"statusCode"`
	ErrorCode  string `json:"error"`
	NextActions string `json:"nextActions"`
}

func (e *InsForgeError) Error() string {
	if e.ErrorCode != "" {
		return fmt.Sprintf("insforge: [%s] %s (HTTP %d)", e.ErrorCode, e.Message, e.StatusCode)
	}
	return fmt.Sprintf("insforge: %s (HTTP %d)", e.Message, e.StatusCode)
}

// sessionState holds the in-memory auth tokens. Thread-safe.
type sessionState struct {
	mu           sync.RWMutex
	accessToken  string
	refreshToken string
	csrfToken    string
	user         map[string]any
}

func (s *sessionState) setTokens(access, refresh, csrf string, user map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if access != "" {
		s.accessToken = access
	}
	if refresh != "" {
		s.refreshToken = refresh
	}
	if csrf != "" {
		s.csrfToken = csrf
	}
	if user != nil {
		s.user = user
	}
}

func (s *sessionState) clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.accessToken = ""
	s.refreshToken = ""
	s.csrfToken = ""
	s.user = nil
}

func (s *sessionState) getAccessToken() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.accessToken
}

func (s *sessionState) getRefreshToken() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.refreshToken
}

// httpClient is the low-level HTTP transport used by all SDK modules.
type httpClient struct {
	baseURL string
	anonKey string
	timeout time.Duration
	state   *sessionState
	client  *http.Client
}

func newHTTPClient(baseURL, anonKey, edgeFunctionToken string, timeoutSecs int) *httpClient {
	state := &sessionState{}
	if edgeFunctionToken != "" {
		state.accessToken = edgeFunctionToken
	}
	return &httpClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		anonKey: anonKey,
		timeout: time.Duration(timeoutSecs) * time.Second,
		state:   state,
		client:  &http.Client{Timeout: time.Duration(timeoutSecs) * time.Second},
	}
}

func (h *httpClient) bearerToken() string {
	if t := h.state.getAccessToken(); t != "" {
		return t
	}
	return h.anonKey
}

func (h *httpClient) buildURL(p string) string {
	base, _ := url.Parse(h.baseURL)
	base.Path = path.Join(base.Path, p)
	return base.String()
}

func (h *httpClient) newRequest(method, urlStr string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequest(method, urlStr, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+h.bearerToken())
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func (h *httpClient) parseError(resp *http.Response) error {
	var apiErr InsForgeError
	body, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(body, &apiErr); err != nil {
		apiErr.Message = string(body)
	}
	apiErr.StatusCode = resp.StatusCode
	return &apiErr
}

// do executes a request, checks for errors, and decodes the response into out.
// Pass nil for out to discard the response body.
func (h *httpClient) do(method, p string, reqBody any, queryParams url.Values, out any, extraHeaders map[string]string) error {
	var bodyReader io.Reader
	if reqBody != nil {
		b, err := json.Marshal(reqBody)
		if err != nil {
			return fmt.Errorf("insforge: marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	urlStr := h.buildURL(p)
	if len(queryParams) > 0 {
		urlStr += "?" + queryParams.Encode()
	}

	req, err := h.newRequest(method, urlStr, bodyReader)
	if err != nil {
		return err
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return fmt.Errorf("insforge: http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return h.parseError(resp)
	}

	if out == nil {
		return nil
	}
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("insforge: read response: %w", err)
	}
	if len(respBody) == 0 {
		return nil
	}
	return json.Unmarshal(respBody, out)
}

// doRaw executes a request and returns the raw response body bytes.
func (h *httpClient) doRaw(method, p string, reqBody any, queryParams url.Values, extraHeaders map[string]string) ([]byte, error) {
	var bodyReader io.Reader
	if reqBody != nil {
		b, err := json.Marshal(reqBody)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(b)
	}

	urlStr := h.buildURL(p)
	if len(queryParams) > 0 {
		urlStr += "?" + queryParams.Encode()
	}

	req, err := h.newRequest(method, urlStr, bodyReader)
	if err != nil {
		return nil, err
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, h.parseError(resp)
	}
	return io.ReadAll(resp.Body)
}

// doStream executes a request and returns the response body as a streaming reader.
// The caller is responsible for closing the reader.
func (h *httpClient) doStream(method, p string, reqBody any) (io.ReadCloser, error) {
	var bodyReader io.Reader
	if reqBody != nil {
		b, err := json.Marshal(reqBody)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := h.newRequest(method, h.buildURL(p), bodyReader)
	if err != nil {
		return nil, err
	}

	// Use a client without timeout for streaming
	streamClient := &http.Client{}
	resp, err := streamClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		defer resp.Body.Close()
		return nil, h.parseError(resp)
	}
	return resp.Body, nil
}

// doMultipart performs a multipart/form-data POST to an InsForge path.
func (h *httpClient) doMultipart(p string, fields map[string]string, fileField, filename string, fileContent []byte, contentType string, out any) error {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	for k, v := range fields {
		_ = w.WriteField(k, v)
	}

	if fileField != "" {
		fw, err := w.CreateFormFile(fileField, filename)
		if err != nil {
			return err
		}
		if _, err = fw.Write(fileContent); err != nil {
			return err
		}
	}
	w.Close()

	req, err := http.NewRequest(http.MethodPost, h.buildURL(p), &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+h.bearerToken())
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := h.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return h.parseError(resp)
	}
	if out == nil {
		return nil
	}
	respBody, _ := io.ReadAll(resp.Body)
	if len(respBody) == 0 {
		return nil
	}
	return json.Unmarshal(respBody, out)
}

// doPutExternal PUTs raw bytes to an external URL (e.g., presigned S3).
func (h *httpClient) doPutExternal(externalURL string, data []byte, contentType string) error {
	req, err := http.NewRequest(http.MethodPut, externalURL, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	resp, err := h.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("insforge: external upload failed (HTTP %d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// doPostExternal POSTs multipart form data to an external URL (presigned S3 POST).
func (h *httpClient) doPostExternal(externalURL string, fields map[string]string, fileKey, filename string, fileData []byte, contentType string) error {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	fw, err := w.CreateFormFile(fileKey, filename)
	if err != nil {
		return err
	}
	if _, err = fw.Write(fileData); err != nil {
		return err
	}
	w.Close()

	req, err := http.NewRequest(http.MethodPost, externalURL, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := h.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("insforge: external upload failed (HTTP %d): %s", resp.StatusCode, string(body))
	}
	return nil
}
