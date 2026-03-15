package insforge

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// FunctionsClient invokes InsForge serverless functions.
type FunctionsClient struct {
	http *httpClient
}

func newFunctionsClient(h *httpClient) *FunctionsClient {
	return &FunctionsClient{http: h}
}

// InvokeOptions configures a function invocation.
type InvokeOptions struct {
	// Method is the HTTP method: GET, POST, PUT, PATCH, DELETE. Defaults to POST.
	Method string
	// Headers are extra HTTP headers to send with the request.
	Headers map[string]string
	// Body is the JSON-serializable request body (for POST/PUT/PATCH).
	Body any
}

// InvokeResult holds the raw response from the function.
type InvokeResult struct {
	// Data contains the parsed JSON response (if JSON).
	Data any
	// RawBody contains the raw response bytes.
	RawBody []byte
	// StatusCode is the HTTP status code returned by the function.
	StatusCode int
}

// Invoke calls the serverless function identified by slug.
// Pass nil options to use defaults (POST with no body).
func (f *FunctionsClient) Invoke(slug string, opts *InvokeOptions) (*InvokeResult, error) {
	method := "POST"
	var headers map[string]string
	var body any

	if opts != nil {
		if opts.Method != "" {
			method = opts.Method
		}
		headers = opts.Headers
		body = opts.Body
	}

	// Functions live at /functions/{slug} (no /api/ prefix)
	urlStr := f.http.buildURL("/functions/" + slug)

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("insforge: marshal function body: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequest(method, urlStr, bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+f.http.bearerToken())
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := f.http.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("insforge: functions: %w", err)
	}
	defer resp.Body.Close()

	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("insforge: functions: read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		var apiErr InsForgeError
		if jsonErr := json.Unmarshal(rawBody, &apiErr); jsonErr != nil {
			apiErr.Message = string(rawBody)
		}
		apiErr.StatusCode = resp.StatusCode
		return nil, &apiErr
	}

	result := &InvokeResult{
		RawBody:    rawBody,
		StatusCode: resp.StatusCode,
	}

	// Attempt JSON parse for convenience
	if len(rawBody) > 0 {
		var parsed any
		if err := json.Unmarshal(rawBody, &parsed); err == nil {
			result.Data = parsed
		}
	}

	return result, nil
}
