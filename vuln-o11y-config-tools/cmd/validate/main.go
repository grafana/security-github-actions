package main

import (
	"flag"
	"log"
	"os"

	"github.com/grafana/vuln-o11y-config-tools/pkg/config"
	"github.com/grafana/vuln-o11y-config-tools/pkg/validate"
)

func main() {
	repoName := os.Getenv("GITHUB_REPOSITORY")
	if repoName == "" {
		log.Fatalf("❌ GITHUB_REPOSITORY is not set")
	}

	file := flag.String("file", "vuln-o11y-config.yaml", "config YAML")
	flag.Parse()

	cfg, err := config.LoadVulnerabilityConfig(*file, repoName)
	if err != nil {
		log.Fatalf("❌ %v", err)
	}
	if err := validate.Validate(cfg); err != nil {
		log.Fatalf("❌ %v", err)
	}
	log.Println("✅ configuration is valid")
}
