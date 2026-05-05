package socket

import (
	"context"
	"fmt"
	"encoding/json"
	"os"
)

// LicensePolicy represents a Socket license policy configuration.
type LicensePolicy struct {
	Allow   []string `json:"allow"`
	Warn    []string `json:"warn"`
	Monitor []string `json:"monitor"`
	Deny    []string `json:"deny"`
	Options []string `json:"options"`
}

// ParseLicensePolicy parses raw JSON bytes into a LicensePolicy.
func ParseLicensePolicy(data []byte) (LicensePolicy, error) {
	var policy LicensePolicy
	if err := json.Unmarshal(data, &policy); err != nil {
		return LicensePolicy{}, fmt.Errorf("parsing license policy: %w", err)
	}
	return policy, nil
}

// LoadLicensePolicyFromFile reads a JSON file from disk and parses it into a LicensePolicy.
func LoadLicensePolicyFromFile(path string) (LicensePolicy, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return LicensePolicy{}, fmt.Errorf("reading license policy file: %w", err)
	}
	return ParseLicensePolicy(data)
}

// UpdateLicensePolicy sends the given license policy to the Socket API.
// When mergeUpdate is true, the API merges the policy with the existing one;
// when false, it replaces the existing policy entirely.
func (c *Client) UpdateLicensePolicy(ctx context.Context, policy LicensePolicy, mergeUpdate bool) (LicensePolicy, error) {
	path := fmt.Sprintf("/orgs/%s/settings/license-policy?merge_update=%t", c.Org, mergeUpdate)
	data, err := c.makeAPIPostRequest(ctx, path, policy)
	if err != nil {
		return LicensePolicy{}, err
	}
	return ParseLicensePolicy(data)
}
