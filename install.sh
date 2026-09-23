#!/usr/bin/env bash
# jev-pilot installer — macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Akramovic1/jev-pilot/main/install.sh | bash
#   ./install.sh                 from a clone: use that clone (for development)
#   ./install.sh --uninstall
#
# Piped from curl, it installs jev-pilot the way Claude Code installs any plugin:
#   1. checks Claude Code is installed and new enough (function hooks: 2.1.278+)
#   2. adds the jev-pilot marketplace and installs the plugin, passing your Jev
#      key with --config, so Claude Code keeps it in its own credential store
#   3. links the `claude-jev` launcher into $JEV_PILOT_BIN (~/.local/bin)
# Run again at any time to update. `claude-jev self-update` does the same.
#
# Run from a clone, step 2 instead loads that clone (--plugin-dir) and adds the
# key to ~/.claude/settings.json under pluginConfigs["jev-pilot"], after a backup.
#
# Non-interactive: JEV_OPENROUTER_KEY=sk-or-... (or JEV_TYPESAFE_KEY=...) skips the
# key prompt; JEV_SKIP_KEY=1 installs without one (Claude Code's built-in classifier).
set -euo pipefail

MARKETPLACE_SOURCE="${JEV_PILOT_MARKETPLACE:-Akramovic1/jev-pilot}"
MARKETPLACE="jev-pilot"
PLUGIN_ID="jev-pilot"
BIN_DIR="${JEV_PILOT_BIN:-$HOME/.local/bin}"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
MIN_VERSION="2.1.278"

if [[ -t 1 ]]; then
  bold=$'\e[1m' dim=$'\e[2m' green=$'\e[32m' yellow=$'\e[33m' red=$'\e[31m' reset=$'\e[0m'
else
  bold='' dim='' green='' yellow='' red='' reset=''
