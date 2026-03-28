package insforge_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/InsForge/insforge-sdk-go/insforge"
)

func newTestClient(t *testing.T, mux *http.ServeMux) *insforge.Client {
	t.Helper()
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return insforge.NewClient(insforge.Config{BaseURL: srv.URL, AnonKey: "test-key"})
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func TestSignUp_Success(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/users", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		writeJSON(w, 201, map[string]interface{}{"id": "user-1", "email": "a@b.com"})
	})

	client := newTestClient(t, mux)
	result := client.Auth.SignUp(context.Background(), "a@b.com", "secret")
	if result.Error != nil {
		t.Fatalf("unexpected error: %v", result.Error)
	}
	if result.Data["id"] != "user-1" {
		t.Fatalf("expected user-1, got %v", result.Data["id"])
	}
}

func TestSignUp_Error(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/users", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 400, map[string]interface{}{
			"error": map[string]interface{}{"message": "Email taken", "code": "EMAIL_EXISTS"},
		})
	})

	client := newTestClient(t, mux)
	result := client.Auth.SignUp(context.Background(), "a@b.com", "secret")
	if result.Error == nil {
		t.Fatal("expected error, got nil")
	}
	if result.Error.Message != "Email taken" {
		t.Fatalf("expected 'Email taken', got %q", result.Error.Message)
	}
}

func TestSignIn_StoresToken(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/sessions", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]interface{}{
			"accessToken":  "jwt-abc",
			"refreshToken": "refresh-xyz",
			"user":         map[string]interface{}{"id": "u1", "email": "a@b.com"},
		})
	})

	client := newTestClient(t, mux)
	result := client.Auth.SignInWithPassword(context.Background(), "a@b.com", "secret")
	if result.Error != nil {
		t.Fatalf("unexpected error: %v", result.Error)
	}
	if result.Data.AccessToken != "jwt-abc" {
		t.Fatalf("expected jwt-abc, got %s", result.Data.AccessToken)
	}
}

func TestSignOut_ClearsToken(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]interface{}{"message": "ok"})
	})

	client := newTestClient(t, mux)
	client.SetAccessToken("jwt-abc")
	result := client.Auth.SignOut(context.Background())
	if result.Error != nil {
		t.Fatalf("unexpected error: %v", result.Error)
	}
}
