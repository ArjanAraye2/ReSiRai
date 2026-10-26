#!/bin/sh
set -e
mkdir -p ~/reSirai/config
# compose
cat > ~/reSirai/docker-compose.yml <<'YML'
name: resirai

networks:
  default:
    name: arjanpeyman_default
    external: true

volumes:
  images:
    name: resirai_images
  backup:
    name: resirai_backup
  keys:
    name: resirai_keys

services:
  resirai:
    image: resirai:20261027b
    container_name: resirai
    restart: unless-stopped
    ports:
      - "127.0.0.1:5075:8080"
    environment:
      ReSiRaiConfig: /app/config/ReSiRai.config.json
    volumes:
      - ./config/ReSiRai.config.json:/app/config/ReSiRai.config.json:ro
      - images:/var/lib/ReSiRai/images
      - backup:/var/lib/ReSiRai/backup
      - keys:/var/lib/ReSiRai/keys
YML

# config
cat > ~/reSirai/config/ReSiRai.config.json <<'CFG'
{
  "Database": { "Provider": "Postgres" },
  "ConnectionStrings": { "Postgres": "Host=db;Port=5432;Database=resirai;Username=resirai;Password=R7s8R84ai-Clinic" },
  "RemoteAccess": { "PublicHost": "resirai.ir", "PublicScheme": "https", "PublicPort": 443 },
  "RadiologyStorage": { "RootPath": "/var/lib/ReSiRai/images" },
  "Backup": { "RootPath": "/var/lib/ReSiRai/backup", "KeepBackups": 7 }
}
CFG
chmod 600 ~/reSirai/config/ReSiRai.config.json
ls -la ~/reSirai ~/reSirai/config
