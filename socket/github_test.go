package socket

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// --------------- ListOrgReposWithTopic ---------------

func TestListOrgReposWithTopic_FiltersToReposWithMatchingTopic(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("Authorization = %q, want %q", got, "Bearer test-token")
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode([]githubOrgRepo{
			{Name: "repo-a", Topics: []string{"socket-exclude-from-license-policy", "golang"}},
			{Name: "repo-b", Topics: []string{"other-topic"}},
			{Name: "repo-c", Topics: []string{"socket-exclude-from-license-policy"}},
		})
	}))
	defer srv.Close()

	c := &GitHubClient{Token: "test-token", BaseURL: srv.URL, HTTPClient: http.DefaultClient}
	names, err := c.ListOrgReposWithTopic(context.Background(), "test-org", "socket-exclude-from-license-policy")
	if err != nil {
		t.Fatalf("ListOrgReposWithTopic() error = %v", err)
	}
	if len(names) != 2 {
		t.Fatalf("len(names) = %d, want 2", len(names))
	}
	if names[0] != "repo-a" || names[1] != "repo-c" {
		t.Errorf("names = %v, want [repo-a repo-c]", names)
	}
}

func TestListOrgReposWithTopic_ReturnsEmptyWhenNoTopicMatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode([]githubOrgRepo{
			{Name: "repo-a", Topics: []string{"unrelated"}},
		})
	}))
	defer srv.Close()

	c := &GitHubClient{Token: "test-token", BaseURL: srv.URL, HTTPClient: http.DefaultClient}
	names, err := c.ListOrgReposWithTopic(context.Background(), "test-org", "socket-exclude-from-license-policy")
	if err != nil {
		t.Fatalf("ListOrgReposWithTopic() error = %v", err)
	}
	if len(names) != 0 {
		t.Fatalf("len(names) = %d, want 0", len(names))
	}
}

func TestListOrgReposWithTopic_PropagatesAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := &GitHubClient{Token: "test-token", BaseURL: srv.URL, HTTPClient: http.DefaultClient}
	_, err := c.ListOrgReposWithTopic(context.Background(), "test-org", "socket-exclude-from-license-policy")
	if err == nil {
		t.Fatal("ListOrgReposWithTopic() expected error for 401, got nil")
	}
}

func TestListOrgReposWithTopic_FetchesAllPagesUntilPartialPage(t *testing.T) {
	// First page returns a full 100 repos (stopping condition is < 100).
	// Second page returns fewer than 100, ending pagination.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if r.URL.Query().Get("page") == "1" {
			repos := make([]githubOrgRepo, 100)
			for i := range repos {
				repos[i] = githubOrgRepo{Name: fmt.Sprintf("repo-%d", i), Topics: []string{"other"}}
			}
			repos[0].Topics = []string{"socket-exclude-from-license-policy"}
			json.NewEncoder(w).Encode(repos)
		} else {
			json.NewEncoder(w).Encode([]githubOrgRepo{
				{Name: "repo-last", Topics: []string{"socket-exclude-from-license-policy"}},
			})
		}
	}))
	defer srv.Close()

	c := &GitHubClient{Token: "test-token", BaseURL: srv.URL, HTTPClient: &http.Client{}}
	names, err := c.ListOrgReposWithTopic(context.Background(), "test-org", "socket-exclude-from-license-policy")
	if err != nil {
		t.Fatalf("ListOrgReposWithTopic() error = %v", err)
	}
	if len(names) != 2 {
		t.Fatalf("len(names) = %d, want 2", len(names))
	}
	if names[1] != "repo-last" {
		t.Errorf("names[1] = %q, want %q", names[1], "repo-last")
	}
}
