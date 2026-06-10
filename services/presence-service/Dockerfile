FROM node:20-alpine
RUN apk add --no-cache openssl openssl-dev
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ ./src/
COPY prisma/ ./prisma/
RUN npx prisma generate --schema=./prisma/schema.prisma
EXPOSE 3004
CMD ["node", "src/index.js"]
