#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-1.0.0}"
TAG="v${VERSION}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required but not installed." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not installed." >&2
  exit 1
fi

if [[ ! -f "package.json" ]]; then
  echo "This script must be run from the project root." >&2
  exit 1
fi

echo "==> Building Kinoshift ${VERSION}"
npm install
npm run dist

if [[ ! -d dist ]]; then
  echo "dist/ folder not found after build." >&2
  exit 1
fi

ARTIFACTS=()
for file in dist/*.dmg dist/*.exe; do
  if [[ -f "$file" ]]; then
    ARTIFACTS+=("$file")
  fi
done

if [[ ${#ARTIFACTS[@]} -eq 0 ]]; then
  echo "No release artifacts were produced in dist/." >&2
  exit 1
fi

echo "==> Preparing GitHub release ${TAG}"
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "Release ${TAG} already exists. Updating assets..."
  gh release upload "$TAG" "${ARTIFACTS[@]}" --clobber
else
  gh release create "$TAG" "${ARTIFACTS[@]}" \
    --title "Kinoshift ${TAG}" \
    --notes-file RELEASE_NOTES.md
fi

echo "==> Done. Release available at:"
gh release view "$TAG" --json url --jq '.url'
