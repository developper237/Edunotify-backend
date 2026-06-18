# Infrastructure
docker-compose -f C:\Users\serge\Downloads\edunotify-backend\docker-compose.yml up -d

Start-Sleep -Seconds 3

# Auth service
Start-Process powershell -ArgumentList '-NoExit', '-Command', {
  cd C:\Users\serge\Downloads\edunotify-backend\services\auth-service
  $env:DATABASE_URL="postgresql://edunotify:edunotify_secret@localhost:5432/edunotify"
  $env:JWT_SECRET="6c297ba403c2c51e8fd39ba10ab2cba7877c287372572da06da70e4ab4dacd98"
  $env:JWT_REFRESH_SECRET="5fc311a3c5cac53194974752e3a6919ee014aed5f970787ad12e3ddb00d74924"
  $env:GMAIL_USER="sergende695@gmail.com"
  $env:GMAIL_APP_PASSWORD="kcwammuyntzkzmuu"
  node src/index.js
}

# Notification service
Start-Process powershell -ArgumentList '-NoExit', '-Command', {
  cd C:\Users\serge\Downloads\edunotify-backend\services\notification-service
  $env:DATABASE_URL="postgresql://edunotify:edunotify_secret@localhost:5432/edunotify"
  $env:PORT="3003"
  node src/index.js
}

# Presence service
Start-Process powershell -ArgumentList '-NoExit', '-Command', {
  cd C:\Users\serge\Downloads\edunotify-backend\services\presence-service
  $env:DATABASE_URL="postgresql://edunotify:edunotify_secret@localhost:5432/edunotify"
  $env:REDIS_URL="redis://:edunotify_redis@localhost:6379"
  $env:PORT="3004"
  node src/index.js
}

# Academic service
Start-Process powershell -ArgumentList '-NoExit', '-Command', {
  cd C:\Users\serge\Downloads\edunotify-backend\services\academic-service
  $env:DATABASE_URL="postgresql://edunotify:edunotify_secret@localhost:5432/edunotify"
  $env:PORT="3005"
  $env:GMAIL_USER="sergende695@gmail.com"
  $env:GMAIL_APP_PASSWORD="kcwammuyntzkzmuu"
  node src/index.js
}

Write-Host "Tous les services sont démarrés !" -ForegroundColor Green
