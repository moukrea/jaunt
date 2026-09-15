#!/usr/bin/env bash
# jaunt user-space installer. Inspect this file before piping it into bash.
# Production: bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
set -Eeuo pipefail
umask 077
CLIENT_ONLY=0
if [[ "${1:-}" == --client-only && "$#" == 1 ]]; then CLIENT_ONLY=1;
elif [[ "$#" != 0 ]]; then printf "Usage: install.sh [--client-only]\n" >&2; exit 2; fi
# Accept existing overrides and pass canonical values to older installed runtimes.
while IFS= read -r jaunt_env_key; do
  if [[ "$jaunt_env_key" == "$(printf jaunt_ | tr '[:lower:]' '[:upper:]')"* ]]; then
    jaunt_env_alias="jaunt_${jaunt_env_key:6}"
    if [[ -z "${!jaunt_env_alias+x}" ]]; then export "$jaunt_env_alias=${!jaunt_env_key}"; fi
  fi
done < <(compgen -e)
while IFS= read -r jaunt_env_key; do
  if [[ "$jaunt_env_key" == jaunt_* ]]; then
    jaunt_env_alias="$(printf '%s' "$jaunt_env_key" | tr '[:lower:]' '[:upper:]')"
    export "$jaunt_env_alias=${!jaunt_env_key}"
  fi
done < <(compgen -e)
STAGE='initialization'
trap 'rc=$?; printf "\njaunt: Installation failed during %s (line %s, exit %s). See the error above.\n" "$STAGE" "$LINENO" "$rc" >&2; exit "$rc"' ERR
printf '\n  jaunt · Starting installation\n'
fail() { printf 'jaunt: %s\n' "$*" >&2; exit 1; }
say() { printf '\n  jaunt · %s\n' "$*"; }
case "$(uname -s)" in Linux|Darwin) ;; *) fail 'Use Linux, macOS, or WSL. Windows native is not supported.';; esac
command -v curl >/dev/null || fail 'curl is required to download the installer and release.'
PAGE="${jaunt_PAGE_URL:-https://moukrea.github.io/jaunt}"
REPO="${jaunt_REPO:-moukrea/jaunt}"
PREFIX="${jaunt_PREFIX:-$HOME/.local/share/jaunt/runtime}"
BIN="${jaunt_BIN_DIR:-$HOME/.local/bin}"
# Stage on the destination filesystem, not an inherited or memory-backed /tmp.
# pip and uv also use this private directory, including during a full-/tmp install.
STAGE='installation storage preparation'
jaunt_INSTALL_PARENT="$(dirname "$PREFIX")"
mkdir -p "$jaunt_INSTALL_PARENT"
jaunt_INSTALL_TMP="$(mktemp -d "$jaunt_INSTALL_PARENT/.jaunt-install.XXXXXXXX")"
trap 'rm -rf "$jaunt_INSTALL_TMP"' EXIT
if ! dd if=/dev/zero of="$jaunt_INSTALL_TMP/.write-test" bs=1024 count=1024 2>/dev/null; then
  fail 'Cannot write to the installation filesystem. Check free disk space, quota, and directory permissions.'
