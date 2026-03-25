FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
  chromium \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3101
ENV FRONTEND_PORT=3100
ENV SER_DATA_DIR=/app/persist/data
ENV WHATSAPP_AUTH_PATH=/app/persist/whatsapp_auth
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN mkdir -p /app/persist/data /app/persist/whatsapp_auth /app/.wwebjs_cache

EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=8s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3101/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
