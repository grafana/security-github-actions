package socket

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestPolicySerialization(t *testing.T) {
	policy := LicensePolicy{
		Allow:   []string{"MIT", "Apache-2.0"},
		Warn:    []string{"GPL-2.0"},
		Monitor: []string{"LGPL-2.1"},
		Deny:    []string{"AGPL-3.0"},
		Options: []string{"copyleft"},
	}

	data, err := json.Marshal(policy)
	if err != nil {
		t.Fatalf("failed to marshal LicensePolicy: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	for _, key := range []string{"allow", "warn", "monitor", "deny", "options"} {
		if _, ok := got[key]; !ok {
			t.Errorf("expected key %q in JSON output", key)
		}
	}

	// Round-trip: unmarshal back into struct
	var roundTrip LicensePolicy
	if err := json.Unmarshal(data, &roundTrip); err != nil {
		t.Fatalf("failed to unmarshal back into LicensePolicy: %v", err)
	}

	if len(roundTrip.Allow) != 2 || roundTrip.Allow[0] != "MIT" || roundTrip.Allow[1] != "Apache-2.0" {
		t.Errorf("Allow mismatch: got %v", roundTrip.Allow)
	}
	if len(roundTrip.Warn) != 1 || roundTrip.Warn[0] != "GPL-2.0" {
		t.Errorf("Warn mismatch: got %v", roundTrip.Warn)
	}
	if len(roundTrip.Monitor) != 1 || roundTrip.Monitor[0] != "LGPL-2.1" {
		t.Errorf("Monitor mismatch: got %v", roundTrip.Monitor)
	}
	if len(roundTrip.Deny) != 1 || roundTrip.Deny[0] != "AGPL-3.0" {
		t.Errorf("Deny mismatch: got %v", roundTrip.Deny)
	}
	if len(roundTrip.Options) != 1 || roundTrip.Options[0] != "copyleft" {
		t.Errorf("Options mismatch: got %v", roundTrip.Options)
	}
}

func TestPolicySerializationEmptyFields(t *testing.T) {
	// All fields empty/nil should still serialize correctly
	policy := LicensePolicy{}

	data, err := json.Marshal(policy)
	if err != nil {
		t.Fatalf("failed to marshal empty LicensePolicy: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	// With omitempty, nil slices might be omitted; without it, they should be null.
	// Either way, parsing back should work.
	var roundTrip LicensePolicy
	if err := json.Unmarshal(data, &roundTrip); err != nil {
		t.Fatalf("failed to unmarshal empty policy: %v", err)
	}
}

func TestParseLicensePolicy(t *testing.T) {
	input := `{
		"allow": ["MIT", "BSD-3-Clause"],
		"warn": ["GPL-2.0"],
		"monitor": [],
		"deny": ["AGPL-3.0-only"],
		"options": ["copyleft"]
	}`

	policy, err := ParseLicensePolicy([]byte(input))
	if err != nil {
		t.Fatalf("ParseLicensePolicy failed: %v", err)
	}

	if len(policy.Allow) != 2 {
		t.Errorf("expected 2 allow entries, got %d", len(policy.Allow))
	}
	if policy.Allow[0] != "MIT" {
		t.Errorf("expected first allow to be MIT, got %s", policy.Allow[0])
	}
	if len(policy.Warn) != 1 || policy.Warn[0] != "GPL-2.0" {
		t.Errorf("Warn mismatch: got %v", policy.Warn)
	}
	if len(policy.Monitor) != 0 {
		t.Errorf("expected empty monitor, got %v", policy.Monitor)
	}
	if len(policy.Deny) != 1 || policy.Deny[0] != "AGPL-3.0-only" {
		t.Errorf("Deny mismatch: got %v", policy.Deny)
	}
	if len(policy.Options) != 1 || policy.Options[0] != "copyleft" {
		t.Errorf("Options mismatch: got %v", policy.Options)
	}
}

func TestParseLicensePolicyInvalidJSON(t *testing.T) {
	_, err := ParseLicensePolicy([]byte(`{invalid`))
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestLoadLicensePolicyFromFile(t *testing.T) {
	policy, err := LoadLicensePolicyFromFile("block-agpl-policy.json")
	if err != nil {
		t.Fatalf("LoadLicensePolicyFromFile failed: %v", err)
	}

	// The file has a large allow list, empty warn/monitor, deny list with AGPL/GPL entries, and empty options.
	if len(policy.Allow) == 0 {
		t.Error("expected non-empty allow list")
	}
	if len(policy.Deny) == 0 {
		t.Error("expected non-empty deny list")
	}

	// Verify specific known entries
	foundApache := false
	for _, lic := range policy.Allow {
		if lic == "Apache-2.0" {
			foundApache = true
			break
		}
	}
	if !foundApache {
		t.Error("expected Apache-2.0 in allow list")
	}

	foundAGPL := false
	for _, lic := range policy.Deny {
		if lic == "AGPL-3.0-only" {
			foundAGPL = true
			break
		}
	}
	if !foundAGPL {
		t.Error("expected AGPL-3.0-only in deny list")
	}

	if len(policy.Warn) != 0 {
		t.Errorf("expected empty warn list, got %d entries", len(policy.Warn))
	}
	if len(policy.Monitor) != 0 {
		t.Errorf("expected empty monitor list, got %d entries", len(policy.Monitor))
	}
	if len(policy.Options) != 0 {
		t.Errorf("expected empty options list, got %d entries", len(policy.Options))
	}
}

func TestLoadLicensePolicyFromFileMissing(t *testing.T) {
	_, err := LoadLicensePolicyFromFile("nonexistent-file.json")
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

func TestUpdateLicensePolicy(t *testing.T) {
	requestPolicy := LicensePolicy{
		Allow:   []string{"MIT", "Apache-2.0"},
		Warn:    []string{"GPL-2.0"},
		Monitor: []string{},
		Deny:    []string{"AGPL-3.0"},
		Options: []string{},
	}

	responsePolicy := LicensePolicy{
		Allow:   []string{"MIT", "Apache-2.0", "BSD-3-Clause"},
		Warn:    []string{"GPL-2.0"},
		Monitor: []string{},
		Deny:    []string{"AGPL-3.0"},
		Options: []string{},
	}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify method
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}

		// Verify URL path
		expectedPath := "/orgs/test-org/settings/license-policy"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %q, got %q", expectedPath, r.URL.Path)
		}

		// Verify query param
		mergeUpdate := r.URL.Query().Get("merge_update")
		if mergeUpdate != "true" {
			t.Errorf("expected merge_update=true, got %q", mergeUpdate)
		}

		// Verify auth header
		authHeader := r.Header.Get("Authorization")
		if authHeader != "Bearer test-api-key" {
			t.Errorf("expected Bearer test-api-key, got %q", authHeader)
		}

		// Verify content type
		contentType := r.Header.Get("Content-Type")
		if contentType != "application/json" {
			t.Errorf("expected Content-Type application/json, got %q", contentType)
		}

		// Verify request body
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("failed to read request body: %v", err)
		}
		defer r.Body.Close()

		var gotPolicy LicensePolicy
		if err := json.Unmarshal(body, &gotPolicy); err != nil {
			t.Fatalf("failed to unmarshal request body: %v", err)
		}

		if len(gotPolicy.Allow) != 2 || gotPolicy.Allow[0] != "MIT" {
			t.Errorf("request body Allow mismatch: got %v", gotPolicy.Allow)
		}
		if len(gotPolicy.Deny) != 1 || gotPolicy.Deny[0] != "AGPL-3.0" {
			t.Errorf("request body Deny mismatch: got %v", gotPolicy.Deny)
		}

		// Write response
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(responsePolicy)
	}))
	defer ts.Close()

	client := NewClient("test-api-key", "test-org", WithBaseURL(ts.URL))

	got, err := client.UpdateLicensePolicy(context.Background(), requestPolicy, true)
	if err != nil {
		t.Fatalf("UpdateLicensePolicy failed: %v", err)
	}

	// Verify the response was parsed correctly
	if len(got.Allow) != 3 {
		t.Errorf("expected 3 allow entries in response, got %d", len(got.Allow))
	}
	if got.Allow[2] != "BSD-3-Clause" {
		t.Errorf("expected third allow entry to be BSD-3-Clause, got %s", got.Allow[2])
	}
}

