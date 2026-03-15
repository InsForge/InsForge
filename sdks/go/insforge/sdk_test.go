package insforge_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/InsForge/InsForge/sdks/go/insforge"
)

// newTestServer creates an httptest server and returns a configured InsForgeClient.
func newTestServer(t *testing.T, mux *http.ServeMux) *insforge.InsForgeClient {
	t.Helper()
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return insforge.CreateClient(insforge.Config{
		BaseURL: srv.URL,
		AnonKey: "test-anon-key",
	})
}

func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// -----------------------------------------------------------------------
// Auth tests
// -----------------------------------------------------------------------

func TestSignUp(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/users", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		jsonResponse(w, 200, map[string]any{
			"accessToken":  "access-123",
			"refreshToken": "refresh-456",
			"expiresIn":    3600,
			"tokenType":    "Bearer",
			"user": map[string]any{
				"id":    "user-1",
				"email": "test@example.com",
			},
		})
	})

	client := newTestServer(t, mux)
	session, err := client.Auth.SignUp("test@example.com", "password123", nil)
	if err != nil {
		t.Fatalf("SignUp error: %v", err)
	}
	if session.AccessToken != "access-123" {
		t.Errorf("expected access token 'access-123', got %q", session.AccessToken)
	}
	if session.User.Email != "test@example.com" {
		t.Errorf("expected email 'test@example.com', got %q", session.User.Email)
	}
}

func TestSignInWithPassword(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/sessions", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{
			"accessToken":  "access-789",
			"refreshToken": "refresh-101",
			"expiresIn":    3600,
			"user": map[string]any{
				"id":    "user-2",
				"email": "signin@example.com",
			},
		})
	})

	client := newTestServer(t, mux)
	session, err := client.Auth.SignInWithPassword("signin@example.com", "secret")
	if err != nil {
		t.Fatalf("SignInWithPassword error: %v", err)
	}
	if session.AccessToken != "access-789" {
		t.Errorf("expected 'access-789', got %q", session.AccessToken)
	}
}

func TestSignOut(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})

	client := newTestServer(t, mux)
	if err := client.Auth.SignOut(); err != nil {
		t.Fatalf("SignOut error: %v", err)
	}
}

func TestAuthError(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/sessions", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 401, map[string]any{
			"error":      "INVALID_CREDENTIALS",
			"message":    "Invalid email or password",
			"statusCode": 401,
		})
	})

	client := newTestServer(t, mux)
	_, err := client.Auth.SignInWithPassword("bad@example.com", "wrong")
	if err == nil {
		t.Fatal("expected an error but got nil")
	}
	insErr, ok := err.(*insforge.InsForgeError)
	if !ok {
		t.Fatalf("expected *InsForgeError, got %T", err)
	}
	if insErr.StatusCode != 401 {
		t.Errorf("expected status 401, got %d", insErr.StatusCode)
	}
}

// -----------------------------------------------------------------------
// Database tests
// -----------------------------------------------------------------------

func TestDatabaseSelect(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/database/records/todos", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, []map[string]any{
			{"id": 1, "title": "Buy milk"},
			{"id": 2, "title": "Walk dog"},
		})
	})

	client := newTestServer(t, mux)
	var rows []map[string]any
	err := client.DB.From("todos").Select("*").Execute(&rows)
	if err != nil {
		t.Fatalf("Select error: %v", err)
	}
	if len(rows) != 2 {
		t.Errorf("expected 2 rows, got %d", len(rows))
	}
}

func TestDatabaseInsert(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/database/records/todos", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		jsonResponse(w, 201, []map[string]any{
			{"id": 3, "title": "New todo"},
		})
	})

	client := newTestServer(t, mux)
	var inserted []map[string]any
	err := client.DB.From("todos").Insert([]map[string]any{{"title": "New todo"}}).Execute(&inserted)
	if err != nil {
		t.Fatalf("Insert error: %v", err)
	}
	if len(inserted) == 0 || inserted[0]["title"] != "New todo" {
		t.Errorf("unexpected insert result: %v", inserted)
	}
}

func TestDatabaseFilter(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/database/records/todos", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("id") != "eq.1" {
			http.Error(w, "unexpected filter", http.StatusBadRequest)
			return
		}
		jsonResponse(w, 200, []map[string]any{{"id": 1, "title": "Buy milk"}})
	})

	client := newTestServer(t, mux)
	var rows []map[string]any
	err := client.DB.From("todos").Select("*").Eq("id", 1).Execute(&rows)
	if err != nil {
		t.Fatalf("Filter error: %v", err)
	}
	if len(rows) != 1 {
		t.Errorf("expected 1 row, got %d", len(rows))
	}
}

