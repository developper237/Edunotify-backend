# EduNotify Backend — Guide de démarrage

## Prérequis
- Docker Desktop installé et lancé
- Node.js 20+
- Git

## Démarrage en 5 étapes

### 1. Cloner et configurer
```bash
cd edunotify-backend
cp .env.example .env
# Édite .env avec tes vraies valeurs Gmail
```

### 2. Configurer Gmail App Password
1. Va sur https://myaccount.google.com/security
2. Active la validation en 2 étapes
3. Va sur https://myaccount.google.com/apppasswords
4. Crée un mot de passe pour "EduNotify"
5. Copie le mot de passe dans .env → GMAIL_APP_PASSWORD

### 3. Lancer l'infrastructure
```bash
docker-compose up -d postgres redis rabbitmq
# Attendre 10 secondes que PostgreSQL démarre
```

### 4. Initialiser la base de données
```bash
cd services/auth-service
npm install
npm run db:push    # Crée les tables
npm run db:seed    # Crée le super admin
```

### 5. Lancer tous les services
```bash
# Retour à la racine
cd ../..
docker-compose up -d
```

## Accès

| Service | URL | Description |
|---------|-----|-------------|
| API Gateway | http://localhost:8080 | Point d'entrée unique |
| Auth Service | http://localhost:3001 | Authentification |
| Presence Service | http://localhost:3004 | Sessions OTP |
| Notification Service | http://localhost:3003 | Notifications |
| RabbitMQ Dashboard | http://localhost:15672 | admin / edunotify_rabbit |

## Super Admin initial
```
Email    : superadmin@edunotify.cm
Password : EduNotify@2025!
```
⚠️ Changez ce mot de passe en production !

## Routes principales

### Auth
```
POST /auth/login                     → Connexion
POST /auth/refresh                   → Renouveler le token
POST /auth/logout                    → Déconnexion
POST /auth/change-password           → Changer mot de passe
POST /auth/first-login               → Premier login (forcer nouveau mdp)
GET  /auth/me                        → Profil connecté
```

### Cascade (création comptes)
```
POST /auth/cascade/etablissement     → Super Admin crée étab + admin
POST /auth/cascade/departement       → Admin crée dept + chef dept
POST /auth/cascade/classe            → Chef crée classe + délégué
GET  /auth/cascade/etablissements    → Liste établissements
GET  /auth/cascade/departements      → Liste départements
GET  /auth/cascade/classes           → Liste classes
```

### CSV Import
```
POST /auth/csv/import                → Délégué importe liste étudiants
GET  /auth/csv/template              → Télécharger modèle CSV
GET  /auth/csv/classe/:classeId      → Liste étudiants d'une classe
```

### Présence
```
POST /presence/sessions              → Délégué lance session OTP
PUT  /presence/sessions/:id/fermer   → Délégué ferme session
POST /presence/confirmer             → Étudiant confirme présence
GET  /presence/active/:classeId      → Session active d'une classe
GET  /presence/historique/:classeId  → Historique sessions
GET  /presence/etudiant/historique   → Historique présences étudiant
```

### Notifications
```
POST /notifications/envoyer          → Envoyer notification
POST /notifications/sondage          → Lancer sondage
POST /notifications/sondage/:id/voter → Voter
GET  /notifications/mes-notifications → Mes notifications
PUT  /notifications/:id/lire         → Marquer lu
PUT  /notifications/tout-lire        → Tout marquer lu
GET  /notifications/sondage/:id/resultats → Résultats sondage
```

## Variables d'environnement

```env
JWT_SECRET=                    # Clé secrète JWT (min 32 chars)
JWT_REFRESH_SECRET=            # Clé refresh token
GMAIL_USER=                    # ton.email@gmail.com
GMAIL_APP_PASSWORD=            # Mot de passe d'application Gmail
APP_URL=http://localhost:8080  # URL de l'API
FIREBASE_PROJECT_ID=           # (optionnel - pour push notifications)
FIREBASE_PRIVATE_KEY=          
FIREBASE_CLIENT_EMAIL=         
```

## Connecter le frontend Flutter

Dans `lib/core/api_client.dart`, remplace :
```dart
// Émulateur Android
static const baseUrl = 'http://10.0.2.2:8080';
// Appareil physique sur le même réseau WiFi
static const baseUrl = 'http://192.168.1.X:8080';
// Production
static const baseUrl = 'https://api.edunotify.cm';
```
