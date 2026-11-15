#!/usr/bin/env bash
# Pulls a read-only, anonymised play report from a deployed NanoParty (Docker Compose) over SSH.
#
#   tools/pull-report.sh <ssh-target> <remote-project-dir> --list
#   tools/pull-report.sh <ssh-target> <remote-project-dir> --party <sessionId> [--with-chat] [--with-state]
#   tools/pull-report.sh <ssh-target> <remote-project-dir> --since 2026-11-14 [--issues]
#   tools/pull-report.sh local . --party <sessionId>        # the Compose stack on this machine, no SSH
#
# What it does on the server: runs `node dist/report.js` inside the app container (a read-only
# database session; no migration, no restart, no write), tars the result to stdout, and removes
# its temporary folder inside the container. Nothing else is executed, no port is opened.
# Reports land in ./reports/pulled/<timestamp>/ (ignored by git). Chat text and game secrets are
# only included when you pass --with-chat / --with-state; credentials are never exported.
set -euo pipefail

target="${1:?ssh target (user@host) or 'local'}"
dir="${2:?project directory on the server}"
shift 2
[ $# -gt 0 ] || { echo "give --list, --party <id> or --since <date>" >&2; exit 2; }

# Only the report tool's own options are passed on; anything else is refused.
for arg in "$@"; do
  case "$arg" in
    --list|--party|--since|--issues|--with-chat|--with-state) ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) [[ "$arg" =~ ^[A-Za-z0-9_:.-]+$ ]] || { echo "unexpected value: $arg" >&2; exit 2; } ;;
  esac
done

run() {
  if [ "$target" = "local" ]; then (cd "$dir" && sh -c "$1"); else ssh "$target" "cd '$dir' && $1"; fi
}

if [ "$1" = "--list" ]; then
  run "docker compose exec -T app node dist/report.js --list"
  exit 0
fi

stamp="$(date +%Y%m%d-%H%M%S)"
out="reports/pulled/$stamp"
mkdir -p "$out"
remote="docker compose exec -T app sh -c 'rm -rf /tmp/np-report && node dist/report.js $* --out /tmp/np-report >&2 && tar -C /tmp -cz np-report; rm -rf /tmp/np-report'"
run "$remote" | tar -xz -C "$out" --strip-components=1
echo "report: $out"
find "$out" -name summary.md | head -20
