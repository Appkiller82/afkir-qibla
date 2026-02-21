#!/usr/bin/env bash
set -euo pipefail

REMOTE="${1:-origin}"
TARGET_BRANCH="${2:-main}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[ERROR] Not inside a git repository." >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "[ERROR] Git remote '$REMOTE' is not configured." >&2
  echo "Run: git remote add $REMOTE <repo-url>" >&2
  exit 1
fi

echo "[INFO] Current branch : $CURRENT_BRANCH"
echo "[INFO] Push target    : $REMOTE/$TARGET_BRANCH"

git fetch "$REMOTE" "$TARGET_BRANCH" >/dev/null 2>&1 || true

echo "[INFO] Pushing HEAD to $REMOTE/$TARGET_BRANCH ..."
git push "$REMOTE" "HEAD:$TARGET_BRANCH"

echo "[OK] Push complete. Netlify should auto-deploy if site is linked to '$TARGET_BRANCH'."
echo "[TIP] If no deploy appears, check in Netlify: Site settings -> Build & deploy -> Branch to deploy."