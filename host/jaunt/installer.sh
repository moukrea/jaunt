#!/usr/bin/env bash
# Jaunt user-space installer. Inspect this file before piping it into bash.
# Production: curl -fsSL https://moukrea.github.io/jaunt/install.sh | bash
set -Eeuo pipefail
umask 077
fail() { printf 'jaunt: %s\n' "$*" >&2; exit 1; }
say() { printf '\n  Jaunt · %s\n' "$*"; }
case "$(uname -s)" in Linux|Darwin) ;; *) fail 'Use Linux, macOS, or WSL. Windows native is not supported.';; esac
command -v curl >/dev/null || fail 'curl is required to download the installer and release.'
PAGE="${JAUNT_PAGE_URL:-https://moukrea.github.io/jaunt}"
REPO="${JAUNT_REPO:-moukrea/jaunt}"
PREFIX="${JAUNT_PREFIX:-$HOME/.local/share/jaunt/runtime}"
BIN="${JAUNT_BIN_DIR:-$HOME/.local/bin}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/jaunt-install.XXXXXXXX")"
trap 'rm -rf "$TMP"' EXIT
fetch() {
  case "$1" in
    https://*) curl --proto '=https' --tlsv1.2 --fail --show-error --silent --location --retry 3 --connect-timeout 20 --max-time 180 "$1" -o "$2" ;;
    http://127.0.0.1:*|http://localhost:*)
      [[ "${JAUNT_DEV_INSTALL:-0}" == 1 ]] || fail 'HTTP downloads are allowed only in explicit local installer tests.'
      curl --fail --show-error --silent --location "$1" -o "$2" ;;
    *) fail 'Downloads must use HTTPS.' ;;
  esac
}
PY=''
for candidate in python3 python3.13 python3.12 python3.11; do
  if command -v "$candidate" >/dev/null && "$candidate" -c 'import sys,venv;assert (3,11)<=sys.version_info<(3,15)' 2>/dev/null; then
    PY="$(command -v "$candidate")"; break
  fi
done
UV=''
if [[ -z "$PY" ]]; then
  say 'Installing a private Python runtime (no sudo)'
  if command -v uv >/dev/null; then UV="$(command -v uv)";
  elif [[ -x "$HOME/.local/bin/uv" ]]; then UV="$HOME/.local/bin/uv";
  else
    fetch 'https://astral.sh/uv/install.sh' "$TMP/uv-install.sh"
    UV_INSTALL_DIR="$HOME/.local/bin" UV_NO_MODIFY_PATH=1 sh "$TMP/uv-install.sh"
    UV="$HOME/.local/bin/uv"
  fi
  "$UV" python install 3.12
  PY="$("$UV" python find 3.12)"
fi
fetch "${PAGE%/}/config.json" "$TMP/config.json"
"$PY" - "$TMP/config.json" "${JAUNT_DEV_INSTALL:-0}" <<'PY'
import json,sys,urllib.parse
c=json.load(open(sys.argv[1]));r=c.get('relay');u=urllib.parse.urlparse(r or '')
assert c.get('version') == 1, 'Unsupported deployment configuration'
assert r and u.hostname and (u.scheme=='wss' or (sys.argv[2]=='1' and u.scheme=='ws' and u.hostname in ('localhost','127.0.0.1'))), 'Relay has not been deployed. The repository owner must deploy it once before this installer can work.'
assert not (u.username or u.password or u.query or u.fragment), 'Invalid relay URL'
PY
TAG="${JAUNT_VERSION:-$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1]))["release"])' "$TMP/config.json")}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || fail 'Invalid release tag.'
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'Invalid repository name.'
BASE="${JAUNT_RELEASE_BASE:-https://github.com/$REPO/releases/download/$TAG}"
say "Downloading $TAG"
fetch "${BASE%/}/host-manifest.json" "$TMP/host-manifest.json"
WHEEL="$("$PY" - "$TMP/host-manifest.json" <<'PY'
import json,re,sys
m=json.load(open(sys.argv[1]));w=m['wheel']
assert re.fullmatch(r'jaunt_host-[A-Za-z0-9_.]+-py3-none-any\.whl',w), 'Invalid wheel name'
assert re.fullmatch(r'[a-f0-9]{64}',m['sha256']), 'Invalid checksum'
print(w)
PY
)"
fetch "${BASE%/}/$WHEEL" "$TMP/$WHEEL"
"$PY" - "$TMP/host-manifest.json" "$TMP/$WHEEL" <<'PY'
import hashlib,json,sys
m=json.load(open(sys.argv[1]));actual=hashlib.sha256(open(sys.argv[2],'rb').read()).hexdigest()
assert actual==m['sha256'],'Release checksum mismatch; nothing installed'
PY
# Never silently destroy a user's running plain shells during an upgrade.
if [[ -x "$PREFIX/current/bin/python" ]]; then
  if "$PREFIX/current/bin/python" -m jaunt.cli status >"$TMP/status.json" 2>/dev/null; then
    COUNT="$("$PY" -c 'import json,sys;print(sum(bool(s["alive"] and not s.get("tmux")) for s in json.load(open(sys.argv[1]))["sessions"]))' "$TMP/status.json")"
    if [[ "$COUNT" != 0 && "${JAUNT_ALLOW_RESTART:-0}" != 1 ]]; then
      fail "$COUNT plain shells are running. Finish them before updating. JAUNT_ALLOW_RESTART=1 explicitly authorizes terminating them."
    fi
  fi
