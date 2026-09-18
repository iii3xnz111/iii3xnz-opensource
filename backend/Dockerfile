FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHON=/usr/bin/python3

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/iii3xnz-entrypoint
RUN chmod +x /usr/local/bin/iii3xnz-entrypoint

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/iii3xnz-entrypoint"]
CMD ["node", "src/server.js"]
