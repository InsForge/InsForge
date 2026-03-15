package insforge

import (
	"bufio"
	"encoding/json"
	"strings"
)

// AIClient provides access to AI chat completions, embeddings, and image generation.
type AIClient struct {
	http *httpClient
	Chat *chatCompletionsClient
}

func newAIClient(h *httpClient) *AIClient {
	a := &AIClient{http: h}
	a.Chat = &chatCompletionsClient{http: h}
	return a
}

// -----------------------------------------------------------------------
// Chat Completions
// -----------------------------------------------------------------------

// chatCompletionsClient mirrors the OpenAI chat.completions namespace.
type chatCompletionsClient struct {
	http *httpClient
}

// ChatMessage represents a single message in a chat conversation.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatCompletionRequest is the request body for a chat completion.
type ChatCompletionRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
	Temperature float64       `json:"temperature,omitempty"`
	Stream      bool          `json:"stream,omitempty"`
	// Extra fields (tool calls, response format, etc.) can be added as needed
}

// ChatCompletionResponse is a non-streaming chat completion response.
type ChatCompletionResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index   int         `json:"index"`
		Message ChatMessage `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// ChatCompletionChunk is a single chunk in a streaming response.
type ChatCompletionChunk struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Role    string `json:"role,omitempty"`
			Content string `json:"content,omitempty"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

// Create sends a chat completion request. Set req.Stream = false.
func (c *chatCompletionsClient) Create(req ChatCompletionRequest) (*ChatCompletionResponse, error) {
	req.Stream = false
	var resp ChatCompletionResponse
	if err := c.http.do("POST", "/api/ai/chat/completions", req, nil, &resp, nil); err != nil {
		return nil, err
	}
	return &resp, nil
}

// CreateStream sends a streaming chat completion request.
// It returns a channel that receives chunks and an error channel.
// The caller should range over the chunks channel until it is closed.
func (c *chatCompletionsClient) CreateStream(req ChatCompletionRequest) (<-chan ChatCompletionChunk, <-chan error) {
	chunks := make(chan ChatCompletionChunk, 32)
	errs := make(chan error, 1)

	req.Stream = true
	go func() {
		defer close(chunks)
		defer close(errs)

		body, err := c.http.doStream("POST", "/api/ai/chat/completions", req)
		if err != nil {
			errs <- err
			return
		}
		defer body.Close()

		scanner := bufio.NewScanner(body)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			payload := strings.TrimPrefix(line, "data: ")
			if payload == "[DONE]" {
				break
			}
			var chunk ChatCompletionChunk
			if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
				errs <- err
				return
			}
			chunks <- chunk
		}
		if err := scanner.Err(); err != nil {
			errs <- err
		}
	}()

	return chunks, errs
}

// -----------------------------------------------------------------------
// Embeddings
// -----------------------------------------------------------------------

// EmbeddingsRequest is the request body for generating embeddings.
type EmbeddingsRequest struct {
	Model string   `json:"model"`
	Input []string `json:"input"`
}

// EmbeddingsResponse contains the generated embeddings.
type EmbeddingsResponse struct {
	Object string `json:"object"`
	Data   []struct {
		Object    string    `json:"object"`
		Embedding []float64 `json:"embedding"`
		Index     int       `json:"index"`
	} `json:"data"`
	Model string `json:"model"`
	Usage struct {
		PromptTokens int `json:"prompt_tokens"`
		TotalTokens  int `json:"total_tokens"`
	} `json:"usage"`
}

// CreateEmbeddings generates vector embeddings for the provided inputs.
func (a *AIClient) CreateEmbeddings(req EmbeddingsRequest) (*EmbeddingsResponse, error) {
	var resp EmbeddingsResponse
	if err := a.http.do("POST", "/api/ai/embeddings", req, nil, &resp, nil); err != nil {
		return nil, err
	}
	return &resp, nil
}

// -----------------------------------------------------------------------
// Image Generation
// -----------------------------------------------------------------------

// ImageGenerationRequest is the request body for generating images.
type ImageGenerationRequest struct {
	Prompt string `json:"prompt"`
	Model  string `json:"model,omitempty"`
	N      int    `json:"n,omitempty"`
	Size   string `json:"size,omitempty"`
}

// ImageGenerationResponse contains the generated image URLs.
type ImageGenerationResponse struct {
	Created int64 `json:"created"`
	Data    []struct {
		URL     string `json:"url"`
		B64JSON string `json:"b64_json,omitempty"`
	} `json:"data"`
}

// GenerateImage generates images from a text prompt.
func (a *AIClient) GenerateImage(req ImageGenerationRequest) (*ImageGenerationResponse, error) {
	var resp ImageGenerationResponse
	if err := a.http.do("POST", "/api/ai/images/generate", req, nil, &resp, nil); err != nil {
		return nil, err
	}
	return &resp, nil
}
