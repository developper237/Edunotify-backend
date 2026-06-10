#!/bin/bash
# infrastructure/start.sh
# Lance EduNotify backend complet

set -e

echo "🚀 Démarrage EduNotify Backend..."

# Vérifier que .env existe
if [ ! -f .env ]; then
  echo "❌ Fichier .env manquant. Copie .env.example et remplis les valeurs."
  cp .env.example .env
  echo "✅ .env créé depuis .env.example — édite-le avant de relancer."
  exit 1
fi

# Lancer l'infrastructure
echo "📦 Lancement PostgreSQL, Redis, RabbitMQ..."
docker-compose up -d postgres redis rabbitmq

# Attendre que PostgreSQL soit prêt
echo "⏳ Attente PostgreSQL..."
until docker-compose exec postgres pg_isready -U edunotify > /dev/null 2>&1; do
  sleep 1
done
echo "✅ PostgreSQL prêt"

# Installer les dépendances auth-service si nécessaire
if [ ! -d "services/auth-service/node_modules" ]; then
  echo "📦 Installation dépendances auth-service..."
  cd services/auth-service && npm install && cd ../..
fi

# Pousser le schéma Prisma
echo "🗃️  Création des tables..."
cd services/auth-service
DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d '=' -f2-) \
  npx prisma db push --schema=../../shared/prisma/schema.prisma --accept-data-loss
echo "✅ Tables créées"

# Seed super admin
echo "🌱 Création du super admin..."
node src/utils/seed.js
cd ../..

# Lancer tous les services
echo "🎯 Lancement de tous les services..."
docker-compose up -d

echo ""
echo "✅ EduNotify Backend démarré !"
echo ""
echo "  API Gateway  → http://localhost:8080"
echo "  RabbitMQ UI  → http://localhost:15672"
echo ""
echo "  Super Admin:"
echo "  Email    : superadmin@edunotify.cm"
echo "  Password : EduNotify@2025!"
echo ""
