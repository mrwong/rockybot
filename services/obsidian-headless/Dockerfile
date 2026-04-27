FROM node:22-alpine
RUN npm install -g obsidian-headless
ENV HOME=/config
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
VOLUME ["/vault", "/config"]
ENTRYPOINT ["/entrypoint.sh"]
