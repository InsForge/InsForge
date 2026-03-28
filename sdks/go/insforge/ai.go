package insforge

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// AI provides AI-related operations: chat, embeddings, images.
type AI struct {
	Chat       *ChatClient
	Embeddings *EmbeddingsClient
	Images     *ImagesClient
	http       *httpClient
}

func newAI(h *httpClient) *AI {
	cc := &ChatCompletionsClient{http: h}
	return &AI{
		Chat:       &ChatClient{Completions: cc},
		Embeddings: &EmbeddingsClient{http: h},
		Images:     &ImagesClient{http: h},
		http:       h,
	}
}

// ListModels returns the list of available AI models.
func (a *AI) ListModels(ctx context.Context) Result[interface{}] {
	raw, err := a.http.get(ctx, "/api/ai/models", nil, nil)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}

// ------------------------------------------------------------------ //
// Chat
// ------------------------------------------------------------------ //

// ChatClient exposes chat completions.
type ChatClient struct {
	Completions *ChatCompletionsClient
}

// ChatCompletionsClient creates chat completions.
type ChatCompletionsClient struct {
	http *httpClient
}

// Create sends a chat completion request. Returns *ChatCompletionResponse for
// non-streaming requests. For streaming, use CreateStream.
func (c *ChatCompletionsClient) Create(ctx context.Context, req ChatCompletionRequest) Result[*ChatCompletionResponse] {
	req.Stream = false
	raw, err := c.http.post(ctx, "/api/ai/chat/completion", req, nil)
	if err != nil {
		return fail[*ChatCompletionResponse](err)
	}
	resp, decErr := decode[ChatCompletionResponse](raw)
	if decErr != nil {
		return fail[*ChatCompletionResponse](decErr)
	}
	return ok(&resp)
}

// StreamChunk is a single server-sent event chunk during streaming.
type StreamChunk struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index  int `json:"index"`
		Delta  struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

// CreateStream sends a streaming chat completion request.
// The returned channel emits chunks until the stream ends (or an error occurs).
// The error channel receives at most one error, then is closed.
func (c *ChatCompletionsClient) CreateStream(ctx context.Context, req ChatCompletionRequest) (<-chan StreamChunk, <-chan error) {
	chunks := make(chan StreamChunk)
	errs := make(chan error, 1)

	req.Stream = true

	go func() {
		defer close(chunks)
		defer close(errs)

		b, err := json.Marshal(req)
		if err != nil {
			errs <- err
			return
		}
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
			c.http.baseURL+"/api/ai/chat/completion",
			bytes.NewReader(b),
		)
		if err != nil {
			errs <- err
			return
		}
		httpReq.Header.Set("Content-Type", "application/json")
		if token := c.http.authToken(); token != "" {
			httpReq.Header.Set("Authorization", "Bearer "+token)
		}

		resp, err := c.http.client.Do(httpReq)
		if err != nil {
			errs <- err
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 400 {
			raw, _ := io.ReadAll(resp.Body)
			var body map[string]interface{}
			json.Unmarshal(raw, &body)
			if body != nil {
				errs <- errorFromBody(body, resp.StatusCode)
			} else {
				errs <- fmt.Errorf("stream error: %d", resp.StatusCode)
			}
			return
		}

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			payload := strings.TrimPrefix(line, "data: ")
			if payload == "[DONE]" {
				return
			}
			var chunk StreamChunk
			if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
				continue
			}
			select {
			case chunks <- chunk:
			case <-ctx.Done():
				return
			}
		}
		if err := scanner.Err(); err != nil {
			errs <- err
		}
	}()

	return chunks, errs
}

// ------------------------------------------------------------------ //
// Embeddings
// ------------------------------------------------------------------ //

// EmbeddingsClient creates text embeddings.
type EmbeddingsClient struct {
	http *httpClient
}

// EmbeddingsRequest is the payload for an embeddings request.
type EmbeddingsRequest struct {
	Model          string      `json:"model"`
	Input          interface{} `json:"input"` // string or []string
	Dimensions     *int        `json:"dimensions,omitempty"`
	EncodingFormat string      `json:"encoding_format,omitempty"`
}

// Create generates embeddings for the given input.
func (e *EmbeddingsClient) Create(ctx context.Context, req EmbeddingsRequest) Result[interface{}] {
	raw, err := e.http.post(ctx, "/api/ai/embeddings", req, nil)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}

// ------------------------------------------------------------------ //
// Images
// ------------------------------------------------------------------ //

// ImagesClient generates images.
type ImagesClient struct {
	http *httpClient
}

// ImageGenerationRequest is the payload for an image generation request.
type ImageGenerationRequest struct {
	Model  string      `json:"model"`
	Prompt string      `json:"prompt"`
	N      *int        `json:"n,omitempty"`
	Size   string      `json:"size,omitempty"`
	Images interface{} `json:"images,omitempty"`
}

// Generate creates images from a text prompt.
func (i *ImagesClient) Generate(ctx context.Context, req ImageGenerationRequest) Result[interface{}] {
	raw, err := i.http.post(ctx, "/api/ai/image/generation", req, nil)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}
