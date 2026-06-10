FROM node:20-alpine

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances
RUN npm ci --only=production

# Copier le code source
COPY src/ ./src/

# Copier le schéma Prisma partagé
COPY ../../shared/prisma/schema.prisma ./prisma/schema.prisma

# Copier le service email partagé
COPY ../../shared/email/ ./shared/email/

# Générer le client Prisma
RUN npx prisma generate --schema=./prisma/schema.prisma

EXPOSE 3001

CMD ["node", "src/index.js"]
