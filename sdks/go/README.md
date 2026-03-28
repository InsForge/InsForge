# InsForge Go SDK

Official Go SDK for [InsForge](https://insforge.app) – Backend as a Service.

## Installation

```bash
go get github.com/InsForge/insforge-sdk-go
```

Requires Go 1.21+.

## Quick Start

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/InsForge/insforge-sdk-go/insforge"
)

func main() {
    client := insforge.NewClient(insforge.Config{
        BaseURL: "https://your-app.region.insforge.app",
        AnonKey: "your-anon-key",
    })

    ctx := context.Background()

    // Sign in
    authResult := client.Auth.SignInWithPassword(ctx, "user@example.com", "password123")
    if authResult.Error != nil {
        log.Fatal(authResult.Error)
    }
    fmt.Println("Logged in:", authResult.Data.User.Email)

    // Query database
    dbResult := client.Database.From("posts").
        Select("id, title, created_at").
        Limit(10).
        Execute(ctx)
    if dbResult.Error != nil {
        log.Fatal(dbResult.Error)
    }
    fmt.Println("Posts:", dbResult.Data)

    // Upload file
    data := []byte("hello world")
    storageResult := client.Storage.From("files").
        Upload(ctx, "hello.txt", data, "text/plain")
    if storageResult.Error != nil {
        log.Fatal(storageResult.Error)
    }

    // AI chat
    aiResult := client.AI.Chat.Completions.Create(ctx, insforge.ChatCompletionRequest{
        Model: "openai/gpt-4o",
        Messages: []insforge.ChatMessage{
            {Role: "user", Content: "Hello!"},
        },
    })
    if aiResult.Error != nil {
        log.Fatal(aiResult.Error)
    }
    fmt.Println(aiResult.Data.Choices[0].Message.Content)
}
```

## Modules

### `client.Auth`

| Method | Description |
|--------|-------------|
| `SignUp(ctx, email, password, opts...)` | Register a new user |
| `SignInWithPassword(ctx, email, password)` | Login with email/password |
| `SignOut(ctx)` | Logout |
| `SignInWithOAuth(ctx, provider, redirectTo)` | OAuth sign-in |
| `ExchangeOAuthCode(ctx, code, codeVerifier)` | Exchange OAuth code |
| `GetCurrentUser(ctx)` | Get the logged-in user |
| `RefreshSession(ctx, refreshToken)` | Refresh the session |
| `GetProfile(ctx, userID)` | Get user profile |
| `SetProfile(ctx, profile)` | Update current user's profile |
| `ResendVerificationEmail(ctx, email)` | Resend verification email |
| `VerifyEmail(ctx, email, otp)` | Verify email with OTP |
| `SendResetPasswordEmail(ctx, email)` | Send password reset email |
| `ResetPassword(ctx, newPassword, otp)` | Reset password |
| `GetPublicAuthConfig(ctx)` | Get public auth configuration |

### `client.Database`

```go
// SELECT
result := client.Database.From("users").
    Select("id, name").
    Eq("active", true).
    Order("created_at", false). // false = DESC
    Limit(20).
    Execute(ctx)

// INSERT
result := client.Database.From("posts").
    Insert(ctx, []map[string]interface{}{
        {"title": "Hello", "body": "World"},
    })

// UPDATE
result := client.Database.From("posts").
    Eq("id", 5).
    Update(ctx, map[string]interface{}{"title": "Updated"})

// DELETE
result := client.Database.From("posts").
    Eq("id", 5).
    Delete(ctx)

// RPC
result := client.Database.RPC(ctx, "get_stats", map[string]interface{}{"user_id": "abc"})

// Raw SQL (admin)
result := client.Database.Query(ctx, "SELECT * FROM users WHERE email = $1", "user@example.com")
```

### `client.Storage`

```go
bucket := client.Storage.From("my-bucket")

// Upload bytes
result := bucket.Upload(ctx, "path/file.png", fileBytes, "image/png")

// Upload from io.Reader
result := bucket.UploadReader(ctx, "path/file.png", file, "image/png")

// Download
result := bucket.Download(ctx, "path/file.png")
fileBytes := result.Data

// List
result := bucket.List(ctx, &insforge.ListOptions{Prefix: "path/", Limit: 50})

// Delete
result := bucket.Remove(ctx, "path/file.png")

// Get public URL
url := bucket.GetPublicURL("path/file.png")
```

### `client.AI`

```go
// Non-streaming completion
result := client.AI.Chat.Completions.Create(ctx, insforge.ChatCompletionRequest{
    Model: "openai/gpt-4o",
    Messages: []insforge.ChatMessage{
        {Role: "system", Content: "You are a helpful assistant."},
        {Role: "user", Content: "What is 2+2?"},
    },
})
fmt.Println(result.Data.Choices[0].Message.Content)

// Streaming
temp := 0.7
chunks, errs := client.AI.Chat.Completions.CreateStream(ctx, insforge.ChatCompletionRequest{
    Model:       "openai/gpt-4o",
    Messages:    []insforge.ChatMessage{{Role: "user", Content: "Tell me a story"}},
    Temperature: &temp,
})
for chunk := range chunks {
    if len(chunk.Choices) > 0 {
        fmt.Print(chunk.Choices[0].Delta.Content)
    }
}
if err := <-errs; err != nil {
    log.Fatal(err)
}

// Embeddings
result := client.AI.Embeddings.Create(ctx, insforge.EmbeddingsRequest{
    Model: "openai/text-embedding-3-small",
    Input: "Hello world",
})

// Image generation
n := 1
result := client.AI.Images.Generate(ctx, insforge.ImageGenerationRequest{
    Model:  "openai/dall-e-3",
    Prompt: "A sunset over the ocean",
    Size:   "1024x1024",
    N:      &n,
})
```

### `client.Realtime`

```go
// Connect
err := client.Realtime.Connect(ctx)

// Subscribe
result, err := client.Realtime.Subscribe(ctx, "chat:room-1")

// Listen for events
client.Realtime.On("chat:room-1", func(data interface{}) {
    fmt.Println("Received:", data)
})

// Publish
err = client.Realtime.Publish(ctx, "chat:room-1", "message", map[string]interface{}{
    "text": "Hello!",
})

// Unsubscribe
err = client.Realtime.Unsubscribe("chat:room-1")

// Disconnect
err = client.Realtime.Disconnect()
```

### `client.Functions`

```go
result := client.Functions.Invoke(ctx, "my-function", &insforge.InvokeOptions{
    Body:   map[string]interface{}{"key": "value"},
    Method: "POST",
})
```

### `client.Emails`

```go
result := client.Emails.Send(ctx, insforge.SendEmailRequest{
    To:      "recipient@example.com",
    Subject: "Hello",
    HTML:    "<p>Hello from InsForge!</p>",
})
```

## Error Handling

All SDK methods return a `Result[T]` value containing `Data T` and `Error *InsForgeError`:

```go
result := client.Auth.SignUp(ctx, "a@b.com", "pass")
if result.Error != nil {
    fmt.Println(result.Error.Message)     // Human-readable message
    fmt.Println(result.Error.StatusCode)  // HTTP status code
    fmt.Println(result.Error.Error)       // Error code string
    return
}
fmt.Println(result.Data)
```

## License

Apache-2.0
