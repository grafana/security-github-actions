package socket

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// ErrAlreadyLabeled is returned by AssociateLabel when the label is already applied.
var ErrAlreadyLabeled = errors.New("already labeled")

// Label represents a Socket org repo label.
type Label struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ParseLabels parses raw JSON bytes into a slice of Labels.
func ParseLabels(data []byte) ([]Label, error) {
	var labels []Label
	if err := json.Unmarshal(data, &labels); err != nil {
		return nil, fmt.Errorf("parsing labels: %w", err)
	}
	return labels, nil
}

// GetLabelByName fetches the first label matching name from the org.
// GET /orgs/{org}/repos/labels?per_page=30&page=1
func (c *Client) GetLabelByName(ctx context.Context, name string) (Label, error) {
	path := fmt.Sprintf("/orgs/%s/repos/labels?per_page=30&page=1", c.Org)
	data, err := c.makeAPIRequest(ctx, path)
	if err != nil {
		return Label{}, err
	}
	labels, err := ParseLabels(data)
	if err != nil {
		return Label{}, err
	}
	for _, l := range labels {
		if l.Name == name {
			return l, nil
		}
	}
	return Label{}, fmt.Errorf("label %q not found in org", name)
}

// AssociateLabelRequest is the request body for the associate label endpoint.
type AssociateLabelRequest struct {
	RepositoryID string `json:"repository_id"`
}

// NewAssociateLabelRequest builds the request body for associating a label with a repository.
func NewAssociateLabelRequest(repoID string) AssociateLabelRequest {
	return AssociateLabelRequest{RepositoryID: repoID}
}

// AssociateLabel associates a repository with a label.
// Returns ErrAlreadyLabeled if the label is already applied (HTTP 409).
// POST /orgs/{org}/repos/labels/{labelID}/associate
func (c *Client) AssociateLabel(ctx context.Context, labelID, repoID string) error {
	path := fmt.Sprintf("/orgs/%s/repos/labels/%s/associate", c.Org, labelID)
	_, err := c.makeAPIPostRequest(ctx, path, NewAssociateLabelRequest(repoID))
	if err != nil {
		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusConflict {
			return ErrAlreadyLabeled
		}
		return err
	}
	return nil
}
