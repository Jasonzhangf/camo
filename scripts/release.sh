#!/bin/bash
# Release script for camo CLI
# Usage: ./scripts/release.sh [patch|minor|major]

set -e

RELEASE_TYPE="${1:-patch}"

# Ensure we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
  echo "Error: Must be on main or master branch"
  exit 1
fi

# Ensure working tree is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Pull latest
git pull --rebase

# Bump version
echo "Bumping version..."
npm run version:bump

# Get new version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "New version: $NEW_VERSION"

# Run tests
echo "Running tests..."
npm test

# Build
echo "Building..."
npm run build

# Commit version bump
git add package.json
git commit -m "chore: release v$NEW_VERSION"

# Create tag
git tag "v$NEW_VERSION"

# Push commit and tag
echo "Pushing to remote..."
git push origin HEAD
git push origin "v$NEW_VERSION"

echo "Release v$NEW_VERSION created successfully!"
echo "GitHub Actions will automatically publish to npm."
