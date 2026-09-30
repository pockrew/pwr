#!/usr/bin/env bash
# Starts a release of the root package.json version from the local machine using plain git.
# Verifies locally, then pushes main and a vX.Y.Z tag; the tag push runs .github/workflows/release.yml,
# which builds the cross-platform binaries and publishes the GitHub release with its own token.
#
# Usage: scripts/publish-release.sh [--skip-checks] [--dry-run]
#   --skip-checks  skip typecheck/lint/tests (CI runs them again before publishing)
#   --dry-run      run everything except creating and pushing the tag
set -euo pipefail

cd "$(dirname "$0")/.."

skip_checks=false
dry_run=false
for arg in "$@"; do
  case "$arg" in
    --skip-checks) skip_checks=true ;;
    --dry-run) dry_run=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

for cmd in bun jq git; do
  command -v "$cmd" > /dev/null || { echo "missing required command: $cmd" >&2; exit 1; }
done

version="$(jq -r .version package.json)"
tag="v${version}"
branch="$(git rev-parse --abbrev-ref HEAD)"

[ "$branch" = "main" ] || { echo "must be on main (on ${branch})" >&2; exit 1; }
# [ -z "$(git status --porcelain)" ] || { echo "working tree is not clean" >&2; exit 1; }

# Releases are tagged only once, so an existing tag means this version is already released.
if git ls-remote --exit-code --tags origin "refs/tags/${tag}" > /dev/null; then
  echo "${tag} is already tagged on origin; nothing to do." >&2
  exit 1
fi

# CI publishes this version's CHANGELOG section as the release notes; fail before tagging.
grep -q "^## ${tag} " CHANGELOG.md || { echo "CHANGELOG.md has no '## ${tag} ' section" >&2; exit 1; }

echo "==> Releasing ${tag}"

if [ "$skip_checks" = false ]; then
  bun install --frozen-lockfile
  bun run typecheck
  bun run lint
  bun run lint:rules
  bun run notices:check
  # Server routing tests serve the Admin build from apps/server/public, so build first.
  bun run build:server
  bun test
fi

if [ "$dry_run" = true ]; then
  echo "==> Dry run: checks passed; skipped pushing main and ${tag}."
  exit 0
fi

# 1. The tagged commit must exist on the remote.
git push origin main
# 2. Pushing the tag starts the Release workflow, which builds and publishes.
git tag "$tag"
git push origin "refs/tags/${tag}"

echo "==> Pushed ${tag}; the Release workflow publishes it: https://github.com/$(
  git remote get-url origin | sed -E 's#\.git$##; s#^.*[:/]([^/:]+/[^/]+)$#\1#'
)/actions/workflows/release.yml"
