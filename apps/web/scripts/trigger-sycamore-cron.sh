#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 /api/sycamore/sync|/api/sycamore/sync/jobs/run" >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 64
fi

PATH_ARG="$1"
case "$PATH_ARG" in
  /api/sycamore/sync|/api/sycamore/sync/jobs/run)
    ;;
  *)
    usage
    exit 64
    ;;
esac

: "${SIGNAL_BASE_URL:?SIGNAL_BASE_URL is required}"
: "${SIGNAL_CRON_SECRET:?SIGNAL_CRON_SECRET is required}"

BASE_URL="${SIGNAL_BASE_URL%/}"
REQUEST_URL="${BASE_URL}${PATH_ARG}"
BODY_FILE="$(mktemp)"

cleanup() {
  rm -f "$BODY_FILE"
}

trap cleanup EXIT

HTTP_STATUS="$(
  curl \
    --silent \
    --show-error \
    --location \
    --max-time 330 \
    --output "$BODY_FILE" \
    --write-out '%{http_code}' \
    --header "Authorization: Bearer ${SIGNAL_CRON_SECRET}" \
    --header "Accept: application/json" \
    "$REQUEST_URL"
)"

RESPONSE_BODY="$(cat "$BODY_FILE")"
printf '%s\n' "$RESPONSE_BODY"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '%s' "$RESPONSE_BODY" | python3 - "$PATH_ARG" "$HTTP_STATUS" <<'PY'
import json
import os
import sys

path = sys.argv[1]
http_status = sys.argv[2]
summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
body = sys.stdin.read()

def display(value):
    if value is None or value == "":
        return "n/a"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)

fields = {
    "Endpoint": path,
    "HTTP status": http_status,
    "alreadyQueued": None,
    "executed": None,
    "jobId": None,
    "batchId": None,
    "batchStatus": None,
    "syncMode": None,
    "windowStart": None,
    "windowEnd": None,
}

parsed = None
if body.strip():
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        parsed = None

if isinstance(parsed, dict):
    sycamore_sync = parsed.get("sycamoreSync") or {}
    window = sycamore_sync.get("window") or {}
    fields["alreadyQueued"] = parsed.get("alreadyQueued")
    fields["executed"] = parsed.get("executed")
    fields["jobId"] = parsed.get("jobId")
    fields["batchId"] = sycamore_sync.get("batchId")
    fields["batchStatus"] = sycamore_sync.get("status")
    fields["syncMode"] = sycamore_sync.get("syncMode")
    fields["windowStart"] = window.get("startDate")
    fields["windowEnd"] = window.get("endDate")

with open(summary_path, "a", encoding="utf-8") as summary:
    summary.write("### Sycamore scheduler trigger\n\n")
    for label, value in fields.items():
        summary.write(f"- {label}: {display(value)}\n")
    if parsed is None and body.strip():
        summary.write("\nRaw response:\n\n```json\n")
        summary.write(body[:4000])
        summary.write("\n```\n")
PY
fi

if [[ ! "$HTTP_STATUS" =~ ^2[0-9][0-9]$ ]]; then
  echo "Sycamore scheduler request failed with HTTP ${HTTP_STATUS} for ${REQUEST_URL}." >&2
  exit 1
fi
