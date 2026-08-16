# services/notification-service/Dockerfile
# Layout monorepo (services/...) : les requires relatifs
# (../../../node_modules/.prisma/client) fonctionnent à l'identique.
FROM node:20-alpine
RUN apk add --no-cache openssl openssl-dev

WORKDIR /app

# Dépendances racine (prisma, @prisma/client) puis dépendances du service
COPY package*.json ./
RUN npm ci
COPY services/notification-service/package*.json ./services/notification-service/
RUN cd services/notification-service && npm ci

# Schéma Prisma partagé + code du service
COPY shared/ ./shared/
COPY services/notification-service/ ./services/notification-service/

# Génération du client Prisma à la racine (chemin attendu par le code)
RUN npx prisma generate --schema=shared/prisma/schema.prisma

EXPOSE 3003

CMD ["node", "services/notification-service/src/index.js"]
