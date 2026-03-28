package insforge_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestStorage_GetPublicURL(t *testing.T) {
	mux := http.NewServeMux()
	client := newTestClient(t, mux)
	url := client.Storage.From("avatars").GetPublicURL("user.png")
	if !strings.Contains(url, "/api/storage/buckets/avatars/objects/user.png") {
		t.Fatalf("unexpected URL: %s", url)
	}
}

func TestStorage_List(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/storage/buckets/avatars/objects", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]interface{}{"objects": []map[string]interface{}{{"key": "a.png"}}})
	})
	client := newTestClient(t, mux)
	result := client.Storage.From("avatars").List(context.Background(), nil)
	if result.Error != nil {
		t.Fatalf("unexpected error: %v", result.Error)
	}
}

func TestStorage_Remove(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/storage/buckets/avatars/objects/a.png", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Fatalf("expected DELETE, got %s", r.Method)
		}
		writeJSON(w, 200, map[string]interface{}{"message": "deleted"})
	})
	client := newTestClient(t, mux)
	result := client.Storage.From("avatars").Remove(context.Background(), "a.png")
	if result.Error != nil {
		t.Fatalf("unexpected error: %v", result.Error)
	}
}
