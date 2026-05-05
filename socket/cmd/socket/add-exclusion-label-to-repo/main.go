package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	socket "github.com/grafana/security-github-actions/socket"
)

const exclusionLabelName = "exclude-from-license-policy"

func main() {
	repoName := flag.String("repo", "", "Repository name to add exclusion label to (required)")
	flag.Parse()

	if *repoName == "" {
		fmt.Fprintln(os.Stderr, "error: --repo is required")
		os.Exit(1)
	}

	apiKey := os.Getenv("SOCKET_API_KEY")
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "error: SOCKET_API_KEY environment variable is required")
		os.Exit(1)
	}

	org := os.Getenv("SOCKET_ORG")
	if org == "" {
		fmt.Fprintln(os.Stderr, "error: SOCKET_ORG environment variable is required")
		os.Exit(1)
	}

	client := socket.NewClient(apiKey, org)
	ctx := context.Background()

	repo, err := client.GetRepo(ctx, *repoName)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: repo %q not found in Socket org: %v\n", *repoName, err)
		os.Exit(1)
	}

	label, err := client.GetLabelByName(ctx, exclusionLabelName)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: label %q not found in Socket org: %v\n", exclusionLabelName, err)
		os.Exit(1)
	}

	if err := client.AssociateLabel(ctx, label.ID, repo.ID); err != nil {
		fmt.Fprintf(os.Stderr, "error: associating exclusion label with repo %q: %v\n", *repoName, err)
		os.Exit(1)
	}

	fmt.Printf("Successfully added exclusion label to repo %q\n", *repoName)
}
