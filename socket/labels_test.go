package socket

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// --------------- NewAssociateLabelRequest ---------------

func TestNewAssociateLabelRequest_SetsRepositoryID(t *testing.T) {
	req := NewAssociateLabelRequest("repo-uuid-456")
	if req.RepositoryID != "repo-uuid-456" {
		t.Errorf("RepositoryID = %q, want %q", req.RepositoryID, "repo-uuid-456")
	}
}

func TestNewAssociateLabelRequest_MarshalJSON(t *testing.T) {
	req := NewAssociateLabelRequest("repo-uuid-456")
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	var got map[string]string
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if got["repository_id"] != "repo-uuid-456" {
		t.Errorf("repository_id = %q, want %q", got["repository_id"], "repo-uuid-456")
	}
}

// --------------- ParseLabels ---------------

func TestParseLabels_ReturnsLabels(t *testing.T) {
	data := []byte(`[
		{"id":"label-uuid-123","name":"exclude-from-license-policy"},
		{"id":"label-uuid-456","name":"some-other-label"}
	]`)

	labels, err := ParseLabels(data)
	if err != nil {
		t.Fatalf("ParseLabels() error = %v", err)
	}
	if len(labels) != 2 {
		t.Fatalf("len(labels) = %d, want 2", len(labels))
	}
	if labels[0].ID != "label-uuid-123" {
		t.Errorf("labels[0].ID = %q, want %q", labels[0].ID, "label-uuid-123")
	}
	if labels[0].Name != "exclude-from-license-policy" {
		t.Errorf("labels[0].Name = %q, want %q", labels[0].Name, "exclude-from-license-policy")
	}
}

func TestParseLabels_ReturnsErrorGivenInvalidJSON(t *testing.T) {
	_, err := ParseLabels([]byte(`{invalid`))
	if err == nil {
		t.Fatal("ParseLabels() expected error for invalid JSON, got nil")
	}
}

// --------------- GetLabelByName ---------------

func TestGetLabelByName_ReturnsLabel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if want := "/orgs/test-org/repos/labels"; r.URL.Path != want {
			t.Errorf("path = %s, want %s", r.URL.Path, want)
		}
		if q := r.URL.Query(); q.Get("per_page") != "30" || q.Get("page") != "1" {
			t.Errorf("query = %v, want per_page=30&page=1", q)
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`[
			{"id":"label-uuid-999","name":"some-other-label"},
			{"id":"label-uuid-123","name":"exclude-from-license-policy"}
		]`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	label, err := c.GetLabelByName(context.Background(), "exclude-from-license-policy")
	if err != nil {
		t.Fatalf("GetLabelByName() error = %v", err)
	}
	if label.ID != "label-uuid-123" {
		t.Errorf("ID = %q, want %q", label.ID, "label-uuid-123")
	}
	if label.Name != "exclude-from-license-policy" {
		t.Errorf("Name = %q, want %q", label.Name, "exclude-from-license-policy")
	}
}

func TestGetLabelByName_LabelNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`[{"id":"label-uuid-999","name":"some-other-label"}]`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	_, err := c.GetLabelByName(context.Background(), "exclude-from-license-policy")
	if err == nil {
		t.Fatal("GetLabelByName() expected error for missing label, got nil")
	}
}

func TestGetLabelByName_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"unauthorized"}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	_, err := c.GetLabelByName(context.Background(), "exclude-from-license-policy")
	if err == nil {
		t.Fatal("GetLabelByName() expected error for 401, got nil")
	}
	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("error type = %T, want *APIError", err)
	}
	if apiErr.StatusCode != http.StatusUnauthorized {
		t.Errorf("StatusCode = %d, want %d", apiErr.StatusCode, http.StatusUnauthorized)
	}
}

// --------------- AssociateLabel ---------------

