package socket

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// --------------- SearchReposByTopic ---------------

func TestSearchReposByTopic_ReturnsSinglePage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("Authorization = %q, want %q", got, "Bearer test-token")
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(githubSearchResult{
			TotalCount: 2,
			Items:      []githubRepoItem{{Name: "repo-a"}, {Name: "repo-b"}},
		})
	}))
	defer srv.Close()

	c := &GitHubClient{Token: "test-token", BaseURL: srv.URL, HTTPClient: http.DefaultClient}
	names, err := c.SearchReposByTopic(context.Background(), "test-org", "socket-exclude")
	if err != nil {
		t.Fatalf("SearchReposByTopic() error = %v", err)
	}
	if len(names) != 2 {
		t.Fatalf("len(names) = %d, want 2", len(names))
	}
	if names[0] != "repo-a" || names[1] != "repo-b" {
		t.Errorf("names = %v, want [repo-a repo-b]", names)
	}
}

func TestSearchReposByTopic_ReturnsEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(githubSearchResult{TotalCount: 0, Items: []githubRepoItem{}})
	}))
	defer srv.Close()

	c := &GitHubClient{Token: "test-token", BaseURL: srv.URL, HTTPClient: http.DefaultClient}
	names, err := c.SearchReposByTopic(context.Background(), "test-org", "socket-exclude")
	if err != nil {
		t.Fatalf("SearchReposByTopic() error = %v", err)
	}
	if len(names) != 0 {
		t.Fatalf("len(names) = %d, want 0", len(names))
	}
}

func TestSearchReposByTopic_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := &GitHubClient{Token: "test-token", BaseURL: srv.URL, HTTPClient: http.DefaultClient}
	_, err := c.SearchReposByTopic(context.Background(), "test-org", "socket-exclude")
	if err == nil {
		t.Fatal("SearchReposByTopic() expected error for 401, got nil")
	}
}

func TestSearchReposByTopic_Pagination(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if r.URL.Query().Get("page") == "1" {
			json.NewEncoder(w).Encode(githubSearchResult{
				TotalCount: 3,
				Items:      []githubRepoItem{{Name: "repo-a"}, {Name: "repo-b"}},
			})
		} else {
			json.NewEncoder(w).Encode(githubSearchResult{
				TotalCount: 3,
				Items:      []githubRepoItem{{Name: "repo-c"}},
			})
		}
	}))
	defer srv.Close()

	c := &GitHubClient{Token: "test-token", BaseURL: srv.URL, HTTPClient: &http.Client{}}
	names, err := c.SearchReposByTopic(context.Background(), "test-org", "socket-exclude")
	if err != nil {
		t.Fatalf("SearchReposByTopic() error = %v", err)
	}
	if len(names) != 3 {
		t.Fatalf("len(names) = %d, want 3", len(names))
	}
	if names[2] != "repo-c" {
		t.Errorf("names[2] = %q, want %q", names[2], "repo-c")
	}
}