func TestDatabaseDelete(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/database/records/todos", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(200)
	})

	client := newTestServer(t, mux)
	err := client.DB.From("todos").Delete().Eq("id", 1).Execute(nil)
	if err != nil {
		t.Fatalf("Delete error: %v", err)
	}
}

func TestRpc(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/database/rpc/my_func", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{"result": 42})
	})

	client := newTestServer(t, mux)
	var result map[string]any
	err := client.DB.Rpc("my_func", map[string]any{"x": 1}).Execute(&result)
	if err != nil {
		t.Fatalf("Rpc error: %v", err)
	}
	if result["result"] != float64(42) {
		t.Errorf("expected result 42, got %v", result["result"])
	}
}

// -----------------------------------------------------------------------
// Storage tests
// -----------------------------------------------------------------------

func TestStorageUpload(t *testing.T) {
	mux := http.NewServeMux()

	// Strategy
	mux.HandleFunc("/api/storage/buckets/avatars/upload-strategy", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{
			"method":    "direct",
			"uploadUrl": "http://" + r.Host + "/fake-upload",
			"key":       "photo.png",
		})
	})

	// Fake external upload endpoint
	mux.HandleFunc("/fake-upload", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})

	// Confirm
	mux.HandleFunc("/api/storage/buckets/avatars/objects/photo.png/confirm-upload", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{"url": "https://cdn.example.com/avatars/photo.png"})
	})

	client := newTestServer(t, mux)
	publicURL, err := client.Storage.From("avatars").Upload("photo.png", []byte("fake-image-data"), "image/png")
	if err != nil {
		t.Fatalf("Upload error: %v", err)
	}
	if !strings.Contains(publicURL, "photo.png") {
		t.Errorf("unexpected URL: %s", publicURL)
	}
}

func TestStorageList(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/storage/buckets/avatars/objects", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, []map[string]any{
			{"key": "photo.png", "size": 1024},
		})
	})

	client := newTestServer(t, mux)
	objects, err := client.Storage.From("avatars").List("")
	if err != nil {
		t.Fatalf("List error: %v", err)
	}
	if len(objects) != 1 {
		t.Errorf("expected 1 object, got %d", len(objects))
	}
}

func TestStorageRemove(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/storage/buckets/avatars/objects/photo.png", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(200)
	})

	client := newTestServer(t, mux)
	if err := client.Storage.From("avatars").Remove("photo.png"); err != nil {
		t.Fatalf("Remove error: %v", err)
	}
}

// -----------------------------------------------------------------------
// AI tests
// -----------------------------------------------------------------------

func TestAIChatCompletion(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ai/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{
			"id":     "chatcmpl-1",
			"object": "chat.completion",
			"choices": []map[string]any{
				{
					"index":         0,
					"finish_reason": "stop",
					"message": map[string]any{
						"role":    "assistant",
						"content": "Hello, world!",
					},
				},
			},
		})
	})

	client := newTestServer(t, mux)
	resp, err := client.AI.Chat.Create(insforge.ChatCompletionRequest{
		Model: "gpt-4o",
		Messages: []insforge.ChatMessage{
			{Role: "user", Content: "Say hello"},
		},
	})
	if err != nil {
		t.Fatalf("Chat completion error: %v", err)
	}
	if len(resp.Choices) == 0 {
		t.Fatal("expected at least one choice")
	}
	if resp.Choices[0].Message.Content != "Hello, world!" {
		t.Errorf("unexpected content: %q", resp.Choices[0].Message.Content)
	}
}

func TestAIImageGeneration(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ai/images/generate", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{
			"created": 1234567890,
			"data": []map[string]any{
				{"url": "https://example.com/generated.png"},
			},
		})
	})

	client := newTestServer(t, mux)
	resp, err := client.AI.GenerateImage(insforge.ImageGenerationRequest{
		Prompt: "A sunset over the ocean",
		Size:   "1024x1024",
	})
	if err != nil {
		t.Fatalf("GenerateImage error: %v", err)
	}
	if len(resp.Data) == 0 {
		t.Fatal("expected image data")
	}
}

// -----------------------------------------------------------------------
// Functions tests
// -----------------------------------------------------------------------

func TestFunctionInvoke(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/functions/send-email", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		jsonResponse(w, 200, map[string]any{"sent": true})
	})

	client := newTestServer(t, mux)
	result, err := client.Functions.Invoke("send-email", &insforge.InvokeOptions{
		Body: map[string]any{"to": "user@example.com"},
	})
	if err != nil {
		t.Fatalf("Invoke error: %v", err)
	}
	if result.StatusCode != 200 {
		t.Errorf("expected 200, got %d", result.StatusCode)
	}
}
