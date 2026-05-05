package socket

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// --------------- ParseRepo ---------------

func TestParseRepo_ReturnsRepo(t *testing.T) {
	data := []byte(`{"id":"repo-uuid-123","name":"my-repo"}`)

	repo, err := ParseRepo(data)
	if err != nil {
		t.Fatalf("ParseRepo() error = %v", err)
	}
	if repo.ID != "repo-uuid-123" {
		t.Errorf("ID = %q, want %q", repo.ID, "repo-uuid-123")
	}
	if repo.Name != "my-repo" {
		t.Errorf("Name = %q, want %q", repo.Name, "my-repo")
	}
}

func TestParseRepo_ReturnsErrorGivenInvalidJSON(t *testing.T) {
	_, err := ParseRepo([]byte(`{invalid`))
	if err == nil {
		t.Fatal("ParseRepo() expected error for invalid JSON, got nil")
	}
}

// --------------- GetRepo ---------------

func TestGetRepo_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if want := "/orgs/test-org/repos/my-repo"; r.URL.Path != want {
			t.Errorf("path = %s, want %s", r.URL.Path, want)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("Authorization = %q, want %q", got, "Bearer test-key")
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"id":"repo-uuid-123","name":"my-repo"}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	repo, err := c.GetRepo(context.Background(), "my-repo")
	if err != nil {
		t.Fatalf("GetRepo() error = %v", err)
	}
	if repo.ID != "repo-uuid-123" {
		t.Errorf("ID = %q, want %q", repo.ID, "repo-uuid-123")
	}
	if repo.Name != "my-repo" {
		t.Errorf("Name = %q, want %q", repo.Name, "my-repo")
	}
}

func TestGetRepo_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`not found`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	_, err := c.GetRepo(context.Background(), "nonexistent-repo")
	if err == nil {
		t.Fatal("GetRepo() expected error for 404, got nil")
	}
	if err.Error() != "not found" {
		t.Errorf("error = %q, want %q", err.Error(), "not found")
	}
}

func TestGetRepo_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"internal server error"}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	_, err := c.GetRepo(context.Background(), "some-repo")
	if err == nil {
		t.Fatal("GetRepo() expected error for 500, got nil")
	}
	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("error type = %T, want *APIError", err)
	}
	if apiErr.StatusCode != http.StatusInternalServerError {
		t.Errorf("StatusCode = %d, want %d", apiErr.StatusCode, http.StatusInternalServerError)
	}
}