fi
step() { printf '%s==>%s %s\n' "$bold" "$reset" "$*"; }
ok() { printf '  %s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '  %s!%s %s\n' "$yellow" "$reset" "$*"; }
die() { printf '%serror:%s %s\n' "$red" "$reset" "$*" >&2; exit 1; }

# a >= b, for dotted versions
version_ge() { [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" == "$2" ]]; }

# Installed from a marketplace (enabled in user settings).
marketplace_installed() {
  [[ -f "$SETTINGS" ]] && grep -Eq "\"$PLUGIN_ID@$MARKETPLACE\"[[:space:]]*:[[:space:]]*true" "$SETTINGS"
}

# --- clone mode: settings edits -------------------------------------------------

# A JSON editor: python3, else node. The file is rewritten with 2-space indent.
json_tool() {
  if command -v python3 >/dev/null 2>&1; then echo python3
  elif command -v node >/dev/null 2>&1; then echo node
  else echo ''
  fi
}

# settings_merge <provider-key-option> <key> — adds the options, keeps the rest.
settings_merge() {
  local option="$1" key="$2"
  mkdir -p "$(dirname "$SETTINGS")"
  if [[ "$(json_tool)" == python3 ]]; then
    JEV_OPTION="$option" JEV_KEY="$key" JEV_SETTINGS="$SETTINGS" JEV_ID="$PLUGIN_ID" python3 - <<'PY'
import json, os, sys
path = os.environ["JEV_SETTINGS"]
try:
    with open(path) as f:
        text = f.read()
    data = json.loads(text) if text.strip() else {}
except FileNotFoundError:
    data = {}
except json.JSONDecodeError as error:
    sys.exit(f"{path} is not valid JSON ({error}); fix it and run the installer again")
if not isinstance(data, dict):
    sys.exit(f"{path} does not hold a JSON object")
options = data.setdefault("pluginConfigs", {}).setdefault(os.environ["JEV_ID"], {}).setdefault("options", {})
if os.environ["JEV_KEY"]:
    options[os.environ["JEV_OPTION"]] = os.environ["JEV_KEY"]
options.setdefault("timeoutMs", 1500)
tmp = path + ".jev-pilot.tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.replace(tmp, path)
PY
  else
    JEV_OPTION="$option" JEV_KEY="$key" JEV_SETTINGS="$SETTINGS" JEV_ID="$PLUGIN_ID" node - <<'JS'
const fs = require('fs')
const path = process.env.JEV_SETTINGS
let data = {}
try {
  const text = fs.readFileSync(path, 'utf8')
  data = text.trim() ? JSON.parse(text) : {}
} catch (error) {
  if (error.code !== 'ENOENT') { console.error(`${path}: ${error.message}; fix it and run the installer again`); process.exit(1) }
}
if (!data || typeof data !== 'object' || Array.isArray(data)) { console.error(`${path} does not hold a JSON object`); process.exit(1) }
const configs = (data.pluginConfigs ??= {})
const entry = (configs[process.env.JEV_ID] ??= {})
const options = (entry.options ??= {})
if (process.env.JEV_KEY) options[process.env.JEV_OPTION] = process.env.JEV_KEY
options.timeoutMs ??= 1500
fs.writeFileSync(path + '.jev-pilot.tmp', JSON.stringify(data, null, 2) + '\n')
fs.renameSync(path + '.jev-pilot.tmp', path)
JS
  fi
}

# Whether settings already carry a key under pluginConfigs["jev-pilot"].
settings_has_key() {
  [[ -f "$SETTINGS" ]] || return 1
  case "$(json_tool)" in
    python3) JEV_ID="$PLUGIN_ID" python3 -c '
import json, os, sys
try: d = json.load(open(sys.argv[1]))
except Exception: sys.exit(1)
o = ((d.get("pluginConfigs") or {}).get(os.environ["JEV_ID"]) or {}).get("options") or {}
sys.exit(0 if any(isinstance(o.get(k), str) and o.get(k) for k in ("openrouterApiKey", "typesafeApiKey", "gatewayApiKey")) else 1)' "$SETTINGS" ;;
    node) JEV_ID="$PLUGIN_ID" node -e '
let ok = false
try {
  const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
  const o = ((d.pluginConfigs || {})[process.env.JEV_ID] || {}).options || {}
  ok = ["openrouterApiKey", "typesafeApiKey", "gatewayApiKey"].some((k) => typeof o[k] === "string" && o[k])
} catch {}
process.exit(ok ? 0 : 1)' "$SETTINGS" ;;
    *) grep -q "\"$PLUGIN_ID\"" "$SETTINGS" && grep -Eq '"(openrouterApiKey|typesafeApiKey|gatewayApiKey)"[[:space:]]*:[[:space:]]*"[^"]+' "$SETTINGS" ;;
  esac
}

# --- shared ---------------------------------------------------------------------

# ask_key — sets `option` and `key` from the environment or a hidden prompt.
ask_key() {
  option='' key=''
  if [[ -n "${JEV_OPENROUTER_KEY:-}" ]]; then option=openrouterApiKey key="$JEV_OPENROUTER_KEY"
  elif [[ -n "${JEV_TYPESAFE_KEY:-}" ]]; then option=typesafeApiKey key="$JEV_TYPESAFE_KEY"
  elif [[ "${JEV_SKIP_KEY:-}" == 1 ]]; then :
  elif (: </dev/tty) 2>/dev/null; then
    printf '  Jev runs on OpenRouter: create a key at %shttps://openrouter.ai/keys%s\n' "$bold" "$reset"
    printf '  (about $0.04 per million input tokens; press Enter to skip and use the built-in classifier)\n'
    printf '  OpenRouter API key: '
    IFS= read -rs key </dev/tty || key=''
    printf '\n'
    [[ -n "$key" ]] && option=openrouterApiKey
  else
    warn "no terminal to ask for a key; set JEV_OPENROUTER_KEY and run again"
  fi
  if [[ -n "$key" && "$key" != sk-* ]]; then warn "that key does not look like an OpenRouter or TypeSafe key; saving it anyway"; fi
  return 0
}

