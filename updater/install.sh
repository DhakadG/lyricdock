#!/usr/bin/env bash
# LyricDock installer / updater for macOS (and Linux) - the Spotify side. Safe to run any time: installs or repairs.
#   curl -fsSL https://raw.githubusercontent.com/DhakadG/lyricdock/main/updater/install.sh | bash
# Same steps as updater/install.ps1: installs Spicetify if missing, puts the auto-updating LyricDock loader into it
# and re-applies Spicetify (needed after Spotify updates itself and wipes it). Re-run it after a Spotify update.
# Written for macOS's bash 3.2: no associative arrays, no ${x,,}, no mapfile.
set -u
REPO='DhakadG/lyricdock'
RAW="https://raw.githubusercontent.com/$REPO/main"
OS=$(uname -s)

c() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
step() { c '1;37' "     [*] ($1/6) $2"; }
ok() { c 32 "             $1"; }
info() { c 90 "             $1"; }
warn() { c 33 "             $1"; }
fail() {
  echo
  c 31 "  [!] $1"
  echo
  exit 1
}
# Every download tries each mirror, twice: a fresh machine must not depend on one host answering once.
get() { # get <out-file|-> <url>...
  out=$1
  shift
  for round in 1 2; do
    for u in "$@"; do
      if [ "$out" = - ]; then
        curl -fsSL --connect-timeout 30 --max-time 120 "$u" && return 0
      else curl -fsSL --connect-timeout 30 --max-time 600 -o "$out" "$u" && return 0; fi
    done
    [ $round = 1 ] && sleep 3
  done
  return 1
}

echo
c 32 '    _               _      ___             _    '
c 32 '   | |  _  _ _ _ __(_)__  |   \ ___  __ __| |__ '
c 32 "   | |_| || | '_/ _| / _| | |) / _ \\/ _/ _| / / "
c 32 '   |____\_, |_| \__|_\__| |___/\___/\__\__|_\_\ '
c 90 '        |__/            lyrics dock for Spotify'
echo

command -v curl > /dev/null || fail 'curl is missing. Install it, then run this again.'
[ "$(id -u)" = 0 ] && fail 'Do not run this with sudo: Spicetify must run as your own user. Run it again without sudo.'

step 1 'Checking network connectivity...'
latest=$(get - "$RAW/extension/version.json?t=$(date +%s)" "https://cdn.jsdelivr.net/gh/$REPO@main/extension/version.json" \
  | sed -n 's/.*"version"[^"]*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/p' | head -n1)
[ -n "$latest" ] || fail "Can't reach GitHub or jsDelivr. Check your internet connection and run this again."
ok 'Network connected'

step 2 'Checking Spotify and Spicetify...'
if [ "$OS" = Darwin ]; then
  app=''
  for a in /Applications/Spotify.app "$HOME/Applications/Spotify.app"; do [ -d "$a" ] && app=$a && break; done
  if [ -z "$app" ]; then
    if command -v brew > /dev/null; then
      info 'Spotify is not installed - installing it with Homebrew...'
      brew install --cask spotify > /dev/null || true
    fi
    [ -d /Applications/Spotify.app ] && app=/Applications/Spotify.app
    [ -n "$app" ] || fail 'Spotify is not installed. Get it from https://www.spotify.com/download (not the App Store), sign in, then run this again.'
  fi
  # Spicetify patches files inside the app, so the app must be writable by you (it is when dragged in from the DMG).
  [ -w "$app/Contents/Resources" ] || fail "Spicetify can't modify $app. Run:  sudo chown -R \"$USER\" \"$app\"  then run this again."
  # Spicetify needs Spotify's prefs file, written the first time Spotify runs.
  prefs="$HOME/Library/Application Support/Spotify/prefs"
  if [ ! -f "$prefs" ]; then
    info 'Starting Spotify once so it writes its settings...'
    open -a "$app"
    for i in $(seq 90); do
      [ -f "$prefs" ] && break
      sleep 1
    done
    [ -f "$prefs" ] || fail 'Spotify has not finished its first start. Sign in to Spotify, quit it, then run this again.'
  fi
