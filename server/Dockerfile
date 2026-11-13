# Murmel-API: Node 24 führt TypeScript direkt aus (Type-Stripping), kein Build-Schritt.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# keine Installationsskripte von Abhängigkeiten ausführen, nur Laufzeit-Pakete
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY migrations ./migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "src/index.ts"]
