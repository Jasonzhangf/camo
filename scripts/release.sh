#!/bin/bash
# Release script for camo CLI
# Usage: ./scripts/release.sh [patch|minor|major]

set -e

RELEASE_TYPE="${1:-patch}"

# Fail before any local or remote mutation if GitHub Release creation is unavailable.
if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required to create the release"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: GitHub CLI is not authenticated"
  exit 1
fi

if ! gh repo view --json nameWithOwner >/dev/null 2>&1; then
  echo "Error: GitHub CLI cannot access the current repository"
  exit 1
fi

create_or_verify_release() {
  local tag="$1"
  local attempt

  for attempt in 1 2 3; do
    if gh release create "$tag" \
      --verify-tag \
      --title "$tag" \
      --notes "Release $tag"; then
      break
    fi
    if gh release view "$tag" --json tagName >/dev/null 2>&1; then
      break
    fi
    echo "GitHub Release creation attempt $attempt failed; retrying..."
    sleep "$attempt"
  done

  if ! gh release view "$tag" --json tagName >/dev/null 2>&1; then
    echo "Error: GitHub Release $tag was not created; commit/tag remain pushed."
    echo "Re-run this script to recover the release for the existing tag."
    return 1
  fi
}

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

# Recover the current version's release before bumping to a new version.
CURRENT_VERSION=$(node -p "require('./package.json').version")
CURRENT_TAG="v$CURRENT_VERSION"
if git rev-parse --verify --quiet "refs/tags/$CURRENT_TAG" >/dev/null; then
  if ! gh release view "$CURRENT_TAG" --json tagName >/dev/null 2>&1; then
    echo "Recovering missing GitHub Release for existing local tag $CURRENT_TAG..."
    create_or_verify_release "$CURRENT_TAG"
    echo "Release $CURRENT_TAG is present."
    exit 0
  fi
fi

# Bump version
echo "Bumping version..."
npm run version:bump

# Get new version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "New version: $NEW_VERSION"
TAG="v$NEW_VERSION"

if git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  if [ "$(git rev-parse "$TAG")" != "$(git rev-parse HEAD)" ]; then
    echo "Error: local tag $TAG does not point at HEAD"
    exit 1
  fi
  echo "Error: tag $TAG already exists after version bump"
  exit 1
fi

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
git tag "$TAG"

# Push commit and tag
echo "Pushing to remote..."
git push origin HEAD
git push origin "$TAG"

echo "Creating GitHub Release..."
create_or_verify_release "$TAG"

echo "Release $TAG created successfully!"
echo "GitHub Actions will automatically publish to npm."
