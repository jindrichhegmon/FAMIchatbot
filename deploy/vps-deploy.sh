#!/usr/bin/env bash
# Nasazení na VPS (stejný princip jako jhn-apps): rsync + npm ci + pm2 reload
# Použití: HOST=jhnapps@95.216.201.2 ./deploy/vps-deploy.sh
set -euo pipefail
HOST="${HOST:?HOST=uzivatel@server}"
DIR="${DIR:-/opt/fami-chatbot}"
rsync -az --delete --exclude node_modules --exclude logs --exclude .env --exclude .git ./ "$HOST:$DIR/"
ssh "$HOST" "cd $DIR && npm ci --omit=dev && (pm2 reload fami-chatbot || pm2 start deploy/ecosystem.config.cjs) && pm2 save"
echo "Hotovo: $HOST:$DIR"
