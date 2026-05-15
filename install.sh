#!/usr/bin/env bash
# CodexHub installer — gold standard one-liner install
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/mahdi-awadi/codexhub/main/install.sh | bash
# Or:
#   ./install.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Config
REPO="mahdi-awadi/codexhub"
INSTALL_DIR="${CODEXHUB_DIR:-$HOME/.codexhub}"
CONFIG_DIR="${CODEXHUB_DATA:-$HOME/.codexhub/data}"

log() { echo -e "${BLUE}==>${NC} ${BOLD}$*${NC}"; }
ok()  { echo -e "${GREEN}✓${NC} $*"; }
warn(){ echo -e "${YELLOW}⚠${NC} $*"; }
err() { echo -e "${RED}✗${NC} $*" >&2; }
die() { err "$*"; exit 1; }

# ─── Header ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}CodexHub Installer${NC}"
echo "Multi-session hub for Codex"
echo ""

# ─── Prerequisites ───────────────────────────────────────────────────────────
log "Checking prerequisites"

# 1. Detect OS
OS="$(uname -s)"
case "$OS" in
  Linux*)  PLATFORM=linux ;;
  Darwin*) PLATFORM=macos ;;
  *)       die "Unsupported OS: $OS (supported: Linux, macOS)" ;;
esac
ok "Platform: $PLATFORM"

# 2. Check git
if ! command -v git >/dev/null 2>&1; then
  die "git is required but not installed. Install it first: https://git-scm.com"
fi
ok "git: $(git --version | head -1)"

# 3. Check/install Bun
if ! command -v bun >/dev/null 2>&1; then
  warn "Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  if ! command -v bun >/dev/null 2>&1; then
    die "Bun install failed. Install manually: https://bun.sh"
  fi
fi
ok "bun: $(bun --version)"

# 4. Check tmux (required for daemon and session management)
if ! command -v tmux >/dev/null 2>&1; then
  err "tmux is required but not installed."
  echo "  Install: apt install tmux  (Debian/Ubuntu)"
  echo "           dnf install tmux  (RHEL/Fedora)"
  echo "           brew install tmux (macOS)"
  die "Please install tmux and re-run"
fi
ok "tmux: $(tmux -V)"

# 5. Check Codex
if ! command -v codex >/dev/null 2>&1; then
  warn "Codex CLI not found."
  echo "  (You can still install CodexHub; set up Codex later)"
fi

echo ""

# ─── Clone / Update ──────────────────────────────────────────────────────────
log "Installing CodexHub to $INSTALL_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
  ok "Existing install found, updating..."
  git -C "$INSTALL_DIR" pull --ff-only || warn "Could not update (local changes?)"
else
  git clone "https://github.com/$REPO.git" "$INSTALL_DIR"
fi

# ─── Install Dependencies ────────────────────────────────────────────────────
log "Installing dependencies"
cd "$INSTALL_DIR"
bun install --no-summary
ok "Dependencies installed"

# ─── Create Config ───────────────────────────────────────────────────────────
log "Setting up config"
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

if [ -f "$CONFIG_DIR/config.json" ]; then
  ok "Config already exists at $CONFIG_DIR/config.json"
else
  cat > "$CONFIG_DIR/config.json" << 'EOF'
{
  "webPort": 3000,
  "telegramToken": "",
  "telegramBotUsername": "mahdicodexbot",
  "telegramFrontendEnabled": false,
  "telegramAllowFrom": [],
  "rubikaToken": "",
  "rubikaBotUsername": "mahdicodexhub",
  "rubikaAllowFrom": [],
  "rubikaWebhookBase": "",
  "defaultTrust": "ask",
  "defaultUploadDir": "."
}
EOF
  chmod 600 "$CONFIG_DIR/config.json"
  ok "Created config template at $CONFIG_DIR/config.json"
fi

# ─── Install CLI ─────────────────────────────────────────────────────────────
log "Installing codexhub command"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/codexhub" << EOF
#!/usr/bin/env bash
# CodexHub CLI wrapper
INSTALL_DIR="$INSTALL_DIR"

case "\${1:-}" in
  start)
    tmux kill-session -t hub-daemon 2>/dev/null || true
    tmux new-session -d -s hub-daemon "bun run \$INSTALL_DIR/src/daemon.ts"
    echo "CodexHub daemon started (tmux session: hub-daemon)"
    ;;
  stop)
    tmux kill-session -t hub-daemon 2>/dev/null && echo "Stopped" || echo "Not running"
    ;;
  restart)
    "\$0" stop
    sleep 1
    "\$0" start
    ;;
  status)
    if tmux has-session -t hub-daemon 2>/dev/null; then
      echo "Running (tmux session: hub-daemon)"
      tmux list-sessions | grep hub-
    else
      echo "Not running"
    fi
    ;;
  attach)
    tmux attach -t hub-daemon
    ;;
  logs)
    tmux capture-pane -t hub-daemon -p
    ;;
  update)
    cd "\$INSTALL_DIR" && git pull && bun install --no-summary
    echo "Updated. Run 'codexhub restart' to apply."
    ;;
  *)
    # Pass through to the hub CLI tool
    HUB_URL="\${HUB_URL:-http://localhost:3000}" bun run "\$INSTALL_DIR/src/cli.ts" "\$@"
    ;;
esac
EOF
chmod +x "$BIN_DIR/codexhub"
ok "Installed: $BIN_DIR/codexhub"

# Check if BIN_DIR is in PATH
if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  warn "$BIN_DIR is not in your PATH"
  echo "  Add this to your shell config (~/.bashrc or ~/.zshrc):"
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✓ CodexHub installed successfully${NC}"
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo ""
echo "  1. Configure your Telegram bot (optional):"
echo "     - Create a bot with @BotFather on Telegram"
echo "     - Get your user ID from @userinfobot"
echo "     - Edit: $CONFIG_DIR/config.json"
echo ""
echo "  2. Start the daemon:"
echo "     ${BLUE}codexhub start${NC}"
echo ""
echo "  3. Connect Codex (from any project):"
echo "     ${BLUE}codex${NC}"
echo ""
echo "  4. Open the web dashboard:"
echo "     ${BLUE}http://localhost:3000${NC}"
echo ""
echo -e "${BOLD}Commands:${NC}"
echo "  codexhub start    # Start daemon"
echo "  codexhub stop     # Stop daemon"
echo "  codexhub status   # Check status"
echo "  codexhub attach   # View daemon logs"
echo "  codexhub update   # Update to latest"
echo "  codexhub list     # List sessions"
echo ""
echo "Documentation: https://github.com/$REPO"
