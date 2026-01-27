#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
PACKAGE_NAME="exoagent"

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run|-n)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--dry-run|-n]"
      exit 1
      ;;
  esac
done

# Get current published version from npm
CURRENT=$(npm view "$PACKAGE_NAME" version)
echo "Current published version: $CURRENT"

# Bump patch version
NEXT=$(npx semver "$CURRENT" -i patch)
echo "Next version: $NEXT"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "[DRY RUN] Would run:"
  echo "  npm version $NEXT --no-git-tag-version"
  echo "  npm publish"
  echo ""
  echo "No changes made."
else
  npm version "$NEXT" --no-git-tag-version
  npm publish
  echo ""
  echo "Published $PACKAGE_NAME@$NEXT"
fi
