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
	defaultGitHubTopic = "socket-exclude-from-license-policy"
)

// Sync is intentionally one-directional: it only adds the Socket exclusion label
// to repos that carry the GitHub topic. It never removes the label when the topic
// is absent. Removal requires a prior backfill — applying the GitHub topic to every
// repo that already has the Socket label — so that both sides agree before a
// bidirectional sync can run safely.

func main() {
	apiKey := mustGetEnv("SOCKET_API_KEY")
	socketOrg := mustGetEnv("SOCKET_ORG")
	githubToken := mustGetEnv("GITHUB_TOKEN")
	githubOrg := envOrDefault("GITHUB_ORG", "grafana")
	githubTopic := envOrDefault("GITHUB_TOPIC", defaultGitHubTopic)

	ctx := context.Background()
	ghClient := socket.NewGitHubClient(githubToken)
	socketClient := socket.NewClient(apiKey, socketOrg)

	// Fetch the exclusion label from Socket.
	label, err := socketClient.GetLabelByName(ctx, exclusionLabelName)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: getting exclusion label from Socket: %v\n", err)
		os.Exit(1)
	}

	// Fetch all GitHub repos in the org that carry the exclusion topic.
	githubRepos, err := ghClient.ListOrgReposWithTopic(ctx, githubOrg, githubTopic)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: listing GitHub repos with topic %q: %v\n", githubTopic, err)
		os.Exit(1)
	}
	fmt.Printf("Found %d GitHub repos with topic %q\n", len(githubRepos), githubTopic)

	// Fetch the IDs of Socket repos that already have the exclusion label applied.
	labeledIDs, err := socketClient.GetLabeledRepoIDs(ctx, label.ID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: fetching Socket repos with exclusion label: %v\n", err)
		os.Exit(1)
	}
	labeledIDSet := make(map[string]bool, len(labeledIDs))
	for _, id := range labeledIDs {
		labeledIDSet[id] = true
	}
	fmt.Printf("Found %d Socket repos already carrying the exclusion label\n", len(labeledIDs))

	// Apply the label to any GitHub repo not yet covered in Socket.
	var applied, skipped, notInSocket, failed int

	for _, repoName := range githubRepos {
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

		if labeledIDSet[repo.ID] {
			fmt.Printf("  [skip] %s: exclusion label already applied\n", repoName)
			skipped++
			continue
		}

		if err := socketClient.AssociateLabel(ctx, label.ID, repo.ID); err != nil {
			// Guard against concurrent runs labeling the same repo simultaneously.
			if errors.Is(err, socket.ErrAlreadyLabeled) {
				fmt.Printf("  [skip] %s: exclusion label already applied\n", repoName)
				skipped++
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
		applied, skipped, notInSocket, failed)

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
