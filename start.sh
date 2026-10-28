#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
mkdir -p .runtime
chmod 700 .runtime
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
if [[ ! -f .runtime/requirements.installed ]] || ! cmp -s requirements.lock .runtime/requirements.installed; then
  .venv/bin/python -m pip install -r requirements.lock
  cp requirements.lock .runtime/requirements.installed
fi
if [[ ! -d frontend/node_modules ]] || [[ ! -f .runtime/npm-lock.installed ]] || ! cmp -s frontend/package-lock.json .runtime/npm-lock.installed; then
  npm --prefix frontend ci --no-audit --no-fund
  cp frontend/package-lock.json .runtime/npm-lock.installed
fi
npm --prefix frontend run build
exec .venv/bin/python -m backend.app
