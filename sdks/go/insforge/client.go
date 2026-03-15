// Package insforge provides an official Go SDK for InsForge backend-as-a-service.
//
// Usage:
//
//	client := insforge.CreateClient(insforge.Config{
//	    BaseURL: "https://your-app.region.insforge.app",
//	    AnonKey: "your-anon-key",
//	})
//
//	// Auth
//	result, err := client.Auth.SignInWithPassword("user@example.com", "password")
//
//	// Database
//	var rows []map[string]any
//	err = client.DB.From("todos").Select("*").Execute(&rows)
//
//	// Storage
//	url, err := client.Storage.From("avatars").Upload("path/to/file.png", data, "image/png")
package insforge

// Config holds the configuration for the InsForge client.
type Config struct {
	// BaseURL is your InsForge backend URL, e.g. "https://your-app.region.insforge.app"
	BaseURL string
	// AnonKey is the anonymous/public API key.
	AnonKey string
	// EdgeFunctionToken overrides the bearer token for serverless function calls.
	// Useful when the SDK is used inside an InsForge Function.
	EdgeFunctionToken string
	// Timeout for HTTP requests in seconds. Defaults to 30.
	TimeoutSeconds int
}

// InsForgeClient is the top-level client. Instantiate with CreateClient.
type InsForgeClient struct {
	Auth      *AuthClient
	DB        *DatabaseClient
	Storage   *StorageClient
	AI        *AIClient
	Functions *FunctionsClient
	Realtime  *RealtimeClient

	http *httpClient
}

// CreateClient creates and returns a new InsForgeClient.
func CreateClient(cfg Config) *InsForgeClient {
	if cfg.TimeoutSeconds <= 0 {
		cfg.TimeoutSeconds = 30
	}
	h := newHTTPClient(cfg.BaseURL, cfg.AnonKey, cfg.EdgeFunctionToken, cfg.TimeoutSeconds)
	return &InsForgeClient{
		Auth:      newAuthClient(h),
		DB:        newDatabaseClient(h),
		Storage:   newStorageClient(h),
		AI:        newAIClient(h),
		Functions: newFunctionsClient(h),
		Realtime:  newRealtimeClient(h),
		http:      h,
	}
}
