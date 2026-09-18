# Shared helpers for mise-tasks/. SOURCED by tasks, never run as one, so it has no +x:
# mise discovers executable files here as tasks, and a runnable helper is a phantom task.
#
#   source "${0:A:h}/_lib.sh"

if [[ -t 1 && -z ${NO_COLOR:-} ]]; then
  _b=$'\033[1m'; _d=$'\033[2m'; _r=$'\033[31m'; _g=$'\033[32m'; _y=$'\033[33m'; _x=$'\033[0m'
else
  _b=; _d=; _r=; _g=; _y=; _x=
fi

header()  { printf '\n%s%s%s\n' "$_b" "$1" "$_x" }
info()    { printf '  %s\n' "$1" }
success() { printf '  %s✓%s %s\n' "$_g" "$_x" "$1" }
warn()    { printf '  %s▲%s %s\n' "$_y" "$_x" "$1" }
error()   { printf '  %s✗%s %s\n' "$_r" "$_x" "$1" >&2 }
dim()     { printf '  %s%s%s\n' "$_d" "$1" "$_x" }
die()     { error "$1"; exit 1 }

ask() {
  printf '%s%s%s ' "$_b" "$1" "$_x"
  [[ -n ${2:-} ]] && printf '[%s] ' "$2"
  read -r REPLY
  [[ -z $REPLY ]] && REPLY=${2:-}
}

confirm() {
  printf '%s%s%s [y/N] ' "$_b" "$1" "$_x"
  read -r _answer
  [[ $_answer == [yY]* ]]
}

# This machine's MagicDNS name, empty when Tailscale is not installed or not up, and the
# tailnet's cert domains, empty until HTTPS is enabled in the admin console. Both come from one
# status call. HTTPS is not a nicety here: the session cookie is Secure, so a browser silently
# drops it over plain http on anything but localhost and the login just loops.
tailscale_facts() {
  local bin
  bin=$(command -v tailscale) || return 0
  "$bin" status --json 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    if d.get("BackendState") != "Running":
        raise SystemExit
    print(d.get("Self", {}).get("DNSName", "").rstrip("."))
    print("yes" if d.get("CertDomains") else "no")
except Exception:
    pass
' 2>/dev/null
}

# Every task here drives npm, which has to run where package.json is, not wherever
# `mise run` was typed.
cd "${MISE_PROJECT_ROOT:-${0:A:h}/..}"
