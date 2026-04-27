#!/bin/bash
# One-time interactive setup for obsidian-headless.
# Run this on the dockercompute VM after first deploying the container.
set -e

echo "=== Obsidian Headless Setup ==="
echo "This will link the local vault to your Obsidian Sync account."
echo ""

echo "Step 1: Log in to Obsidian Sync..."
docker exec -it obsidian-headless ob login

echo ""
echo "Step 2: Available remote vaults:"
docker exec -it obsidian-headless ob sync-list-remote

echo ""
read -rp "Enter the exact vault name to sync: " VAULT_NAME

echo ""
echo "Step 3: Configuring sync for '$VAULT_NAME'..."
docker exec -it obsidian-headless ob sync-setup --vault "$VAULT_NAME" --path /vault

echo ""
echo "Step 4: Marking setup complete and restarting..."
docker exec obsidian-headless touch /config/.setup-complete
docker restart obsidian-headless

echo ""
echo "Done. Monitor with: docker logs -f obsidian-headless"
