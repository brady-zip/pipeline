#!/bin/bash
set -e

# Skip if merge commit
if [ -f .git/MERGE_HEAD ]; then
  exit 0
fi

# Get the commit message
COMMIT_MSG=$(git log -1 --pretty=%B)

# Skip conditions
if [[ "$COMMIT_MSG" == *"[skip-version]"* ]]; then
  exit 0
fi

if [[ "$COMMIT_MSG" =~ ^chore: ]] || [[ "$COMMIT_MSG" =~ ^refactor: ]]; then
  exit 0
fi

# Get the diff for the last commit
DIFF=$(git diff HEAD~1 HEAD --no-color 2>/dev/null || exit 0)

if [ -z "$DIFF" ]; then
  exit 0
fi

# Ask LLM for semver bump type
PROMPT="Analyze this git diff and determine the semantic version bump type.

Rules:
- MAJOR: Breaking changes (removed/renamed exports, changed function signatures, removed features)
- MINOR: New features, new exports, new optional parameters
- PATCH: Bug fixes, internal refactors, documentation, dependency updates

Respond with exactly one word: MAJOR, MINOR, or PATCH

Diff:
$DIFF"

BUMP_TYPE=$(echo "$PROMPT" | uvx llm -m gpt-4o-mini 2>/dev/null | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')

# Validate response
if [[ ! "$BUMP_TYPE" =~ ^(MAJOR|MINOR|PATCH)$ ]]; then
  echo "auto-version: LLM returned invalid bump type: $BUMP_TYPE"
  exit 0
fi

# Get current version
CURRENT_VERSION=$(jq -r '.version' package.json)

# Parse version components
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Calculate new version
case "$BUMP_TYPE" in
  MAJOR)
    NEW_VERSION="$((MAJOR + 1)).0.0"
    ;;
  MINOR)
    NEW_VERSION="$MAJOR.$((MINOR + 1)).0"
    ;;
  PATCH)
    NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
    ;;
esac

# Update package.json
TMP=$(mktemp)
jq --arg v "$NEW_VERSION" '.version = $v' package.json > "$TMP" && mv "$TMP" package.json

# Commit the version bump
git add package.json
git commit -m "chore: bump to v$NEW_VERSION [skip-version]"

echo "auto-version: bumped $CURRENT_VERSION -> $NEW_VERSION ($BUMP_TYPE)"