fi
rm -f "$jaunt_INSTALL_TMP/.write-test"
python_fetch() {
  "$PY" - "$1" "$2" <<'PYFETCH'
import os, signal, sys, urllib.parse, urllib.request
url, destination = sys.argv[1:]
def https_only(value):
    if urllib.parse.urlsplit(value).scheme != 'https':
        raise ValueError('Installer download redirects must remain HTTPS')
class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        https_only(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)
def timed_out(*_):
    raise TimeoutError('Installer download exceeded 120 seconds')
https_only(url)
signal.signal(signal.SIGALRM, timed_out)
signal.alarm(120)
try:
    request = urllib.request.Request(url, headers={'User-Agent': 'jaunt-Installer/1'})
    opener = urllib.request.build_opener(HTTPSRedirect())
    with opener.open(request, timeout=20) as response, open(destination, 'wb') as output:
        https_only(response.url)
        expected = response.headers.get('Content-Length')
        total = 0
        while chunk := response.read(64 * 1024):
            total += len(chunk)
            if total > 128 * 1024 * 1024:
                raise ValueError('Installer download exceeds 128 MiB')
            output.write(chunk)
        if expected is not None and total != int(expected):
            raise ValueError('Incomplete installer download')
        output.flush()
        os.fsync(output.fileno())
except Exception as error:
    # A filesystem failure here includes the real OS error instead of curl's 23.
    print(f'jaunt: Python download failed: {error}', file=sys.stderr)
    sys.exit(1)
finally:
    signal.alarm(0)
PYFETCH
}
fetch() {
  local url="$1" destination="$2" rc
  # Bash owns the temporary directory. Open the destination here: a confined
  # curl can have a different /tmp namespace and cannot reopen this path itself.
  # Its inherited stdout still writes to the file Bash opened.
  printf '  jaunt · Downloading %s\n' "${url##*/}" >&2
  case "$url" in
    https://*)
      if curl --disable --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --show-error --progress-bar --location --connect-timeout 10 --max-time 120 "$url" > "$destination"; then
        return 0
      else rc=$?; fi
      case "$rc" in
        23)
          if [[ -n "${PY:-}" ]]; then
            printf '  jaunt · curl could not write the download; retrying with Python.\n' >&2
            python_fetch "$url" "$destination"
          else
            fail 'curl could not write the download and Python is not available yet. Check installation storage and curl restrictions.'
          fi
          ;;
        5|6|7|28|35|52|55|56)
          printf '  jaunt · Download failed (curl %s); retrying over IPv4.\n' "$rc" >&2
          curl --disable --ipv4 --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --show-error --progress-bar --location --connect-timeout 10 --max-time 120 "$url" > "$destination"
          ;;
        *) return "$rc" ;;
      esac
      ;;
    http://127.0.0.1:*|http://localhost:*)
      [[ "${jaunt_DEV_INSTALL:-0}" == 1 ]] || fail 'HTTP downloads are allowed only in explicit local installer tests.'
      curl --fail --show-error --silent --location "$1" > "$2" ;;
    *) fail 'Downloads must use HTTPS.' ;;
  esac
}
STAGE='Python runtime selection'
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
    fetch 'https://astral.sh/uv/install.sh' "$jaunt_INSTALL_TMP/uv-install.sh"
    TMPDIR="$jaunt_INSTALL_TMP" UV_INSTALL_DIR="$HOME/.local/bin" UV_NO_MODIFY_PATH=1 sh "$jaunt_INSTALL_TMP/uv-install.sh"
    UV="$HOME/.local/bin/uv"
  fi
  TMPDIR="$jaunt_INSTALL_TMP" "$UV" python install 3.12
  PY="$("$UV" python find 3.12)"
