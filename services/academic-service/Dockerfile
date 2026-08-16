# services/academic-service/Dockerfile
# Layout monorepo (services/...) : les requires relatifs
# (../../../node_modules/.prisma/client) fonctionnent à l'identique.
FROM node:20-alpine
RUN apk add --no-cache openssl openssl-dev

WORKDIR /app

# Dépendances racine (prisma, @prisma/client) puis dépendances du service
COPY package*.json ./
RUN npm ci
COPY services/academic-service/package*.json ./services/academic-service/
RUN cd services/academic-service && npm ci

# Schéma Prisma partagé + code du service
COPY shared/ ./shared/
COPY services/academic-service/ ./services/academic-service/

# Génération du client Prisma à la racine (chemin attendu par le code)
RUN npx prisma generate --schema=shared/prisma/schema.prisma

EXPOSE 3005

CMD ["node", "services/academic-service/src/index.js"]
