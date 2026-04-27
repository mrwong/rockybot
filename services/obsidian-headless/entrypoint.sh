#!/bin/sh
set -e

SETUP_FLAG="/config/.setup-complete"

if [ ! -f "$SETUP_FLAG" ]; then
  echo "Obsidian vault not configured. Run setup from the repo root:"
  echo "  ./machines/dockercompute/docker/services/obsidian-headless/setup.sh"
  echo "Waiting for setup to complete..."
  while [ ! -f "$SETUP_FLAG" ]; do sleep 30; done
  echo "Setup complete — starting sync."
fi

exec ob sync --path /vault --continuous
