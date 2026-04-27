FROM node:20-alpine
RUN apk add --no-cache git rsync

# Bake Quartz in at build time (pinned version, no internet needed at runtime)
RUN git clone --depth 1 --branch v4.4.0 https://github.com/jackyzha0/quartz.git /quartz-src \
    && cd /quartz-src && npm ci \
    && chown -R node:node /quartz-src

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/

CMD ["node", "src/index.js"]
