package validate_test

import (
	"path/filepath"
	"testing"

	"github.com/grafana/vuln-o11y-config-tools/pkg/config"
	"github.com/grafana/vuln-o11y-config-tools/pkg/validate"
)

func TestValidateYAMLFiles(t *testing.T) {
	cases := []struct {
		file    string
		wantErr bool
	}{
		{"valid.yaml", false},
		{"valid_multi.yaml", false},
		{"invalid_scan_strategy.yaml", true},
		{"invalid_owner.yaml", true},
	}

	base := "testdata"
	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			full := filepath.Join(base, tc.file)

			cfg, err := config.LoadVulnerabilityConfig(full, "test-repo")
			if err != nil {
				t.Fatalf("read/unmarshal: %v", err)
			}

			err = validate.Validate(cfg)

			if tc.wantErr && err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
