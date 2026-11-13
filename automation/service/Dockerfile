# syntax=docker/dockerfile:1
# Serviço convexa-automacao (bot, Pix, Google Agenda, Alexa, API do painel)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Atrás de proxy corporativo com certificado próprio:
#   docker build --secret id=npm_ca,src=/caminho/ca.crt ...   (sem o segredo, nada muda)
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
 && mkdir -p dist/db/migrations && cp src/db/migrations/*.sql dist/db/migrations/ \
 && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3100/health >/dev/null || exit 1
CMD ["node", "dist/server.js"]
