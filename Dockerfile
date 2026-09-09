# Chromium is what makes this image worth having: the Markdown-to-PDF exporter
# drives a real browser, and a stock Node image has none. Everything else here
# is an ordinary Next.js build.
FROM node:22-bookworm-slim

# Chromium plus the faces the documents actually ask for. Without the fonts,
# Chromium still renders, but every theme silently falls back to one family.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-dejavu-core \
      fonts-noto-core \
      fonts-noto-color-emoji \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The app probes a list of well-known locations, but naming it here means a
# Debian rename cannot quietly turn PDF export off.
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app

# Copied first so a change to application code does not reinstall the world.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# node_modules stays in the image on purpose: KaTeX and highlight.js
# stylesheets, and their font files, are read from it at render time rather
# than bundled, so pruning to production dependencies would break maths and
# syntax highlighting in exported PDFs.
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# server.mjs rather than `next start`: it also serves the WebSocket that
# introduces the two browsers in a direct transfer.
CMD ["node", "server.mjs"]