func TestAssociateLabel_Success(t *testing.T) {
	labelID := "label-uuid-123"
	repoID := "repo-uuid-456"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		wantPath := "/orgs/test-org/repos/labels/label-uuid-123/associate"
		if r.URL.Path != wantPath {
			t.Errorf("path = %s, want %s", r.URL.Path, wantPath)
		}

		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decoding request body: %v", err)
		}
		if body["repository_id"] != repoID {
			t.Errorf("body repository_id = %q, want %q", body["repository_id"], repoID)
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	err := c.AssociateLabel(context.Background(), labelID, repoID)
	if err != nil {
		t.Fatalf("AssociateLabel() error = %v", err)
	}
}

func TestAssociateLabel_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"internal"}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	err := c.AssociateLabel(context.Background(), "lid", "rid")
	if err == nil {
		t.Fatal("AssociateLabel() expected error, got nil")
	}

	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("error type = %T, want *APIError", err)
	}
	if apiErr.StatusCode != http.StatusInternalServerError {
		t.Errorf("StatusCode = %d, want %d", apiErr.StatusCode, http.StatusInternalServerError)
	}
}

// --------------- GetLabeledRepoIDs ---------------

func TestGetLabeledRepoIDs_ReturnsIDs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		wantPath := "/orgs/test-org/repos/labels/label-uuid-123"
		if r.URL.Path != wantPath {
			t.Errorf("path = %s, want %s", r.URL.Path, wantPath)
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{
			"nextPage": null,
			"results": [{
				"id": "label-uuid-123",
				"name": "exclude-from-license-policy",
				"repository_ids": ["repo-uuid-1", "repo-uuid-2"],
				"has_security_policy": false,
				"has_license_policy": true
			}]
		}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	ids, err := c.GetLabeledRepoIDs(context.Background(), "label-uuid-123")
	if err != nil {
		t.Fatalf("GetLabeledRepoIDs() error = %v", err)
	}
	if len(ids) != 2 {
		t.Fatalf("len(ids) = %d, want 2", len(ids))
	}
	if ids[0] != "repo-uuid-1" || ids[1] != "repo-uuid-2" {
		t.Errorf("ids = %v, want [repo-uuid-1 repo-uuid-2]", ids)
	}
}

func TestGetLabeledRepoIDs_EmptyRepositoryIDs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{
			"nextPage": null,
			"results": [{
				"id": "label-uuid-123",
				"name": "exclude-from-license-policy",
				"repository_ids": [],
				"has_security_policy": false,
				"has_license_policy": true
			}]
		}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	ids, err := c.GetLabeledRepoIDs(context.Background(), "label-uuid-123")
	if err != nil {
		t.Fatalf("GetLabeledRepoIDs() error = %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("len(ids) = %d, want 0", len(ids))
	}
}

func TestGetLabeledRepoIDs_EmptyResults(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"nextPage": null, "results": []}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	_, err := c.GetLabeledRepoIDs(context.Background(), "label-uuid-123")
	if err == nil {
		t.Fatal("GetLabeledRepoIDs() expected error for empty results, got nil")
	}
}

func TestGetLabeledRepoIDs_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"unauthorized"}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	_, err := c.GetLabeledRepoIDs(context.Background(), "label-uuid-123")
	if err == nil {
		t.Fatal("GetLabeledRepoIDs() expected error for 401, got nil")
	}
	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("error type = %T, want *APIError", err)
	}
	if apiErr.StatusCode != http.StatusUnauthorized {
		t.Errorf("StatusCode = %d, want %d", apiErr.StatusCode, http.StatusUnauthorized)
	}
}

func TestAssociateLabel_AlreadyLabeled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		w.Write([]byte(`{"error":"already associated"}`))
	}))
	defer srv.Close()

	c := NewClient("test-key", "test-org", WithBaseURL(srv.URL))
	err := c.AssociateLabel(context.Background(), "lid", "rid")
	if !errors.Is(err, ErrAlreadyLabeled) {
		t.Fatalf("error = %v, want ErrAlreadyLabeled", err)
	}
}