fi
STAGE='deployment configuration download'
fetch "${PAGE%/}/config.json" "$jaunt_INSTALL_TMP/config.json"
"$PY" - "$jaunt_INSTALL_TMP/config.json" "${jaunt_DEV_INSTALL:-0}" <<'PY'
import json,sys,urllib.parse
c=json.load(open(sys.argv[1]));r=c.get('relay');u=urllib.parse.urlparse(r or '')
assert c.get('version') == 1, 'Unsupported deployment configuration'
assert r and u.hostname and (u.scheme=='wss' or (sys.argv[2]=='1' and u.scheme=='ws' and u.hostname in ('localhost','127.0.0.1'))), 'Relay has not been deployed. The repository owner must deploy it once before this installer can work.'
assert not (u.username or u.password or u.query or u.fragment), 'Invalid relay URL'
PY
TAG="${jaunt_VERSION:-$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1]))["release"])' "$jaunt_INSTALL_TMP/config.json")}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || fail 'Invalid release tag.'
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'Invalid repository name.'
BASE="${jaunt_RELEASE_BASE:-https://github.com/$REPO/releases/download/$TAG}"
STAGE="release $TAG download and checksum verification"
say "Downloading $TAG"
fetch "${BASE%/}/host-manifest.json" "$jaunt_INSTALL_TMP/host-manifest.json"
WHEEL="$("$PY" - "$jaunt_INSTALL_TMP/host-manifest.json" <<'PY'
import json,re,sys
m=json.load(open(sys.argv[1]));w=m['wheel']
assert re.fullmatch(r'jaunt_host-[A-Za-z0-9_.]+-py3-none-any\.whl',w), 'Invalid wheel name'
assert re.fullmatch(r'[a-f0-9]{64}',m['sha256']), 'Invalid checksum'
print(w)
PY
)"
fetch "${BASE%/}/$WHEEL" "$jaunt_INSTALL_TMP/$WHEEL"
"$PY" - "$jaunt_INSTALL_TMP/host-manifest.json" "$jaunt_INSTALL_TMP/$WHEEL" <<'PY'
import hashlib,json,sys
m=json.load(open(sys.argv[1]));actual=hashlib.sha256(open(sys.argv[2],'rb').read()).hexdigest()
assert actual==m['sha256'],'Release checksum mismatch; nothing installed'
PY
if [[ "$CLIENT_ONLY" == 1 ]]; then
  STAGE='desktop client installation'
  say 'Installing the desktop client without a host or CLI'
  PYTHONPATH="$jaunt_INSTALL_TMP/$WHEEL" "$PY" - "$PAGE" <<'PYCLIENT'
import sys
from jaunt.desktop import install_gui
install_gui(page=sys.argv[1],client_only=True)
PYCLIENT
  say 'Ready. Open jaunt from your applications menu and pair a host.'
  exit 0
fi
SEAMLESS=0
# Legacy hosts still require explicit permission to close their PTYs.
if [[ -x "$PREFIX/current/bin/python" ]]; then
  if "$PREFIX/current/bin/python" -m jaunt.cli status >"$jaunt_INSTALL_TMP/status.json" 2>/dev/null; then
    SEAMLESS="$("$PY" -c 'import json,sys;print(int(json.load(open(sys.argv[1]))["machine"].get("seamlessUpdates",False)))' "$jaunt_INSTALL_TMP/status.json")"
    COUNT="$("$PY" -c 'import json,sys;print(sum(bool(s["alive"] and not s.get("tmux")) for s in json.load(open(sys.argv[1]))["sessions"]))' "$jaunt_INSTALL_TMP/status.json")"
    if [[ "$SEAMLESS" != 1 && "$COUNT" != 0 && "${jaunt_ALLOW_RESTART:-0}" != 1 ]]; then
      fail "$COUNT plain shells are running. Finish them before updating. jaunt_ALLOW_RESTART=1 explicitly authorizes terminating them."
    fi
  fi
fi
mkdir -p "$PREFIX/versions" "$BIN"
TARGET="$PREFIX/versions/${TAG}-$(date +%s)-$$"
STAGE='Python environment and dependencies installation'
say 'Installing into a private environment'
VENV_ARGS=()
# An explicit test-only switch allows offline CI to reuse installed dependencies.
if [[ "${jaunt_DEV_INSTALL:-0}" == 1 && "${jaunt_TEST_SYSTEM_SITE:-0}" == 1 ]]; then VENV_ARGS+=(--system-site-packages); fi
if ! TMPDIR="$jaunt_INSTALL_TMP" "$PY" -m venv "${VENV_ARGS[@]}" "$TARGET"; then
  rm -rf "$TARGET"
  if [[ -z "$UV" ]]; then
    fetch 'https://astral.sh/uv/install.sh' "$jaunt_INSTALL_TMP/uv-install.sh"
    TMPDIR="$jaunt_INSTALL_TMP" UV_INSTALL_DIR="$HOME/.local/bin" UV_NO_MODIFY_PATH=1 sh "$jaunt_INSTALL_TMP/uv-install.sh"
    UV="$HOME/.local/bin/uv"
  fi
  TMPDIR="$jaunt_INSTALL_TMP" "$UV" venv --python "$PY" --seed "$TARGET"
