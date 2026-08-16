# services/chatbot-service/Dockerfile
# Construit dans le layout monorepo (services/...) pour que les requires
# relatifs (../../../shared, ../../../node_modules/.prisma/client) fonctionnent.
FROM node:20-alpine
RUN apk add --no-cache openssl openssl-dev

WORKDIR /app

# Dépendances racine (prisma, @prisma/client) puis dépendances du service
COPY package*.json ./
RUN npm ci
COPY services/chatbot-service/package*.json ./services/chatbot-service/
RUN cd services/chatbot-service && npm ci

# Schéma Prisma partagé + code du service
COPY shared/ ./shared/
COPY services/chatbot-service/ ./services/chatbot-service/

# Génération du client Prisma à la racine (chemin attendu par le code)
RUN npx prisma generate --schema=shared/prisma/schema.prisma

EXPOSE 8085

CMD ["node", "services/chatbot-service/server.js"]
