// Package insforge is the official Go SDK for InsForge – Backend as a Service.
//
// Usage:
//
//	client := insforge.NewClient(insforge.Config{
//	    BaseURL: "https://your-app.region.insforge.app",
//	    AnonKey: "your-anon-key",
//	})
//
//	ctx := context.Background()
//
//	// Auth
//	result := client.Auth.SignInWithPassword(ctx, "user@example.com", "password")
//	if result.Error != nil {
//	    log.Fatal(result.Error)
//	}
//
//	// Database
//	result2 := client.Database.From("posts").Limit(10).Execute(ctx)
//
//	// Storage
//	result3 := client.Storage.From("avatars").Upload(ctx, "photo.png", data, "image/png")
package insforge

// Config holds the configuration for the InsForge client.
type Config struct {
	// BaseURL is your InsForge backend URL, e.g. "https://your-app.region.insforge.app".
	// Defaults to "http://localhost:7130".
	BaseURL string

	// AnonKey is your project's anonymous API key (from backend metadata).
	AnonKey string

	// Headers are optional extra headers sent with every request.
	Headers map[string]string
}

// Client is the main InsForge SDK client.
type Client struct {
	Auth      *Auth
	Database  *Database
	Storage   *Storage
	AI        *AI
	Functions *Functions
	Realtime  *Realtime
	Emails    *Emails

	http *httpClient
}

// NewClient creates and returns a new InsForge client.
func NewClient(cfg Config) *Client {
	if cfg.BaseURL == "" {
		cfg.BaseURL = "http://localhost:7130"
	}
	h := newHTTPClient(cfg.BaseURL, cfg.AnonKey, cfg.Headers)
	return &Client{
		Auth:      newAuth(h),
		Database:  newDatabase(h),
		Storage:   newStorage(h),
		AI:        newAI(h),
		Functions: newFunctions(h),
		Realtime:  newRealtime(h),
		Emails:    newEmails(h),
		http:      h,
	}
}

// SetAccessToken sets the access token for authenticated requests.
// This is called automatically after sign-in, but can be set manually.
func (c *Client) SetAccessToken(token string) {
	c.http.setAccessToken(token)
}

// GetHTTPClient returns the underlying HTTP client for advanced use.
func (c *Client) GetHTTPClient() *httpClient {
	return c.http
}
