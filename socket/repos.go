package socket

import (
	"context"
	"encoding/json"
	"fmt"
)

// Repo represents a Socket org repository.
type Repo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ParseRepo parses raw JSON bytes into a Repo.
func ParseRepo(data []byte) (Repo, error) {
	var repo Repo
	if err := json.Unmarshal(data, &repo); err != nil {
		return Repo{}, fmt.Errorf("parsing repo: %w", err)
	}
	return repo, nil
}

// GetRepo fetches a repository by name from the Socket org.
// Returns an error if the repo does not exist.
func (c *Client) GetRepo(ctx context.Context, repoName string) (Repo, error) {
	path := fmt.Sprintf("/orgs/%s/repos/%s", c.Org, repoName)
	data, err := c.makeAPIRequest(ctx, path)
	if err != nil {
		return Repo{}, err
	}
	return ParseRepo(data)
}
