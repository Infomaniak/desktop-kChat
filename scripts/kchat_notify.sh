#!/bin/bash
set -eu

TEXT="${1:-}"

jq --null-input \
    --arg icon_url "https://infomaniak.kchat.infomaniak.com/static/emoji/kchat.png" \
    --arg username "DesktopReleaseBot" \
    --arg text "$TEXT" \
    '{"username":$username,"icon_url": $icon_url, "text": $text }' > /tmp/webhook-data.json
curl --fail-with-body --max-time 10 -i -H "Content-Type: application/json" -X POST -d @/tmp/webhook-data.json "${RELEASE_WEBHOOK_URL:-}" || echo "::warning::kChat notification failed (check RELEASE_WEBHOOK_URL secret), message was: $TEXT"
