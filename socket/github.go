package socket

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

const githubBaseURL = "https://api.github.com"

// GitHubClient is a minimal GitHub API client.
type GitHubClient struct {
	Token      string
	BaseURL    string
	HTTPClient *http.Client
}

// NewGitHubClient creates a new GitHub API client.
func NewGitHubClient(token string) *GitHubClient {
	return &GitHubClient{
		Token:   token,
		BaseURL: githubBaseURL,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type githubSearchResult struct {
	TotalCount int              `json:"total_count"`
	Items      []githubRepoItem `json:"items"`
}

type githubRepoItem struct {
	Name string `json:"name"`
}

// SearchReposByTopic returns the names of all repos in org that have the given topic.
// It handles pagination automatically.
func (c *GitHubClient) SearchReposByTopic(ctx context.Context, org, topic string) ([]string, error) {
	var names []string
	page := 1
	for {
		params := url.Values{}
		params.Set("q", fmt.Sprintf("org:%s topic:%s", org, topic))
		params.Set("per_page", "100")
		params.Set("page", fmt.Sprintf("%d", page))
		path := "/search/repositories?" + params.Encode()

		items, total, err := c.searchPage(ctx, path)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			names = append(names, item.Name)
		}
		if len(items) == 0 || len(names) >= total {
			break
		}
		page++
	}
	return names, nil
}

func (c *GitHubClient) searchPage(ctx context.Context, path string) ([]githubRepoItem, int, error) {
	urlStr := fmt.Sprintf("%s%s", c.BaseURL, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.Token))
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, 0, fmt.Errorf("GitHub API error: status %d", resp.StatusCode)
	}

	var result githubSearchResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, 0, fmt.Errorf("decoding GitHub search response: %w", err)
	}
	return result.Items, result.TotalCount, nil
}