fi
mkdir -p "$PREFIX/versions" "$BIN"
TARGET="$PREFIX/versions/${TAG}-$(date +%s)-$$"
say 'Installing into a private environment'
VENV_ARGS=()
# An explicit test-only switch allows offline CI to reuse installed dependencies.
if [[ "${JAUNT_DEV_INSTALL:-0}" == 1 && "${JAUNT_TEST_SYSTEM_SITE:-0}" == 1 ]]; then VENV_ARGS+=(--system-site-packages); fi
if ! "$PY" -m venv "${VENV_ARGS[@]}" "$TARGET"; then
  rm -rf "$TARGET"
  if [[ -z "$UV" ]]; then
    fetch 'https://astral.sh/uv/install.sh' "$TMP/uv-install.sh"
    UV_INSTALL_DIR="$HOME/.local/bin" UV_NO_MODIFY_PATH=1 sh "$TMP/uv-install.sh"
    UV="$HOME/.local/bin/uv"
  fi
  "$UV" venv --python "$PY" --seed "$TARGET"
fi
# venv may bundle an outdated pip. Update before resolving release dependencies.
if [[ "${JAUNT_DEV_INSTALL:-0}" != 1 || "${JAUNT_PIP_NO_DEPS:-0}" != 1 ]]; then
  "$TARGET/bin/python" -m pip install --disable-pip-version-check --upgrade 'pip==26.2.1' || fail 'Could not install the reviewed pip version; previous runtime retained.'
fi
# JAUNT_PIP_NO_DEPS is only for explicit offline integration tests, never the normal installer.
PIP_ARGS=()
if [[ "${JAUNT_DEV_INSTALL:-0}" == 1 && "${JAUNT_PIP_NO_DEPS:-0}" == 1 ]]; then PIP_ARGS+=(--no-deps); fi
if ! "$TARGET/bin/python" -m pip install --disable-pip-version-check "${PIP_ARGS[@]}" "$TMP/$WHEEL"; then
  rm -rf "$TARGET"; fail 'Package installation failed. The previous version was retained.'
fi
# On upgrade, only switch the pointer after the new environment has been verified.
"$TARGET/bin/python" -c 'from jaunt.daemon import Host; from jaunt.cli import main' || fail 'Runtime dependencies are missing.'
# Only now stop the old runtime. A failed download, checksum, venv or pip install
# leaves the previous daemon running. Recheck: a shell could have started meanwhile.
if [[ -x "$PREFIX/current/bin/python" ]]; then
  if "$PREFIX/current/bin/python" -m jaunt.cli status >"$TMP/status.json" 2>/dev/null; then
    COUNT="$("$PY" -c 'import json,sys;print(sum(bool(s["alive"] and not s.get("tmux")) for s in json.load(open(sys.argv[1]))["sessions"]))' "$TMP/status.json")"
    [[ "$COUNT" == 0 || "${JAUNT_ALLOW_RESTART:-0}" == 1 ]] || fail 'A plain shell started during the upgrade; not stopping it.'
    "$PREFIX/current/bin/python" -c 'import os; from jaunt.cli import control; control("upgrade.stop", {"allowRestart": os.environ.get("JAUNT_ALLOW_RESTART") == "1"})' || fail 'Host refused the upgrade shutdown; previous runtime retained.'
    "$PREFIX/current/bin/python" -m jaunt.cli service stop >/dev/null 2>&1 || true
    "$PREFIX/current/bin/python" -m jaunt.cli stop >/dev/null 2>&1 || true
    sleep 1
  fi
fi

"$PY" - "$PREFIX" "$TARGET" "$BIN" <<'PY'
import os,pathlib,shlex,sys
prefix,target,bindir=map(pathlib.Path,sys.argv[1:]);tmp=prefix/'current.new'
if tmp.is_symlink():tmp.unlink()
os.symlink(target,tmp);os.replace(tmp,prefix/'current')
wrapper=bindir/'jaunt';wrapper.write_text('#!/bin/sh\nexec '+shlex.quote(str(prefix/'current/bin/python'))+' -m jaunt.cli "$@"\n');wrapper.chmod(0o755)
PY
"$TARGET/bin/python" - "$PREFIX" "$BIN" "$PAGE" "$REPO" "$TAG" "${JAUNT_NO_SERVICE:-0}" <<'PYUPDATE'
import sys
from jaunt.state import state_dir, atomic_json
from jaunt.updates import installation
prefix,bindir,page,repo,tag,no_service=sys.argv[1:]
old=installation()
atomic_json(state_dir()/'installation.json', {'prefix':prefix,'bin':bindir,'page':page.rstrip('/'),'repository':repo,'tag':tag,'noService':no_service=='1','automatic':old.get('automatic',True)})
PYUPDATE
RELAY="$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1]))["relay"])' "$TMP/config.json")"
"$BIN/jaunt" init --relay "$RELAY" --page "${PAGE%/}/"
export PATH="$BIN:$PATH"
if [[ "${JAUNT_NO_SERVICE:-0}" != 1 ]]; then
  if ! "$BIN/jaunt" service install; then
    printf '\nNo usable user service manager. Starting in the background instead.\n'
    printf 'This host will need jaunt start after reboot; jaunt doctor explains the current setup.\n'
    "$BIN/jaunt" start
  fi
else "$BIN/jaunt" start; fi
say 'Ready'
printf 'Executable: %s/jaunt\n' "$BIN"
printf 'Add %s to PATH if your next shell does not find jaunt.\n' "$BIN"
if [[ "${JAUNT_SKIP_PAIR:-0}" != 1 ]]; then "$BIN/jaunt" pair; fi
