package insforge

// Result is the standard response wrapper returned by most SDK methods.
type Result[T any] struct {
	Data  T
	Error *InsForgeError
}

func ok[T any](data T) Result[T] {
	return Result[T]{Data: data}
}

func fail[T any](err error) Result[T] {
	var zero T
	if e, ok := err.(*InsForgeError); ok {
		return Result[T]{Data: zero, Error: e}
	}
	return Result[T]{Data: zero, Error: &InsForgeError{Message: err.Error()}}
}

// --- Auth types ---

// User represents an InsForge user account.
type User struct {
	ID            string                 `json:"id"`
	Email         string                 `json:"email"`
	EmailVerified bool                   `json:"emailVerified"`
	Providers     []string               `json:"providers"`
	Profile       map[string]interface{} `json:"profile"`
	Metadata      map[string]interface{} `json:"metadata"`
	CreatedAt     string                 `json:"createdAt"`
	UpdatedAt     string                 `json:"updatedAt"`
}

// Session holds authentication tokens.
type Session struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresAt    string `json:"expiresAt"`
	User         *User  `json:"user"`
}

// --- Database types ---

// ColumnType enumerates supported column types.
type ColumnType string

const (
	ColumnTypeString   ColumnType = "string"
	ColumnTypeDate     ColumnType = "date"
	ColumnTypeDatetime ColumnType = "datetime"
	ColumnTypeInteger  ColumnType = "integer"
	ColumnTypeFloat    ColumnType = "float"
	ColumnTypeBoolean  ColumnType = "boolean"
	ColumnTypeUUID     ColumnType = "uuid"
	ColumnTypeJSON     ColumnType = "json"
)

// Column describes a table column schema.
type Column struct {
	ColumnName   string     `json:"columnName"`
	Type         ColumnType `json:"type"`
	IsPrimaryKey bool       `json:"isPrimaryKey"`
	IsNullable   bool       `json:"isNullable"`
	IsUnique     bool       `json:"isUnique"`
	DefaultValue string     `json:"defaultValue,omitempty"`
}

// --- Storage types ---

// StorageFile describes an object stored in a bucket.
type StorageFile struct {
	Key        string                 `json:"key"`
	BucketName string                 `json:"bucketName"`
	Size       int64                  `json:"size"`
	MimeType   string                 `json:"mimeType"`
	UploadedAt string                 `json:"uploadedAt"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
}

// --- AI types ---

// ChatMessage represents a single message in a conversation.
type ChatMessage struct {
	Role       string      `json:"role"`
	Content    interface{} `json:"content"`
	ToolCalls  interface{} `json:"tool_calls,omitempty"`
	ToolCallID string      `json:"tool_call_id,omitempty"`
}

// ChatCompletionRequest is the payload for a chat completion call.
type ChatCompletionRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Temperature *float64      `json:"temperature,omitempty"`
	MaxTokens   *int          `json:"maxTokens,omitempty"`
	TopP        *float64      `json:"topP,omitempty"`
	Stream      bool          `json:"stream,omitempty"`
	Tools       interface{}   `json:"tools,omitempty"`
	ToolChoice  interface{}   `json:"toolChoice,omitempty"`
	WebSearch   interface{}   `json:"webSearch,omitempty"`
	FileParser  interface{}   `json:"fileParser,omitempty"`
	Thinking    bool          `json:"thinking,omitempty"`
}

// ChatCompletionResponse is the response from a (non-streaming) chat completion.
type ChatCompletionResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index   int         `json:"index"`
		Message ChatMessage `json:"message"`
		Delta   ChatMessage `json:"delta"`
		Finish  string      `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// --- Email types ---

// SendEmailRequest is the payload for sending an email.
type SendEmailRequest struct {
	To      interface{} `json:"to"`
	Subject string      `json:"subject"`
	HTML    string      `json:"html"`
	CC      interface{} `json:"cc,omitempty"`
	BCC     interface{} `json:"bcc,omitempty"`
	From    string      `json:"from,omitempty"`
	ReplyTo string      `json:"replyTo,omitempty"`
	Text    string      `json:"text,omitempty"`
}