func TestUpdateLicensePolicyMergeUpdateFalse(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mergeUpdate := r.URL.Query().Get("merge_update")
		if mergeUpdate != "false" {
			t.Errorf("expected merge_update=false, got %q", mergeUpdate)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(LicensePolicy{})
	}))
	defer ts.Close()

	client := NewClient("test-api-key", "test-org", WithBaseURL(ts.URL))

	_, err := client.UpdateLicensePolicy(context.Background(), LicensePolicy{}, false)
	if err != nil {
		t.Fatalf("UpdateLicensePolicy failed: %v", err)
	}
}

func TestUpdateLicensePolicyError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error": "insufficient permissions"}`))
	}))
	defer ts.Close()

	client := NewClient("bad-key", "test-org", WithBaseURL(ts.URL))

	_, err := client.UpdateLicensePolicy(context.Background(), LicensePolicy{}, true)
	if err == nil {
		t.Fatal("expected error for 403 response, got nil")
	}

	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T: %v", err, err)
	}
	if apiErr.StatusCode != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", apiErr.StatusCode)
	}
}

func TestUpdateLicensePolicyNotFound(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`not found`))
	}))
	defer ts.Close()

	client := NewClient("test-key", "test-org", WithBaseURL(ts.URL))

	_, err := client.UpdateLicensePolicy(context.Background(), LicensePolicy{}, true)
	if err == nil {
		t.Fatal("expected error for 404 response, got nil")
	}

	// doRequest returns a plain error for 404, not *APIError
	if err.Error() != "not found" {
		t.Errorf("expected 'not found' error, got %q", err.Error())
	}
}

// TestLoadLicensePolicyFromFileTempFile tests with a temporary file to ensure
// the function works with arbitrary paths, not just the fixture.
func TestLoadLicensePolicyFromFileTempFile(t *testing.T) {
	content := `{"allow":["MIT"],"warn":[],"monitor":[],"deny":["GPL-3.0"],"options":["copyleft"]}`

	tmpFile, err := os.CreateTemp("", "policy-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(content); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	tmpFile.Close()

	policy, err := LoadLicensePolicyFromFile(tmpFile.Name())
	if err != nil {
		t.Fatalf("LoadLicensePolicyFromFile failed: %v", err)
	}

	if len(policy.Allow) != 1 || policy.Allow[0] != "MIT" {
		t.Errorf("Allow mismatch: got %v", policy.Allow)
	}
	if len(policy.Deny) != 1 || policy.Deny[0] != "GPL-3.0" {
		t.Errorf("Deny mismatch: got %v", policy.Deny)
	}
	if len(policy.Options) != 1 || policy.Options[0] != "copyleft" {
		t.Errorf("Options mismatch: got %v", policy.Options)
	}
}
