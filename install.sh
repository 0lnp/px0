#!/usr/bin/env sh
# Universal installer script for px0 (https://px0.ai)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/px0-ai/px0/master/install.sh | bash
#
# Environment variables:
#   VERSION      - target version to install (e.g. "0.1.0" or "latest", default: "latest")
#   INSTALL_DIR  - target directory for binary (default: /usr/local/bin or ~/.local/bin)
#   PX0_REPO     - GitHub repository (default: px0-ai/px0)

set -eu

REPO="${PX0_REPO:-px0-ai/px0}"
VERSION="${VERSION:-latest}"

# Color codes
BOLD="\033[1m"
GREEN="\033[38;5;71m"
AMBER="\033[38;5;208m"
RED="\033[38;5;167m"
DIM="\033[38;5;245m"
RESET="\033[0m"

# %b so color codes embedded in messages are interpreted
log_info() {
  printf " ${GREEN}✓${RESET} %b\n" "$1"
}

log_step() {
  printf " ${AMBER}›${RESET} %b\n" "$1"
}

log_warn() {
  printf " ${AMBER}!${RESET} %b\n" "$1"
}

log_error() {
  printf " ${RED}✗${RESET} %b\n" "$1" >&2
}

# 1. Detect OS
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$OS" in
  linux*)   OS="linux" ;;
  darwin*)  OS="darwin" ;;
  freebsd*) OS="freebsd" ;;
  openbsd*) OS="openbsd" ;;
  netbsd*)  OS="netbsd" ;;
  msys*|cygwin*|mingw*) OS="windows" ;;
  *)
    log_error "Unsupported operating system: $OS"
    exit 1
    ;;
esac

# 2. Detect Architecture
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)    ARCH="amd64" ;;
  aarch64|arm64)   ARCH="arm64" ;;
  armv7*|armv6*|arm) ARCH="arm" ;;
  i386|i686)       ARCH="386" ;;
  riscv64)         ARCH="riscv64" ;;
  *)
    log_error "Unsupported machine architecture: $ARCH"
    exit 1
    ;;
esac

# 3. HTTP Client detection
fetch() {
  url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 10 --max-time 30 --retry 2 "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- -T 15 -t 3 "$url"
  else
    log_error "Neither curl nor wget found in PATH. Please install one of them."
    exit 1
  fi
}

fetch_file() {
  url="$1"
  out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 10 --max-time 300 --retry 2 -o "$out" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 30 -t 3 -O "$out" "$url"
  fi
}

log_step "Detecting latest release for ${BOLD}${REPO}${RESET} (${OS}/${ARCH})..."

# 4. Resolve latest version if not explicitly provided
if [ "$VERSION" = "latest" ]; then
  RELEASE_JSON=$(fetch "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null || true)
  if [ -n "$RELEASE_JSON" ]; then
    VERSION=$(printf '%s' "$RELEASE_JSON" | grep '"tag_name":' | head -n 1 | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/' | sed 's/^v//')
  fi
  # Fallback to VERSION file in master if release API returned empty/rate-limited
  if [ -z "$VERSION" ] || [ "$VERSION" = "latest" ]; then
    VERSION=$(fetch "https://raw.githubusercontent.com/${REPO}/master/VERSION" 2>/dev/null | tr -d ' \r\n' || true)
  fi
fi

if [ -z "$VERSION" ]; then
  log_error "Could not determine target version. Check your network or specify VERSION=x.y.z."
  exit 1
fi

BINARY_EXT=""
[ "$OS" = "windows" ] && BINARY_EXT=".exe"
BINARY_NAME="px0-${VERSION}-${OS}-${ARCH}${BINARY_EXT}"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${BINARY_NAME}"

# Fallback download url without 'v' prefix in tag if needed
FALLBACK_URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY_NAME}"

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t 'px0install')"
trap 'rm -rf "$TMP_DIR"' EXIT

log_step "Downloading ${BINARY_NAME}..."
TMP_FILE="${TMP_DIR}/px0"

if ! fetch_file "$DOWNLOAD_URL" "$TMP_FILE" 2>/dev/null; then
  if ! fetch_file "$FALLBACK_URL" "$TMP_FILE" 2>/dev/null; then
    log_error "Failed to download binary from $DOWNLOAD_URL"
    log_warn "If this version is newly tagged, the GitHub Action release build may still be compiling."
    exit 1
  fi
fi

chmod +x "$TMP_FILE"

# 5. Determine installation target directory
if [ -n "${INSTALL_DIR:-}" ]; then
  TARGET_DIR="$INSTALL_DIR"
elif [ -w "/usr/local/bin" ]; then
  TARGET_DIR="/usr/local/bin"
elif command -v sudo >/dev/null 2>&1 && [ -d "/usr/local/bin" ]; then
  USE_SUDO=1
  TARGET_DIR="/usr/local/bin"
else
  # Fallback to ~/.local/bin or ~/bin
  TARGET_DIR="${HOME}/.local/bin"
  mkdir -p "$TARGET_DIR"
fi

TARGET_BIN="${TARGET_DIR}/px0${BINARY_EXT}"
log_step "Installing to ${BOLD}${TARGET_BIN}${RESET}..."

if [ "${USE_SUDO:-0}" = "1" ]; then
  sudo mv "$TMP_FILE" "$TARGET_BIN"
  sudo chmod 755 "$TARGET_BIN"
else
  mkdir -p "$TARGET_DIR"
  mv "$TMP_FILE" "$TARGET_BIN"
  chmod 755 "$TARGET_BIN"
fi

log_info "px0 v${VERSION} installed successfully!"

# Check if TARGET_DIR is in PATH
case ":$PATH:" in
  *":$TARGET_DIR:"*) ;;
  *)
    log_warn "${TARGET_DIR} is not in your PATH."
    printf "   Add it by running:\n"
    printf "     export PATH=\"%s:\$PATH\"\n\n" "$TARGET_DIR"
    ;;
esac

printf "\nRun %b to inspect any repository:\n" "${BOLD}px0${RESET}"
printf "  ${AMBER}px0 .${RESET}\n\n"