fi
# venv may bundle an outdated pip. Update before resolving release dependencies.
if [[ "${jaunt_DEV_INSTALL:-0}" != 1 || "${jaunt_PIP_NO_DEPS:-0}" != 1 ]]; then
  TMPDIR="$jaunt_INSTALL_TMP" "$TARGET/bin/python" -m pip install --disable-pip-version-check --upgrade 'pip==26.2.1' || fail 'Could not install the reviewed pip version; previous runtime retained.'
fi
# jaunt_PIP_NO_DEPS is only for explicit offline integration tests, never the normal installer.
PIP_ARGS=()
if [[ "${jaunt_DEV_INSTALL:-0}" == 1 && "${jaunt_PIP_NO_DEPS:-0}" == 1 ]]; then PIP_ARGS+=(--no-deps); fi
if ! TMPDIR="$jaunt_INSTALL_TMP" "$TARGET/bin/python" -m pip install --disable-pip-version-check "${PIP_ARGS[@]}" "$jaunt_INSTALL_TMP/$WHEEL"; then
  rm -rf "$TARGET"; fail 'Package installation failed. The previous version was retained.'
fi
# On upgrade, only switch the pointer after the new environment has been verified.
"$TARGET/bin/python" -c 'from jaunt.daemon import Host; from jaunt.cli import main' || fail 'Runtime dependencies are missing.'
if [[ "$SEAMLESS" == 1 ]]; then
  "$TARGET/bin/python" -c 'from jaunt.handoff import restore' || fail 'The new runtime cannot retain active sessions; previous host retained.'
fi
STAGE='safe runtime replacement'
# Only now stop the old runtime. A failed download, checksum, venv or pip install
# leaves the previous daemon running. Recheck: a shell could have started meanwhile.
if [[ "$SEAMLESS" != 1 && -x "$PREFIX/current/bin/python" ]]; then
  if "$PREFIX/current/bin/python" -m jaunt.cli status >"$jaunt_INSTALL_TMP/status.json" 2>/dev/null; then
    COUNT="$("$PY" -c 'import json,sys;print(sum(bool(s["alive"] and not s.get("tmux")) for s in json.load(open(sys.argv[1]))["sessions"]))' "$jaunt_INSTALL_TMP/status.json")"
    [[ "$COUNT" == 0 || "${jaunt_ALLOW_RESTART:-0}" == 1 ]] || fail 'A plain shell started during the upgrade; not stopping it.'
    "$PREFIX/current/bin/python" -c 'import os; from jaunt.cli import control; control("upgrade.stop", {"allowRestart": os.environ.get("jaunt_ALLOW_RESTART") == "1"})' || fail 'Host refused the upgrade shutdown; previous runtime retained.'
    if [[ "${jaunt_NO_SERVICE:-0}" != 1 ]]; then
      "$PREFIX/current/bin/python" -m jaunt.cli service stop >/dev/null 2>&1 || true
    fi
    "$PREFIX/current/bin/python" -m jaunt.cli stop >/dev/null 2>&1 || true
    sleep 1
  fi
fi

