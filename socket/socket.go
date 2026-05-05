package socket

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const BaseURL = "https://api.socket.dev/v0"

// Client is a Socket API client.
type Client struct {
	APIKey     string
	BaseURL    string
	Org        string
	HTTPClient *http.Client
}

// Option configures a Client.
type Option func(*Client)

// WithBaseURL overrides the default API base URL.
func WithBaseURL(url string) Option {
	return func(c *Client) {
		if url != "" {
			c.BaseURL = url
		}
	}
}

// NewClient creates a new Socket API client.
func NewClient(apiKey, org string, opts ...Option) *Client {
	c := &Client{
		APIKey:  apiKey,
		BaseURL: BaseURL,
		Org:     org,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// APIError represents an error response from the Socket API.
type APIError struct {
	StatusCode int
	Body       string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("socket API error: status %d: %s", e.StatusCode, e.Body)
}

func (c *Client) makeAPIRequest(ctx context.Context, path string) ([]byte, error) {
	url := fmt.Sprintf("%s%s", c.BaseURL, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.APIKey))
	return c.handleResponse(c.HTTPClient.Do(req))
}

func (c *Client) makeAPIPostRequest(ctx context.Context, path string, body any) ([]byte, error) {
	url := fmt.Sprintf("%s%s", c.BaseURL, path)
	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshalling request body: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.APIKey))
	req.Header.Set("Content-Type", "application/json")
	return c.handleResponse(c.HTTPClient.Do(req))
}

func (c *Client) handleResponse(resp *http.Response, err error) ([]byte, error) {
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, errors.New("not found")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &APIError{StatusCode: resp.StatusCode, Body: string(data)}
	}
	return data, nil
}
