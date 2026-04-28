# Build context must be the repo root so vault-scaffold/ is accessible.
# docker build -f services/bot/Dockerfile .
FROM node:20-alpine

# Install Claude CLI (the `claude` binary that watchers invoke)
RUN npm install -g @anthropic-ai/claude-code

# Claude Code needs to write lock files and config updates to the HOME directory.
# node:20-alpine ships with uid 1000 as "node" with home /home/node, but operators
# commonly set HOME=/home/ubuntu to match the host user — create that directory now
# so the running user (1000) can write to it without hitting EACCES.
RUN mkdir -p /home/ubuntu && chown node:node /home/ubuntu

# Copy vault scaffold first — this is baked into the image so the bot can seed
# any vault it's pointed at without needing a separate sidecar
COPY vault-scaffold/ /vault-scaffold/
COPY templates/ /vault-scaffold/templates/

WORKDIR /app
COPY services/bot/package.json ./
RUN npm install --production
COPY services/bot/src/ ./src/

CMD ["node", "src/index.js"]
