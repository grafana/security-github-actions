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

type githubOrgRepo struct {
	Name   string   `json:"name"`
	Topics []string `json:"topics"`
}

// ListOrgReposWithTopic returns the names of all repos in org that have the given topic.
// It fetches all org repos (paginated) and filters client-side.
func (c *GitHubClient) ListOrgReposWithTopic(ctx context.Context, org, topic string) ([]string, error) {
	var names []string
	page := 1
	for {
		params := url.Values{}
		params.Set("per_page", "100")
		params.Set("page", fmt.Sprintf("%d", page))
		path := fmt.Sprintf("/orgs/%s/repos?%s", org, params.Encode())

		repos, err := c.listOrgReposPage(ctx, path)
		if err != nil {
			return nil, err
		}
		for _, repo := range repos {
			for _, t := range repo.Topics {
				if t == topic {
					names = append(names, repo.Name)
					break
				}
			}
		}
		if len(repos) < 100 {
			break
		}
		page++
	}
	return names, nil
}

func (c *GitHubClient) listOrgReposPage(ctx context.Context, path string) ([]githubOrgRepo, error) {
	urlStr := fmt.Sprintf("%s%s", c.BaseURL, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.Token))
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("GitHub API error: status %d", resp.StatusCode)
	}

	var repos []githubOrgRepo
	if err := json.NewDecoder(resp.Body).Decode(&repos); err != nil {
		return nil, fmt.Errorf("decoding GitHub repos response: %w", err)
	}
	return repos, nil
}
