package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// LoadVulnerabilityConfig reads a YAML file and unmarshals it into a VulnerabilityConfig
func LoadVulnerabilityConfig(path string, repoName string) (*VulnerabilityConfig, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var cfg VulnerabilityConfig
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("yaml: %w", err)
	}

	// The project name and the repository source name must match the Github repository name
	cfg.Project.Name = repoName
	if cfg.Sources.Repository != nil {
		cfg.Sources.Repository.Name = repoName
	}

	return &cfg, nil
}