fi
spicetify=$(command -v spicetify || true)
[ -z "$spicetify" ] && [ -x "$HOME/.spicetify/spicetify" ] && spicetify="$HOME/.spicetify/spicetify"
if [ -z "$spicetify" ]; then
  # Same as Spicetify's own installer (spicetify.app), minus its prompts: the latest CLI into ~/.spicetify, on PATH.
  info 'Spicetify is not installed - installing it...'
  case "$OS" in Darwin) os=darwin ;; Linux) os=linux ;; *) fail "Unsupported system: $OS" ;; esac
  case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; x86_64 | amd64) arch=amd64 ;; *) fail "Unsupported CPU: $(uname -m)" ;; esac
  tag=$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/spicetify/cli/releases/latest | sed -n 's#.*/releases/tag/\(.*\)#\1#p')
  [ -n "$tag" ] || fail "Can't find the latest Spicetify release. Install it from https://spicetify.app, then run this again."
  dir="$HOME/.spicetify"
  tgz=$(mktemp)
  get "$tgz" "https://github.com/spicetify/cli/releases/download/$tag/spicetify-${tag#v}-$os-$arch.tar.gz" \
    || fail "Couldn't download Spicetify. Install it from https://spicetify.app, then run this again."
  mkdir -p "$dir" && tar -xzf "$tgz" -C "$dir" && chmod +x "$dir/spicetify"
  rm -f "$tgz"
  spicetify="$dir/spicetify"
  rc="$HOME/.zshrc"
  case "${SHELL:-}" in */bash)
    rc="$HOME/.bashrc"
    [ "$OS" = Darwin ] && rc="$HOME/.bash_profile"
    ;;
  esac
  grep -qs '.spicetify' "$rc" || printf '\nexport PATH="$PATH:$HOME/.spicetify"\n' >> "$rc"
  "$spicetify" > /dev/null 2>&1 # first run writes its config file
  ok "Spicetify $tag installed"
fi
cfg=$("$spicetify" -c 2> /dev/null | tail -n1)
[ -n "$cfg" ] || fail 'Spicetify is installed but did not report its config folder. Run "spicetify" once, then run this again.'
ext="$(dirname "$cfg")/Extensions"
ok 'Spicetify found'
info "Extensions folder: $ext"
echo
if [ -f "$ext/lyricdock.js" ]; then c 35 '                    [ UPDATING ]'; else c 35 '                    [ INSTALLING ]'; fi
info "Latest version: $latest"

step 3 'Closing Spotify...'
if pgrep -x Spotify > /dev/null || pgrep -x spotify > /dev/null; then
  pkill -x Spotify 2> /dev/null
  pkill -x spotify 2> /dev/null
  sleep 1
  ok 'Spotify closed'
else ok 'Spotify is not running'; fi

step 4 'Downloading the LyricDock loader...'
# The loader is the only file Spicetify keeps; it fetches the matching LyricDock build itself (signed, cached).
mkdir -p "$ext"
tmp=$(mktemp)
get "$tmp" "https://cdn.jsdelivr.net/gh/$REPO@v$latest/extension/lyricdock.js" "https://raw.githubusercontent.com/$REPO/v$latest/extension/lyricdock.js" \
  "https://github.com/$REPO/releases/download/v$latest/lyricdock.js" || fail "Couldn't download the LyricDock loader. Check your connection and run this again."
grep -q lyricdockLoader "$tmp" || {
  rm -f "$tmp"
  fail 'The download looks wrong (not the LyricDock loader). Try again in a minute.'
}
mv -f "$tmp" "$ext/lyricdock.js"
chmod 644 "$ext/lyricdock.js"
ok "Loader installed (loads LyricDock v$latest and keeps it updated)"

step 5 'Enabling the extension...'
"$spicetify" config extensions 'dock-bridge.js-' > /dev/null 2>&1 # a development copy must not run alongside
"$spicetify" config extensions lyricdock.js > /dev/null 2>&1
ok 'Extension enabled'

step 6 'Applying Spicetify...'
out=$("$spicetify" apply 2>&1) || {
  info 'Spotify probably updated and wiped Spicetify - restoring...'
  out=$("$spicetify" backup apply 2>&1)
} \
  || {
    info 'Resetting an old Spicetify backup...'
    out=$("$spicetify" restore backup apply 2>&1)
  } \
  || {
    echo "$out" | sed 's/^/             /'
    fail 'spicetify apply failed (output above).'
  }
ok 'Spicetify applied - Spotify is starting'

echo
info 'Phone not set up yet? Install the APK on the phone: https://github.com/DhakadG/lyricdock/releases/latest'
info 'Then connect once: Spotify -> LyricDock (top-bar button) -> Devices -> Find devices.'
echo
c 32 "  LyricDock $latest is ready. Open the LyricDock button in Spotify's top bar."
echo
