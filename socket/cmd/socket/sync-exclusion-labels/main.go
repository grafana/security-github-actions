package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	socket "github.com/grafana/security-github-actions/socket"
)

const (
	exclusionLabelName = "exclude-from-license-policy"
	defaultGitHubTopic = "socket-exclude"
)

func main() {
	apiKey := mustGetEnv("SOCKET_API_KEY")
	socketOrg := mustGetEnv("SOCKET_ORG")
	githubToken := mustGetEnv("GITHUB_TOKEN")
	githubOrg := envOrDefault("GITHUB_ORG", "grafana")
	githubTopic := envOrDefault("GITHUB_TOPIC", defaultGitHubTopic)

	ctx := context.Background()
	ghClient := socket.NewGitHubClient(githubToken)
	socketClient := socket.NewClient(apiKey, socketOrg)

	label, err := socketClient.GetLabelByName(ctx, exclusionLabelName)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: getting exclusion label from Socket: %v\n", err)
		os.Exit(1)
	}

	repoNames, err := ghClient.SearchReposByTopic(ctx, githubOrg, githubTopic)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: listing GitHub repos with topic %q: %v\n", githubTopic, err)
		os.Exit(1)
	}
	fmt.Printf("Found %d GitHub repos with topic %q\n", len(repoNames), githubTopic)

	var applied, alreadyLabeled, notInSocket, failed int

	for _, repoName := range repoNames {
		repo, err := socketClient.GetRepo(ctx, repoName)
		if err != nil {
			if err.Error() == "not found" {
				fmt.Printf("  [skip] %s: not in Socket org\n", repoName)
				notInSocket++
				continue
			}
			fmt.Fprintf(os.Stderr, "  [error] %s: fetching from Socket: %v\n", repoName, err)
			failed++
			continue
		}

		if err := socketClient.AssociateLabel(ctx, label.ID, repo.ID); err != nil {
			if errors.Is(err, socket.ErrAlreadyLabeled) {
				fmt.Printf("  [skip] %s: exclusion label already applied\n", repoName)
				alreadyLabeled++
				continue
			}
			fmt.Fprintf(os.Stderr, "  [error] %s: applying exclusion label: %v\n", repoName, err)
			failed++
			continue
		}

		fmt.Printf("  [done] %s: exclusion label applied\n", repoName)
		applied++
	}

	fmt.Printf("\nSummary: %d applied, %d already labeled, %d not in Socket, %d failed\n",
		applied, alreadyLabeled, notInSocket, failed)

	if failed > 0 {
		os.Exit(1)
	}
}

func mustGetEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		fmt.Fprintf(os.Stderr, "error: %s environment variable is required\n", key)
		os.Exit(1)
	}
	return v
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