# link_launcher <target> — puts claude-jev on the PATH.
link_launcher() {
  local target="$1"
  step "Linking the claude-jev command"
  mkdir -p "$BIN_DIR"
  if [[ -e "$BIN_DIR/claude-jev" && ! -L "$BIN_DIR/claude-jev" ]]; then
    die "$BIN_DIR/claude-jev exists and is not a link; move it away or set JEV_PILOT_BIN"
  fi
  ln -sfn "$target" "$BIN_DIR/claude-jev"
  ok "$BIN_DIR/claude-jev → $target"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) warn "$BIN_DIR is not on your PATH. Add this to your shell profile:"
       warn "  export PATH=\"$BIN_DIR:\$PATH\"" ;;
  esac
}

uninstall() {
  step "Uninstalling jev-pilot"
  warn "If you ran /jev-pilot:setup, run '/jev-pilot:setup restore' in a claude-jev session first,"
  warn "or your skills stay hidden from Claude with nothing to load them."
  if command -v claude >/dev/null 2>&1 && marketplace_installed; then
    claude plugin uninstall "$PLUGIN_ID@$MARKETPLACE" >/dev/null && ok "uninstalled the plugin"
    claude plugin marketplace remove "$MARKETPLACE" >/dev/null && ok "removed the marketplace"
  fi
  if [[ -L "$BIN_DIR/claude-jev" ]]; then rm "$BIN_DIR/claude-jev"; ok "removed $BIN_DIR/claude-jev"; fi
  exit 0
}
[[ "${1:-}" == "--uninstall" ]] && uninstall
[[ -n "${1:-}" ]] && die "unknown option: $1 (only --uninstall)"

printf '\n%sjev-pilot%s %s— let Jev steer Claude Code%s\n\n' "$bold" "$reset" "$dim" "$reset"

# 1. Claude Code
step "Checking Claude Code"
command -v claude >/dev/null 2>&1 || die "Claude Code is not installed (https://docs.claude.com/en/docs/claude-code). Install it, then run this again."
version="$(claude --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
[[ -n "$version" ]] || die "could not read 'claude --version'"
version_ge "$version" "$MIN_VERSION" || die "Claude Code $version is too old: jev-pilot needs $MIN_VERSION or newer (run 'claude update')."
ok "Claude Code $version"

here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [[ -n "$here" && -f "$here/.claude-plugin/plugin.json" && -x "$here/bin/claude-jev" && -z "${JEV_PILOT_MARKETPLACE:-}" ]]; then
  # ---- clone mode: load this folder with --plugin-dir ----
  marketplace_installed && die "jev-pilot is also installed from the marketplace; run '$0 --uninstall' first, or use that install"
  step "Using this clone"
  ok "$here"
  link_launcher "$here/bin/claude-jev"

  step "Connecting to Jev"
  if [[ -z "${JEV_OPENROUTER_KEY:-}${JEV_TYPESAFE_KEY:-}" ]] && settings_has_key; then
    ok "a key is already set in $SETTINGS; keeping it"
    key='' option=''
  else
    ask_key
  fi
  if [[ -n "$key" ]] || ! settings_has_key; then
    if [[ -f "$SETTINGS" ]]; then
      backup="$SETTINGS.backup-$(date +%Y%m%d-%H%M%S)"
      cp "$SETTINGS" "$backup"
      ok "backed up settings to $backup"
    fi
    if [[ -z "$(json_tool)" ]]; then
      warn "python3 or node is needed to edit $SETTINGS; add this yourself:"
      printf '\n  "pluginConfigs": { "%s": { "options": { "openrouterApiKey": "sk-or-v1-...", "timeoutMs": 1500 } } }\n\n' "$PLUGIN_ID"
    elif settings_merge "${option:-openrouterApiKey}" "$key"; then
      if [[ -n "$key" ]]; then ok "saved the key under pluginConfigs[\"$PLUGIN_ID\"] in $SETTINGS"
      else ok "no key: jev-pilot will use Claude Code's built-in classifier (add a key any time; see README)"
      fi
    else
      die "$SETTINGS was left unchanged (see above). Fix it, then run the installer again."
    fi
  fi
  unset key JEV_OPENROUTER_KEY JEV_TYPESAFE_KEY

  step "Validating the plugin"
  if claude plugin validate "$here/.claude-plugin/plugin.json" >/dev/null 2>&1; then ok "plugin is valid"
  else warn "'claude plugin validate $here/.claude-plugin/plugin.json' reported a problem; run it to see why"
  fi
