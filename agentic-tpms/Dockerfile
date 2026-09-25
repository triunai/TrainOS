# Agentic TPMS — cockpit (Next.js) and worker share one image; the command differs.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
EXPOSE 3100
# Migrate, then serve. The worker service overrides CMD with `npm run worker`.
CMD ["sh", "-c", "npm run db:migrate && npm run start"]
