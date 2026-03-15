# InsForge Go SDK

Official Go SDK for [InsForge](https://insforge.dev) — backend-as-a-service providing Database, Authentication, Storage, AI, Serverless Functions, and Realtime.

## Installation

```bash
go get github.com/InsForge/InsForge/sdks/go/insforge@latest
```

## Quick Start

```go
package main

import (
    "fmt"
    "github.com/InsForge/InsForge/sdks/go/insforge"
)

func main() {
    client := insforge.CreateClient(insforge.Config{
        BaseURL: "https://your-app.region.insforge.app",
        AnonKey: "your-anon-key",
    })

    // Sign in
    session, err := client.Auth.SignInWithPassword("user@example.com", "password")
    if err != nil {
        panic(err)
    }
    fmt.Println("Logged in as:", session.User.Email)

    // Query the database
    var todos []map[string]any
    if err := client.DB.From("todos").Select("*").Execute(&todos); err != nil {
        panic(err)
    }
    fmt.Printf("Found %d todos\n", len(todos))
}
```

## Authentication

```go
// Sign up
session, err := client.Auth.SignUp("user@example.com", "password", map[string]any{
    "display_name": "Jane Doe",
})

// Sign in
session, err := client.Auth.SignInWithPassword("user@example.com", "password")

// OAuth — get redirect URL
oauthURL, err := client.Auth.SignInWithOAuth("google", "https://myapp.com/callback", codeChallenge)
// Redirect the user to oauthURL.URL

// Exchange OAuth code after redirect
session, err := client.Auth.ExchangeOAuthCode("google", code, codeVerifier)

// Sign out
err = client.Auth.SignOut()

// Get current user
user, err := client.Auth.GetCurrentUser()

// Refresh token
session, err = client.Auth.RefreshSession()

// Profile management
profile, err := client.Auth.GetProfile(userID)
profile, err = client.Auth.SetProfile(userID, map[string]any{"bio": "Hello"})

// Password reset flow
err = client.Auth.SendResetPasswordEmail("user@example.com")
session, err = client.Auth.ExchangeResetPasswordToken(token)
err = client.Auth.ResetPassword("new-password")
```

## Database

```go
// Select rows
var rows []map[string]any
err := client.DB.From("todos").Select("*").Execute(&rows)

// Select into typed structs
type Todo struct {
    ID    int    `json:"id"`
    Title string `json:"title"`
    Done  bool   `json:"done"`
}
var todos []Todo
err = client.DB.From("todos").Select("*").Execute(&todos)

// Filter
err = client.DB.From("todos").
    Select("*").
    Eq("done", false).
    Order("created_at", "desc").
    Limit(10).
    Execute(&todos)

// Multiple filters
err = client.DB.From("products").
    Select("*").
    Gte("price", 10).
    Lte("price", 100).
    In("category", []any{"electronics", "books"}).
    Execute(&rows)

// Insert
err = client.DB.From("todos").
    Insert([]map[string]any{{"title": "Buy groceries", "done": false}}).
    Execute(&rows)

// Update
err = client.DB.From("todos").
    Update(map[string]any{"done": true}).
    Eq("id", 1).
    Execute(&rows)

// Delete
err = client.DB.From("todos").Delete().Eq("id", 1).Execute(nil)

// Upsert
err = client.DB.From("todos").
    Upsert([]map[string]any{{"id": 1, "title": "Updated", "done": true}}).
    Execute(&rows)

// Single row
var todo Todo
err = client.DB.From("todos").Select("*").Eq("id", 1).Single().Execute(&todo)

// Call a Postgres function
var result map[string]any
err = client.DB.Rpc("my_function", map[string]any{"param": "value"}).Execute(&result)
```

## Storage

```go
import "os"

// Upload a file
data, _ := os.ReadFile("avatar.png")
publicURL, err := client.Storage.From("avatars").Upload("user-123/avatar.png", data, "image/png")

// Download a file
fileData, err := client.Storage.From("avatars").Download("user-123/avatar.png")

// List files
objects, err := client.Storage.From("avatars").List("user-123/")
for _, obj := range objects {
    fmt.Printf("%s (%d bytes)\n", obj.Key, obj.Size)
}

// Delete a file
err = client.Storage.From("avatars").Remove("user-123/avatar.png")
```

## AI

```go
// Chat completion
resp, err := client.AI.Chat.Create(insforge.ChatCompletionRequest{
    Model: "openai/gpt-4o",
    Messages: []insforge.ChatMessage{
        {Role: "system", Content: "You are a helpful assistant."},
        {Role: "user", Content: "What is the capital of France?"},
    },
})
fmt.Println(resp.Choices[0].Message.Content)

// Streaming chat completion
req := insforge.ChatCompletionRequest{
    Model:    "openai/gpt-4o",
    Messages: []insforge.ChatMessage{{Role: "user", Content: "Tell me a story"}},
}
chunks, errs := client.AI.Chat.CreateStream(req)
for chunk := range chunks {
    if len(chunk.Choices) > 0 {
        fmt.Print(chunk.Choices[0].Delta.Content)
    }
}
if err := <-errs; err != nil {
    fmt.Println("stream error:", err)
}

// Embeddings
embResp, err := client.AI.CreateEmbeddings(insforge.EmbeddingsRequest{
    Model: "openai/text-embedding-3-small",
    Input: []string{"Hello, world!"},
})
fmt.Println(embResp.Data[0].Embedding[:5])

// Image generation
imgResp, err := client.AI.GenerateImage(insforge.ImageGenerationRequest{
    Prompt: "A serene mountain lake at sunrise",
    Size:   "1024x1024",
    N:      1,
})
fmt.Println(imgResp.Data[0].URL)
```

## Serverless Functions

```go
// Invoke a function
result, err := client.Functions.Invoke("send-welcome-email", &insforge.InvokeOptions{
    Body: map[string]any{
        "to":   "user@example.com",
        "name": "Jane",
    },
})
fmt.Println(result.Data)

// GET request
result, err = client.Functions.Invoke("get-stats", &insforge.InvokeOptions{
    Method: "GET",
})

// Custom headers
result, err = client.Functions.Invoke("process-webhook", &insforge.InvokeOptions{
    Headers: map[string]string{"X-Webhook-Secret": "secret"},
    Body:    payload,
})
```

## Realtime

```go
// Connect
if err := client.Realtime.Connect(); err != nil {
    panic(err)
}
defer client.Realtime.Disconnect()

// Subscribe to a channel
err = client.Realtime.Subscribe("todos", func(msg insforge.RealtimeMessage) {
    fmt.Printf("Received on %s: %v\n", msg.Channel, msg.Payload)
})

// Publish a message
err = client.Realtime.Publish("todos", map[string]any{
    "action": "created",
    "id":     42,
})

// One-time handler
client.Realtime.Once("notifications", func(msg insforge.RealtimeMessage) {
    fmt.Println("Got one notification:", msg.Payload)
})

// Check connection
fmt.Println("Connected:", client.Realtime.IsConnected())
fmt.Println("Subscribed channels:", client.Realtime.GetSubscribedChannels())

// Unsubscribe
err = client.Realtime.Unsubscribe("todos")
```

## Error Handling

```go
_, err := client.Auth.SignInWithPassword("bad@example.com", "wrong")
if err != nil {
    if insErr, ok := err.(*insforge.InsForgeError); ok {
        fmt.Printf("API error [%s]: %s (HTTP %d)\n",
            insErr.ErrorCode, insErr.Message, insErr.StatusCode)
    } else {
        fmt.Println("Network/other error:", err)
    }
}
```

## Configuration

```go
client := insforge.CreateClient(insforge.Config{
    BaseURL:           "https://your-app.region.insforge.app",
    AnonKey:           "your-anon-key",
    // Optional: override bearer token (for use inside InsForge Functions)
    EdgeFunctionToken: os.Getenv("INSFORGE_FUNCTION_TOKEN"),
    // Optional: HTTP timeout in seconds (default: 30)
    TimeoutSeconds:    60,
})
```

## Running Tests

```bash
go test ./...
```