else
  # ---- marketplace mode: install like any Claude Code plugin ----
  step "Installing jev-pilot"
  if claude plugin marketplace list 2>/dev/null | grep -Eq "^[[:space:]]*(❯[[:space:]]*)?$MARKETPLACE\$"; then
    claude plugin marketplace update "$MARKETPLACE" >/dev/null
    ok "updated the $MARKETPLACE marketplace"
  else
    claude plugin marketplace add "$MARKETPLACE_SOURCE" >/dev/null
    ok "added the $MARKETPLACE marketplace ($MARKETPLACE_SOURCE)"
  fi

  already=0
  marketplace_installed && already=1
  if [[ "$already" == 1 && -z "${JEV_OPENROUTER_KEY:-}${JEV_TYPESAFE_KEY:-}" ]]; then
    step "Updating jev-pilot"
    claude plugin update "$PLUGIN_ID@$MARKETPLACE" >/dev/null 2>&1 || true
    ok "up to date; your key and options are kept"
  else
    step "Connecting to Jev"
    ask_key
    config=(--config timeoutMs=1500)
    [[ -n "$key" ]] && config+=(--config "$option=$key")
    claude plugin install "$PLUGIN_ID@$MARKETPLACE" "${config[@]}" >/dev/null
    unset key JEV_OPENROUTER_KEY JEV_TYPESAFE_KEY config
    if [[ "$already" == 1 ]]; then ok "updated the key"
    elif [[ -n "$option" ]]; then ok "installed jev-pilot@$MARKETPLACE; the key is in Claude Code's credential store"
    else ok "installed jev-pilot@$MARKETPLACE without a key (built-in classifier; add one: run this again with a key)"
    fi
  fi

  # The launcher lives in the marketplace's copy of the repo, which
  # `claude plugin marketplace update` refreshes: the link stays current.
  launcher="$HOME/.claude/plugins/marketplaces/$MARKETPLACE/bin/claude-jev"
  if [[ ! -x "$launcher" ]]; then
    source_dir="$(claude plugin marketplace list 2>/dev/null | grep -Eo 'Directory \(([^)]+)\)' | head -1 | sed -E 's/^Directory \((.*)\)$/\1/')"
    launcher="${source_dir:+$source_dir/bin/claude-jev}"
  fi
  if [[ -n "$launcher" && -x "$launcher" ]]; then
    link_launcher "$launcher"
  else
    warn "could not find the claude-jev launcher; start Claude Code with: CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude"
  fi
fi

printf '\n%sDone.%s Start Claude Code with Jev:\n\n' "$green$bold" "$reset"
printf '    %sclaude-jev%s            (same arguments as claude: claude-jev -c, claude-jev -p "…")\n\n' "$bold" "$reset"
printf '  Look above the prompt, at the right: Claude the pilot says "ready", then\n'
printf '  what Jev decides for each prompt. %s/jev%s switches any part on or off.\n' "$bold" "$reset"
printf '  Update any time with %sclaude-jev self-update%s. After a few days, run %s/jev-pilot:report%s.\n\n' "$bold" "$reset" "$bold" "$reset"