"$PY" - "$PREFIX" "$TARGET" "$BIN" <<'PY'
import os,pathlib,shlex,sys
prefix,target,bindir=map(pathlib.Path,sys.argv[1:]);tmp=prefix/'current.new'
if tmp.is_symlink():tmp.unlink()
os.symlink(target,tmp);os.replace(tmp,prefix/'current')
# Normalize before importing even an older wheel, including later CLI invocations.
bootstrap='import os; os.environ.update({k.upper(): v for k,v in tuple(os.environ.items()) if k.startswith("jaunt_")}); from jaunt.cli import main; main()'
wrapper=bindir/'jaunt';wrapper.write_text('#!/bin/sh\nexec '+shlex.quote(str(prefix/'current/bin/python'))+' -c '+shlex.quote(bootstrap)+' "$@"\n');wrapper.chmod(0o755)
PY
"$TARGET/bin/python" - "$PREFIX" "$BIN" "$PAGE" "$REPO" "$TAG" "${jaunt_NO_SERVICE:-0}" <<'PYUPDATE'
import sys
from jaunt.state import state_dir, atomic_json
from jaunt.updates import installation
prefix,bindir,page,repo,tag,no_service=sys.argv[1:]
old=installation()
atomic_json(state_dir()/'installation.json', {'prefix':prefix,'bin':bindir,'page':page.rstrip('/'),'repository':repo,'tag':tag,'noService':no_service=='1','automatic':old.get('automatic',True)})
PYUPDATE
RELAY="$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1]))["relay"])' "$jaunt_INSTALL_TMP/config.json")"
if [[ "$SEAMLESS" == 1 ]]; then
  STAGE='replacing the host runtime while preserving shells'
  "$TARGET/bin/python" - "$TARGET/bin/python" <<'PYHANDOFF'
import sys,time
from jaunt.cli import control
for _ in range(100):
    try:
        control('upgrade.exec',{'python':sys.argv[1]});break
    except ValueError as error:
        if 'actions are still finishing' not in str(error):raise
        time.sleep(.1)
else:raise SystemExit('Host actions did not finish; existing shells were retained.')
for _ in range(1200):
    time.sleep(.1)
    try:
        if control('status').get('runtime')==sys.argv[1]:break
    except (OSError,ValueError):pass
else:raise SystemExit('Runtime replacement was not confirmed. Existing shells were not terminated.')
PYHANDOFF
  export jaunt_PRESERVE_DAEMON=1
fi
STAGE='host configuration and service startup'
if [[ "$SEAMLESS" != 1 ]]; then "$BIN/jaunt" init --relay "$RELAY" --page "${PAGE%/}/"; fi
export PATH="$BIN:$PATH"
if [[ "${jaunt_NO_SERVICE:-0}" != 1 ]]; then
  if ! "$BIN/jaunt" service install; then
    printf '\nNo usable user service manager. Starting in the background instead.\n'
    printf 'This host will need jaunt start after reboot; jaunt doctor explains the current setup.\n'
    "$BIN/jaunt" start
  fi
else "$BIN/jaunt" start; fi
# Desktop setup may require system authorization. Never open a password prompt
# from an unattended host updater, including older updater versions.
if [[ -t 1 && "${jaunt_NO_GUI:-0}" != 1 && ( -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" || "$(uname -s)" == Darwin ) ]]; then
  if "$PY" -c 'import json,sys;sys.exit(not bool(json.load(open(sys.argv[1])).get("desktopRelease")))' "$jaunt_INSTALL_TMP/config.json"; then
    STAGE='desktop app installation'
    "$BIN/jaunt" gui --install-only
  fi
fi
"$BIN/jaunt" --version >/dev/null
if [[ "${jaunt_NO_GUI:-0}" != 1 ]]; then "$PREFIX/current/bin/python" -c 'import jaunt.desktop as d; getattr(d,"save_mode",lambda *_:None)(False)'; fi
say 'Ready'
printf 'Executable: %s/jaunt\n' "$BIN"
printf 'Add %s to PATH if your next shell does not find jaunt.\n' "$BIN"
if [[ "${jaunt_SKIP_PAIR:-0}" != 1 ]]; then "$BIN/jaunt" pair; fi
