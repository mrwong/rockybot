# Quartz v4.5+ requires Node >=22 (drops Node 20); node:20 is EOL as of 2026-04.
FROM node:22-alpine
# coreutils: Quartz v4.5+'s CLI shebang is `#!/usr/bin/env -S node …`; BusyBox
# env can't parse `-S`, so the build fails without GNU env. See td-340a72.
RUN apk add --no-cache git rsync coreutils

# Bake Quartz in at build time (pinned version, no internet needed at runtime)
RUN git clone --depth 1 --branch v4.5.2 https://github.com/jackyzha0/quartz.git /quartz-src \
    && cd /quartz-src && npm ci \
    && chown -R node:node /quartz-src

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/

CMD ["node", "src/index.js"]
