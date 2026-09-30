#!/usr/bin/env bash
# ==============================================================================
# PWR installer: downloads the `pwr` CLI and `pwr-agent` daemon for this platform
# from GitHub Releases, verifies their SHA-256 checksums, and installs them.
#
#   curl -fsSL https://raw.githubusercontent.com/pockrew/pwr/main/install.sh | bash
#
# Options (pass after `bash -s --` when piping):
#   --version <vX.Y.Z>   Install a specific release (default: latest)
#   --prefix <dir>       Install directory (default: ~/.local/bin)
#   --from-source        Build from this checkout with Bun instead of downloading
#   --help               Show this help
# ==============================================================================
set -euo pipefail

REPO="pockrew/pwr"
INSTALL_DIR="${HOME}/.local/bin"
VERSION="latest"
FROM_SOURCE=0

info() { printf '\033[36m•\033[0m %s\n' "$1"; }
ok() { printf '\033[32m✔\033[0m %s\n' "$1"; }
fail() {
  printf '\033[31m✖\033[0m %s\n' "$1" >&2
  exit 1
}
need_value() { [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "$1 needs a value"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      need_value "$@"
      VERSION="$2"
      shift 2
      ;;
    --prefix)
      need_value "$@"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --from-source)
      FROM_SOURCE=1
      shift
      ;;
    --help | -h)
      cat <<'USAGE'
PWR installer. Options:
  --version <vX.Y.Z>   Install a specific release (default: latest)
  --prefix <dir>       Install directory (default: ~/.local/bin)
  --from-source        Build from this checkout with Bun instead of downloading
USAGE
      exit 0
      ;;
    *) fail "Unknown option: $1 (see --help)" ;;
  esac
done

# 1. Platform: macOS and Linux on x64/arm64.
case "$(uname -s)" in
  Darwin) OS="darwin" ;;
  Linux) OS="linux" ;;
  *) fail "Unsupported OS: $(uname -s). PWR supports macOS and Linux." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH="x64" ;;
  arm64 | aarch64) ARCH="arm64" ;;
  *) fail "Unsupported architecture: $(uname -m)" ;;
esac
TARGET="${OS}-${ARCH}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ "$FROM_SOURCE" == 1 ]]; then
  # 2a. Source build from a checkout of this repository.
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [[ -f "$ROOT/package.json" && -d "$ROOT/apps/agent" ]] || fail "--from-source must run from a PWR checkout"
  command -v bun >/dev/null 2>&1 || fail "--from-source needs Bun (https://bun.sh)"
  info "Building from source in $ROOT"
  (cd "$ROOT" && bun install --frozen-lockfile && bun scripts/release.ts --target "$TARGET")
  cp "$ROOT/dist/release/pwr-${TARGET}" "$TMP/pwr"
  cp "$ROOT/dist/release/pwr-agent-${TARGET}" "$TMP/pwr-agent"
else
  # 2b. Download release assets and verify them against the published checksums.
  command -v curl >/dev/null 2>&1 || fail "curl is required"
  if [[ "$VERSION" == "latest" ]]; then
    BASE="https://github.com/${REPO}/releases/latest/download"
  else
    BASE="https://github.com/${REPO}/releases/download/${VERSION}"
  fi
  info "Downloading PWR ${VERSION} for ${TARGET}"
  for name in pwr pwr-agent; do
    curl -fsSL --proto '=https' --tlsv1.2 -o "$TMP/${name}-${TARGET}" "${BASE}/${name}-${TARGET}" ||
      fail "Download failed: ${BASE}/${name}-${TARGET}"
  done
  curl -fsSL --proto '=https' --tlsv1.2 -o "$TMP/SHA256SUMS" "${BASE}/SHA256SUMS" ||
    fail "Download failed: ${BASE}/SHA256SUMS"
  if command -v sha256sum >/dev/null 2>&1; then SHA="sha256sum"; else SHA="shasum -a 256"; fi
  for name in pwr pwr-agent; do
    expected="$(grep " ${name}-${TARGET}\$" "$TMP/SHA256SUMS" | cut -d' ' -f1)"
    actual="$(cd "$TMP" && $SHA "${name}-${TARGET}" | cut -d' ' -f1)"
    [[ -n "$expected" && "$expected" == "$actual" ]] || fail "Checksum mismatch for ${name}-${TARGET}"
    mv "$TMP/${name}-${TARGET}" "$TMP/${name}"
  done
  ok "Checksums verified"
fi

# 3. Stop a running agent before replacing its binary; it resumes stored work on next start.
if command -v pwr >/dev/null 2>&1; then pwr agent stop >/dev/null 2>&1 || true; fi

mkdir -p "$INSTALL_DIR"
install -m 0755 "$TMP/pwr" "$INSTALL_DIR/pwr"
install -m 0755 "$TMP/pwr-agent" "$INSTALL_DIR/pwr-agent"
ok "Installed pwr and pwr-agent to $INSTALL_DIR"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) printf '\nAdd this to your shell profile:\n  export PATH="%s:$PATH"\n' "$INSTALL_DIR" ;;
esac

cat <<'EOF'

Next steps:
  pwr agent start                     # start the local agent (or: pwr agent install-service)
  printf '%s' "$RELAY_KEY" | pwr connect <slug> --server https://<your-server> --api-key -
  pwr studio                          # open the local inspector
EOF
