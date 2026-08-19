# services/billing-service/Dockerfile
# Layout monorepo (services/...) : les requires relatifs
# (../../../node_modules/.prisma/client) fonctionnent à l'identique.
FROM node:20-alpine
RUN apk add --no-cache openssl openssl-dev

WORKDIR /app

# Dépendances racine (prisma, @prisma/client) puis dépendances du service
COPY package*.json ./
RUN npm install --omit=dev
COPY services/billing-service/package*.json ./services/billing-service/
RUN cd services/billing-service && npm install --omit=dev

# Schéma Prisma partagé + code du service
COPY shared/ ./shared/
COPY services/billing-service/ ./services/billing-service/

# Génération du client Prisma à la racine (chemin attendu par le code)
RUN npx prisma generate --schema=shared/prisma/schema.prisma

EXPOSE 3007

CMD ["node", "services/billing-service/src/index.js"]
