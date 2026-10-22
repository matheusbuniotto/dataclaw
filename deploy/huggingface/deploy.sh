#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "  Deploy DataClaw to Hugging Face Spaces (Free Tier)"
echo "=========================================================="

if [ -z "$HF_TOKEN" ]; then
  read -rsp "Enter your Hugging Face Token (Write permission): " HF_TOKEN
  echo ""
fi

if [ -z "$HF_TOKEN" ]; then
  echo "❌ HF_TOKEN is required. Create one at https://huggingface.co/settings/tokens"
  exit 1
fi

echo "🔍 Verifying token..."
WHOAMI_RESP=$(curl -sf -H "Authorization: Bearer $HF_TOKEN" https://huggingface.co/api/whoami-v2) || {
  echo "❌ Invalid token. Make sure it has 'Write' permissions."
  exit 1
}

HF_USER=$(echo "$WHOAMI_RESP" | grep -o '"name":"[^"]*' | head -1 | cut -d'"' -f4)
echo "✅ Authenticated as: $HF_USER"

SPACE_NAME="${SPACE_NAME:-dataclaw}"
read -rp "Space name [$SPACE_NAME]: " INPUT_SPACE_NAME
SPACE_NAME="${INPUT_SPACE_NAME:-$SPACE_NAME}"

echo "📦 Creating Space '$HF_USER/$SPACE_NAME' if needed..."
curl -s -X POST \
  -H "Authorization: Bearer $HF_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"space\", \"name\": \"$SPACE_NAME\", \"space_sdk\": \"docker\", \"private\": false}" \
  https://huggingface.co/api/repos/create > /dev/null || true

# Set secrets if present in env
for KEY in ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY OPENROUTER_API_KEY; do
  VAL="${!KEY}"
  if [ -n "$VAL" ]; then
    echo "🔑 Configuring secret: $KEY"
    curl -s -X POST \
      -H "Authorization: Bearer $HF_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"key\":\"$KEY\",\"value\":\"$VAL\"}" \
      "https://huggingface.co/api/spaces/$HF_USER/$SPACE_NAME/secrets" > /dev/null || true
  fi
done

echo "🚀 Pushing repository to Hugging Face Space..."
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

REMOTE_URL="https://$HF_USER:$HF_TOKEN@huggingface.co/spaces/$HF_USER/$SPACE_NAME"
git push --force "$REMOTE_URL" HEAD:refs/heads/main

echo ""
echo "🎉 Successfully deployed!"
echo "👉 View your Space: https://huggingface.co/spaces/$HF_USER/$SPACE_NAME"
