WATCHED_ACTIONS='[
      {
        "action": "actions/create-github-app-token",
        "message": "This action will be deprecated. Please migrate to GitHub App Token Broker: https://enghub.grafana-ops.net/docs/default/component/deployment-tools/platform/vault/github-app-token-broker-migration-guide/"
      }
    ]'

echo "::notice::Scanning for watched GitHub actions..."

# Parse JSON array of watched actions
watched_actions_json=$(echo "$WATCHED_ACTIONS" | jq -c '.[]')

# Find all workflow and action files
while IFS= read -r file; do
	workflow_files+=("$file")
done < <(find . -path "**/.github/workflows/*.yml" -o -path "**/.github/workflows/*.yaml" -o -path "**/action.yml" -o -path "**/action.yaml")

detected_count=0

# Check each workflow file for watched actions
for file in "${workflow_files[@]}"; do
	while IFS= read -r action_obj; do
		# Extract action name and custom message from JSON object
		action=$(echo "$action_obj" | jq -r '.action')
		message=$(echo "$action_obj" | jq -r '.message')

		# Skip if action is empty
		[[ -z "$action" ]] && continue

		# Search for the action in the file
		if grep -q "uses:.*$action" "$file"; then
			((detected_count++))
			# Use custom message if provided, otherwise use default
			if [[ "$message" != "null" && -n "$message" ]]; then
				echo "::warning file=$file::Detected watched action '$action': $message"
			else
				echo "::warning file=$file::Detected watched action: $action"
			fi
		fi
	done <<<"$watched_actions_json"
done

# Summary
if [ $detected_count -gt 0 ]; then
	echo "::warning::Found $detected_count instance(s) of watched GitHub actions"
else
	echo "::notice::No watched GitHub actions detected"
fi
