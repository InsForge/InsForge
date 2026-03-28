package insforge_test

import (
	"context"
	"net/http"
	"testing"
)

func TestDatabase_SelectAll(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/database/records/users", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("expected GET, got %s", r.Method)
		}
		writeJSON(w, 200, []map[string]interface{}{{"id": 1, "name": "Alice"}})
	})

	client := newTestClient(t, mux)
	result := client.Database.From("users").Select("*").Execute(context.Background())
	if result.Error != nil {
		t.Fatalf("unexpected error: %v", result.Error)
	}
}

func TestDatabase_Insert(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/database/records/posts", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		writeJSON(w, 201, []map[string]interface{}{{"id": 1, "title": "Hello"}})
	})

	client := newTestClient(t, mux)
	result := client.Database.From("posts").Insert(context.Background(), []map[string]interface{}{{"title": "Hello"}})
	if result.Error != nil {
		t.Fatalf("unexpected error: %v", result.Error)
	}
}

func TestDatabase_RPC(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/database/rpc", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]interface{}{"result": 42})
	})

	client := newTestClient(t, mux)
	result := client.Database.RPC(context.Background(), "my_func", map[string]interface{}{"x": 1})
	if result.Error != nil {
		t.Fatalf("unexpected error: %v", result.Error)
	}
}
