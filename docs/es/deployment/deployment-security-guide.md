---
title: "Guía de despliegue y seguridad en VPS"
description: "Despliega InsForge en un VPS Linux genérico, protégelo con buenas prácticas de firewall, SSH y TLS, y mantenlo con actualizaciones y reversiones seguras."
---

# Guía de despliegue y seguridad para instalación en VPS

Esta guía completa cubre el despliegue de InsForge en un VPS (servidor privado virtual) genérico para producción, el endurecimiento de tu instancia con buenas prácticas de seguridad, y su mantenimiento a lo largo del tiempo con procedimientos seguros de actualización y reversión.

> **Alcance**: Esta guía es independiente del proveedor. Funciona en cualquier VPS con Linux —se recomienda Ubuntu/Debian— ya sea de proveedores como DigitalOcean, Hetzner, Linode, Vultr, OVH, o un servidor bare-metal. Para guías específicas de nube (AWS EC2, GCP, Azure, Render), consulta las demás guías de esta sección.

---

## 📋 Tabla de contenidos

- [Requisitos previos](#prerequisites)
- [Parte 1 — Despliegue](#part-1--deployment)
  - [Requisitos del servidor](#1-server-requirements)
  - [Configuración inicial del servidor](#2-initial-server-setup)
  - [Instalar Docker y Docker Compose](#3-install-docker--docker-compose)
  - [Desplegar InsForge con Docker Compose](#4-deploy-insforge-with-docker-compose)
  - [Configuración de variables de entorno](#5-environment-variable-configuration)
  - [Configuración del proxy inverso](#6-reverse-proxy-setup)
  - [Configuración de HTTPS / TLS](#7-https--tls-setup)
- [Parte 2 — Seguridad](#part-2--security)
  - [Gestión de puertos](#8-port-management)
  - [Configuración del firewall (UFW)](#9-firewall-setup-ufw)
  - [Ejecutar servicios como usuario no root](#10-run-services-as-a-non-root-user)
  - [Endurecimiento de SSH](#11-ssh-hardening)
  - [Seguridad de Docker](#12-docker-security)
  - [Gestión de secretos](#13-secrets-management)
- [Parte 3 — Actualización y mantenimiento](#part-3--updating--maintenance)
  - [Copia de seguridad previa a la actualización](#14-pre-update-backup)
  - [Actualizar InsForge](#15-updating-insforge)
  - [Procedimiento de reversión](#16-rollback-procedure)
  - [Copias de seguridad automatizadas](#17-automated-backups)
  - [Monitorización y comprobaciones de estado](#18-monitoring--health-checks)
- [Referencia rápida](#quick-reference)
- [Solución de problemas](#troubleshooting)

---

## Requisitos previos

Antes de empezar, asegúrate de tener:

- Un VPS con **Ubuntu 22.04 LTS** o **Ubuntu 24.04 LTS** (Debian 12 también funciona)
- **Acceso root o sudo** al servidor
- Un **nombre de dominio** registrado (recomendado para producción)
- Familiaridad básica con la línea de comandos de Linux y SSH

---

## Parte 1 — Despliegue

### 1. Requisitos del servidor

| Resource      | Minimum        | Recommended     |
|---------------|----------------|-----------------|
| **CPU**       | 2 vCPU         | 4 vCPU          |
| **RAM**       | 2 GB           | 4 GB+           |
| **Storage**   | 20 GB SSD      | 40 GB+ SSD      |
| **OS**        | Ubuntu 22.04+  | Ubuntu 24.04 LTS|
| **Network**   | Public IPv4    | Public IPv4 + IPv6 |

> 💡 **Consejo**: Para cargas de producción con múltiples usuarios, empieza con 4 GB de RAM. Monitoriza el uso con `docker stats` y escala verticalmente según sea necesario.

InsForge consta de **4 servicios** que se ejecutan juntos:

| Service       | Description                        | Internal Port |
|---------------|------------------------------------|---------------|
| **PostgreSQL**| Primary database                   | 5432          |
| **PostgREST** | Auto-generated REST API layer      | 3000 (mapped to 5430) |
| **InsForge**  | Node.js backend + dashboard        | 7130          |
| **Deno**      | Serverless functions runtime       | 7133          |

---

### 2. Configuración inicial del servidor

#### 2.1 Conéctate a tu VPS

```bash
ssh root@your-server-ip
```

#### 2.2 Actualiza los paquetes del sistema

```bash
apt update && apt upgrade -y
```

#### 2.3 Crea un usuario de despliegue (no root)

Nunca ejecutes servicios de producción como root. Crea un usuario dedicado:

```bash
# Create the deploy user and add to sudo group
adduser deploy
usermod -aG sudo deploy

# Switch to the deploy user
su - deploy
```

#### 2.4 Configura la zona horaria

```bash
sudo timedatectl set-timezone UTC
```

#### 2.5 Habilita las actualizaciones de seguridad automáticas

```bash
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

### 3. Instalar Docker y Docker Compose

#### 3.1 Instala el motor de Docker

```bash
# Add Docker's official GPG key
sudo apt install ca-certificates curl gnupg -y
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the Docker repository
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y
```

#### 3.2 Añade el usuario de despliegue al grupo de Docker

```bash
sudo usermod -aG docker deploy
newgrp docker
```

#### 3.3 Verifica la instalación de Docker

```bash
docker --version
docker compose version
docker run hello-world
```

> ⚠️ **Nota de seguridad**: Añadir un usuario al grupo `docker` le otorga privilegios equivalentes a root en el host. Esto es aceptable para un usuario de despliegue dedicado, pero no debe hacerse con cuentas de propósito general en servidores compartidos.

---

### 4. Desplegar InsForge con Docker Compose

#### 4.1 Clona el repositorio

```bash
curl -fsSL https://raw.githubusercontent.com/InsForge/InsForge/main/deploy/setup.sh | sh -s ~/insforge
```

Descarga los archivos que el stack lee y genera `JWT_SECRET`, `ENCRYPTION_KEY`, `ROOT_ADMIN_PASSWORD` y `POSTGRES_PASSWORD` en `.env`. No arranca nada.

> ¿Prefieres no pasar un script a la shell? Léelo primero:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/InsForge/InsForge/main/deploy/setup.sh -o setup.sh
> less setup.sh
> sh setup.sh ~/insforge
> ```

#### 4.2 Inicia InsForge

```bash
cd ~/insforge
docker compose up -d
```

#### 4.3 Verifica que todos los servicios estén en ejecución

```bash
docker compose ps
```

Deberías ver 4 contenedores en estado `running` o `healthy`:

```text
NAME            SERVICE     STATUS
insforge        insforge    running
postgres        postgres    healthy
postgrest       postgrest   healthy
deno            deno        running
```

#### 4.4 Prueba el endpoint de estado (health)

```bash
curl http://localhost:7130/api/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "version": "1.x.x",
  "service": "Insforge OSS Backend",
  "timestamp": "2026-..."
}
```

---

### 5. Configuración de variables de entorno

Edita tu archivo `.env` para configurar InsForge para producción:

```bash
nano ~/insforge/.env
```

#### 5.1 Variables obligatorias

Estas **deben** cambiarse respecto a los valores predeterminados antes de pasar a producción:

```env
# ── Security (CRITICAL — generate unique values) ──────────────
JWT_SECRET=<output of: openssl rand -base64 32>
ENCRYPTION_KEY=<output of: openssl rand -base64 24>
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=<strong-unique-password>

# ── Public URL (must match your domain/IP) ────────────────────
API_BASE_URL=https://insforge.yourdomain.com
VITE_API_BASE_URL=https://insforge.yourdomain.com
```

Genera secretos seguros directamente desde la terminal:

```bash
# JWT secret (32+ characters)
openssl rand -base64 32

# Encryption key (separate from JWT_SECRET)
openssl rand -base64 24

# Admin password
openssl rand -base64 18
```

> ⚠️ **Importante**: `JWT_SECRET` y `ENCRYPTION_KEY` deben ser valores **diferentes**. Si `ENCRYPTION_KEY` no está definida, InsForge recurre a `JWT_SECRET` como respaldo — pero rotar `JWT_SECRET` más adelante corromperá de forma permanente todos los secretos almacenados (claves de API, tokens OAuth, etc.).

#### 5.2 Variables de base de datos

`setup.sh` ya generó `POSTGRES_PASSWORD`. Postgres solo la lee cuando inicializa
el clúster, así que cambiarla después de que 4.2 haya arrancado el stack no
cambia la contraseña de la base de datos: déjala tal cual salvo que sea una
instalación nueva y no hayas arrancado nada todavía.

```env
POSTGRES_USER=postgres
POSTGRES_DB=insforge
```

#### 5.3 Variables de puertos

Puertos predeterminados que usa InsForge:

```env
POSTGRES_PORT=5432
POSTGREST_PORT=5430
APP_PORT=7130
AUTH_PORT=7131
DENO_PORT=7133
```

> 💡 Puedes cambiarlos si entran en conflicto con otros servicios de tu VPS.

`COMPOSE_PROJECT_NAME` prefija cada contenedor, volumen y red:

```env
COMPOSE_PROJECT_NAME=insforge
```

> ⚠️ Una segunda instancia en el mismo host necesita su propio valor, además de sus propios puertos. Si dos archivos `.env` comparten este nombre, ejecutar `docker compose up` en uno de ellos adopta y recrea los contenedores del otro.

#### 5.4 Requeridas para despliegues

Estas variables solo son necesarias si planeas usar las **funciones de despliegue** de InsForge (desplegar proyectos a través del panel). Si no necesitas despliegues, omite esta sección.

```env
# ── Deployments ──────────────────────────────────────────────
# Project ID used by OpenRouter AI token renewal and Vercel deployments
PROJECT_ID=your-project-id
```

> ⚠️ `deploy/docker-compose/docker-compose.yml` no pasa `PROJECT_ID` al contenedor `insforge`. Añádela al bloque `environment` de ese servicio para usarla.

Las subidas zip heredadas a `POST /api/deployments` también necesitan un bucket S3: configúralo con las variables `S3_*` de 5.5.

#### 5.5 Variables opcionales

```env
# ── OAuth Providers ───────────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
X_CLIENT_ID=
X_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=

# ── AI / LLM ─────────────────────────────────────────────────
OPENROUTER_API_KEY=

# ── Storage (S3-compatible — leave empty for local storage) ──
# For general file storage only (not deployments). If omitted, local
# filesystem storage is used automatically. See the "Self-hosted storage"
# guide for bring-your-own S3, bundled MinIO/RustFS overlays, and the
# S3-compatible gateway.
S3_BUCKET=
S3_REGION=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
# Custom S3-compatible endpoint (MinIO, RustFS, Wasabi, R2, COS, OSS ...);
# leave empty for AWS S3
S3_ENDPOINT_URL=
S3_FORCE_PATH_STYLE=true
# Set to false to proxy object bytes through the backend (required when the
# endpoint is not reachable by browsers)
S3_USE_PRESIGNED_URLS=

# ── Deno Functions ────────────────────────────────────────────
WORKER_TIMEOUT_MS=60000
```

Después de editar, reinicia los servicios para aplicar los cambios:

```bash
cd ~/insforge
docker compose down
docker compose up -d
```

---

### 6. Configuración del proxy inverso

Un proxy inverso se sitúa delante de InsForge, encargándose de la terminación TLS, HTTP/2 y una URL limpia sin números de puerto.

#### Opción A: Nginx (recomendado)

##### 6.1 Instala Nginx

```bash
sudo apt install nginx -y
```

##### 6.2 Crea la configuración del sitio

```bash
sudo nano /etc/nginx/sites-available/insforge
```

Pega la siguiente configuración — sustituye `insforge.yourdomain.com` por tu dominio real:

```nginx
# ── InsForge Backend + Dashboard ──────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name insforge.yourdomain.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Max upload size (match MAX_FILE_SIZE in .env, default 50 MB)
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:7130;
        proxy_http_version 1.1;

        # WebSocket support (required for Realtime features)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts for long-running requests (e.g., AI completions)
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

##### 6.3 Habilita el sitio

```bash
sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/

# Remove the default site (optional)
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

#### Opción B: Caddy (HTTPS automático)

Caddy es una alternativa más simple que gestiona los certificados TLS automáticamente.

##### Instala Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y
```

##### Configura Caddy

```bash
sudo nano /etc/caddy/Caddyfile
```

```caddyfile
insforge.yourdomain.com {
    reverse_proxy localhost:7130

    header {
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    request_body {
        max_size 50MB
    }
}
```

```bash
sudo systemctl reload caddy
```

Caddy obtendrá y renovará automáticamente los certificados de Let's Encrypt — sin pasos adicionales.

---

### 7. Configuración de HTTPS / TLS

> Si elegiste **Caddy** en el paso 6, TLS ya está gestionado automáticamente. Pasa directamente a la [Parte 2](#part-2--security).

#### 7.1 Instala Certbot (para Nginx)

```bash
sudo apt install certbot python3-certbot-nginx -y
```

#### 7.2 Obtén certificados SSL

```bash
sudo certbot --nginx -d insforge.yourdomain.com
```

Sigue las indicaciones interactivas. Certbot hará lo siguiente:
1. Verificar la propiedad del dominio mediante un desafío HTTP
2. Obtener un certificado firmado de Let's Encrypt
3. Actualizar automáticamente tu configuración de Nginx para servir HTTPS
4. Configurar la redirección HTTP → HTTPS

#### 7.3 Verifica la renovación automática

Los certificados de Let's Encrypt caducan cada 90 días. Certbot instala un temporizador de systemd para la renovación automática:

```bash
# Test renewal (dry run — no actual renewal)
sudo certbot renew --dry-run

# Check the timer is active
sudo systemctl status certbot.timer
```

#### 7.4 Actualiza el entorno de InsForge para HTTPS

Después de obtener tu certificado, actualiza tu `.env` para usar URLs HTTPS:

```bash
cd ~/insforge
nano .env
```

```env
API_BASE_URL=https://insforge.yourdomain.com
VITE_API_BASE_URL=https://insforge.yourdomain.com
```

Reinicia InsForge para aplicar los cambios:

```bash
docker compose down
docker compose up -d
```

---

## Parte 2 — Seguridad

### 8. Gestión de puertos

#### Puertos que deben estar abiertos (a través del proxy inverso)

| Port | Protocol | Purpose                     |
|------|----------|-----------------------------|
| 22   | TCP      | SSH (restrict source IP)    |
| 80   | TCP      | HTTP → HTTPS redirect       |
| 443  | TCP      | HTTPS (reverse proxy)       |

#### Puertos que deben estar cerrados al público

Estos puertos se usan **únicamente** para la comunicación interna entre servicios de Docker. **Nunca** deben exponerse a internet:

| Port  | Service     | Why Close It                                     |
|-------|-------------|--------------------------------------------------|
| 5432  | PostgreSQL  | Direct DB access — use `docker exec` instead     |
| 5430  | PostgREST   | Internal REST layer — proxied through InsForge   |
| 7130  | InsForge    | API + dashboard, accessed via reverse proxy on 443, not directly |
| 7131  | (unused)    | Published by compose (`AUTH_PORT`), but no process listens on it |
| 7133  | Deno        | Internal serverless runtime                      |

> ⚠️ **Crítico**: El `docker-compose.yml` predeterminado vincula los puertos a `0.0.0.0` (todas las interfaces), **no** a `127.0.0.1`. Esto significa que Docker expondrá los servicios directamente a internet, **saltándose UFW por completo** (Docker manipula iptables directamente). **Debes** añadir el prefijo `127.0.0.1:` a cada puerto publicado en tu `docker-compose.yml`:
>
> ```yaml
> ports:
>   - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"     # PostgreSQL
>   - "127.0.0.1:${POSTGREST_PORT:-5430}:3000"     # PostgREST
>   - "127.0.0.1:${APP_PORT:-7130}:7130"            # InsForge (API + dashboard)
>   - "127.0.0.1:${AUTH_PORT:-7131}:7131"           # AUTH_PORT (published by compose, unused)
>   - "127.0.0.1:${DENO_PORT:-7133}:7133"           # Deno
> ```
>
> Sin este prefijo, cualquier persona en internet puede acceder directamente a estos servicios — incluido PostgreSQL con credenciales predeterminadas. Consulta la [Sección 9.2](#92-docker-and-ufw-caveat) para más detalles.

---

### 9. Configuración del firewall (UFW)

UFW (Uncomplicated Firewall) es la forma más sencilla de gestionar iptables en Ubuntu.

#### 9.1 Instala y configura UFW

```bash
# Install UFW (usually pre-installed on Ubuntu)
sudo apt install ufw -y

# Default policy: deny all incoming, allow all outgoing
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (CRITICAL — do this BEFORE enabling UFW!)
sudo ufw allow OpenSSH

# Allow HTTP and HTTPS (for reverse proxy)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable the firewall
sudo ufw enable

# Verify rules
sudo ufw status verbose
```

Salida esperada:

```text
Status: active

To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

> ⚠️ **Crítico**: Permite siempre SSH **antes** de habilitar UFW, o te quedarás bloqueado fuera del servidor.

#### 9.2 Advertencia sobre Docker y UFW

Docker manipula iptables directamente, lo que puede **saltarse las reglas de UFW**. Para evitarlo:

**Opción 1 — Vincular los puertos a localhost** (recomendado):

En tu `docker-compose.yml`, antepón `127.0.0.1:` a los puertos:

```yaml
ports:
  - "127.0.0.1:7130:7130"
  - "127.0.0.1:7131:7131"
```

**Opción 2 — Desactivar la gestión de iptables de Docker**:

```bash
sudo nano /etc/docker/daemon.json
```

```json
{
  "iptables": false
}
```

```bash
sudo systemctl restart docker
```

> ⚠️ Desactivar la gestión de iptables de Docker requiere configuración manual de red. **Se prefiere la Opción 1** para la mayoría de configuraciones.

#### 9.3 Restringe SSH a tu IP (opcional)

Para máxima seguridad, restringe el acceso SSH a una dirección IP conocida:

```bash
# Remove the broad SSH rule
sudo ufw delete allow OpenSSH

# Allow SSH only from your IP
sudo ufw allow from YOUR_IP_ADDRESS to any port 22 proto tcp

# Verify
sudo ufw status
```

---

### 10. Ejecutar servicios como usuario no root

La imagen Docker de InsForge ya sigue las buenas prácticas de no root:

- El Dockerfile de producción establece `USER node` (UID 1000), por lo que el proceso de la aplicación dentro del contenedor se ejecuta como un usuario no root.
- Las operaciones de Docker a nivel de sistema están gestionadas por el usuario `deploy` (creado en el [Paso 2.3](#23-create-a-deploy-user-non-root)), que tiene acceso al socket de Docker a través del grupo `docker`.

**Verifica el usuario del contenedor:**

```bash
docker compose exec insforge whoami
# Expected output: node
```

**Endurecimiento adicional:**

Añade `security_opt` a cada servicio de tu `docker-compose.yml` para evitar la escalada de privilegios:

```yaml
# Add to each service in docker-compose.yml
security_opt:
  - no-new-privileges:true
```

---

### 11. Endurecimiento de SSH

#### 11.1 Usa autenticación por clave SSH

```bash
# On your LOCAL machine — generate a key pair if you don't have one
ssh-keygen -t ed25519 -C "deploy@insforge"

# Copy the public key to your server
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@your-server-ip
```

#### 11.2 Desactiva la autenticación por contraseña

Una vez confirmado que la autenticación basada en claves funciona:

```bash
sudo nano /etc/ssh/sshd_config
```

Configura lo siguiente:

```ini
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
```

Reinicia SSH:

```bash
sudo systemctl restart sshd
```

#### 11.3 Instala Fail2Ban

Fail2Ban bloquea automáticamente las IPs que muestran actividad maliciosa (por ejemplo, fuerza bruta contra SSH):

```bash
sudo apt install fail2ban -y

# Create a local config (survives updates)
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo nano /etc/fail2ban/jail.local
```

Añade o asegúrate de que estén presentes estos ajustes:

```ini
[sshd]
enabled = true
port = ssh
filter = sshd
maxretry = 5
bantime = 3600
findtime = 600
```

```bash
sudo systemctl enable fail2ban
sudo systemctl restart fail2ban

# Check banned IPs
sudo fail2ban-client status sshd
```

---

### 12. Seguridad de Docker

#### 12.1 Mantén Docker actualizado

```bash
sudo apt update
sudo apt upgrade docker-ce docker-ce-cli containerd.io -y
```

#### 12.2 Limita los recursos de los contenedores (opcional)

Evita que un único contenedor consuma todos los recursos:

```yaml
# Add to any service in docker-compose.yml
deploy:
  resources:
    limits:
      memory: 2G
      cpus: '1.0'
    reservations:
      memory: 512M
```

#### 12.3 Sistema de archivos raíz de solo lectura (avanzado)

Para un endurecimiento adicional, monta el sistema de archivos del contenedor como de solo lectura cuando sea posible:

```yaml
read_only: true
tmpfs:
  - /tmp
```

> ⚠️ Esto requiere pruebas — algunos servicios necesitan directorios con permiso de escritura para cachés o archivos temporales.

#### 12.4 Restringe los orígenes de CORS

Por defecto, el backend permite todos los orígenes. Refleja el encabezado `Origin` de la solicitud de vuelta en la respuesta y, para las respuestas del proxy de funciones, establece `Access-Control-Allow-Origin: *`. Esto es conveniente para el desarrollo local, pero demasiado permisivo para producción. Para un despliegue en producción, restringe los orígenes permitidos a los dominios que realmente sirves (por ejemplo, tu panel y los dominios de tu aplicación), de modo que otros sitios no puedan hacer solicitudes entre orígenes con credenciales a tu API.

---

### 13. Gestión de secretos

#### Sí ✅

- Guarda los secretos en el archivo `.env` con `chmod 600 ~/insforge/.env`
- Usa valores separados para `JWT_SECRET` y `ENCRYPTION_KEY`
- Genera secretos con `openssl rand -base64 32`
- Haz una copia de seguridad de tu archivo `.env` en una ubicación segura y sin conexión

#### No ❌

- Confirmar (commit) el `.env` en el control de versiones
- Reutilizar el mismo secreto para varias variables
- Usar contraseñas predeterminadas (`change-this-password`, `postgres`) en producción
- Compartir secretos por canales sin cifrar

---

## Parte 3 — Actualización y mantenimiento

### 14. Copia de seguridad previa a la actualización

**Realiza siempre una copia de seguridad antes de actualizar.** Esto te da una vía de recuperación si algo sale mal.

#### 14.1 Haz una copia de seguridad de la base de datos

```bash
cd ~/insforge
source .env

# Create a timestamped database backup
docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-insforge}" \
  > backup_$(date +%Y%m%d_%H%M%S).sql

# Verify size is reasonable
ls -lh backup_*.sql
```

#### 14.2 Haz una copia de seguridad del entorno y los volúmenes

```bash
# Back up .env file
cp .env .env.backup_$(date +%Y%m%d)

# Back up Docker volumes (optional but recommended)
docker run --rm \
  -v insforge_postgres-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/volumes_postgres_$(date +%Y%m%d_%H%M%S).tar.gz /data
```

#### 14.3 Registra la versión actual

```bash
# Note the current image versions before updating
docker compose images
```

---

### 15. Actualizar InsForge

#### 15.1 Actualiza el repositorio

Actualiza el checkout antes de descargar las imágenes: contiene el archivo de compose y la configuración de Postgres.

```bash
cd ~/insforge

git fetch origin main
git diff HEAD origin/main -- deploy functions .env.example

git merge --ff-only origin/main

# Pick up any files this release added
sh deploy/setup.sh .
```

Revisa el diff antes de hacer merge. Las variables nuevas de `.env.example` deben copiarse a tu `.env` a mano.

#### 15.2 Descarga las imágenes más recientes

```bash
cd ~/insforge

# Pull the latest versions
docker compose pull
```

#### 15.3 Aplica la actualización

```bash
# Stop current services, start with new images
docker compose down
docker compose up -d

# Watch logs for errors during startup
docker compose logs -f --tail=50
```

Presiona `Ctrl+C` para dejar de seguir los logs.

#### 15.4 Verifica la actualización

```bash
# Check all services are healthy
docker compose ps

# Test the health endpoint
curl http://localhost:7130/api/health

# Check the version in the response
```

### 16. Procedimiento de reversión

Si una actualización causa problemas, sigue estos pasos para revertirla:

#### 16.1 Detén los servicios afectados

```bash
cd ~/insforge
docker compose down
```

#### 16.2 Fija la versión anterior

1. Escribe `pin.yml` junto a tu `.env`, con la versión que registró 14.3:

   ```yaml
   services:
     insforge:
       image: ghcr.io/insforge/insforge-oss:v2.2.9
   ```

2. Añádelo a `COMPOSE_FILE` en `.env`, conservando las entradas que ya estén:

   ```env
   COMPOSE_FILE=deploy/docker-compose/docker-compose.yml:pin.yml
   ```

3. `docker compose up -d`

4. Quita `:pin.yml` cuando vuelvas a una versión buena.

Hasta que lo hagas, la actualización de la sección 15 descarga imágenes nuevas y
sigue ejecutando la fijada.

#### 16.3 Restaura la base de datos (si es necesario)

Restaura la base de datos solo si la actualización incluyó una migración de base de datos que causó problemas:

```bash
cd ~/insforge
source .env

# Start only PostgreSQL
docker compose up -d postgres

# Wait for it to be healthy
docker compose exec postgres pg_isready -U "${POSTGRES_USER:-postgres}"

# Restore from backup
cat backup_YYYYMMDD_HHMMSS.sql | \
  docker compose exec -T postgres psql \
  -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-insforge}"

# Start remaining services
docker compose up -d
```

#### 16.4 Restaura el archivo de entorno (si cambió)

```bash
cp .env.backup_YYYYMMDD .env
docker compose down
docker compose up -d
```

---

### 17. Copias de seguridad automatizadas

Configura una tarea cron para copias de seguridad automáticas diarias:

#### 17.1 Crea un script de copia de seguridad

```bash
nano ~/insforge/backup.sh
```

```bash
#!/bin/bash
set -euo pipefail

# InsForge Automated Backup Script
# Run from the checkout so docker compose reads COMPOSE_FILE and
# COMPOSE_PROJECT_NAME from .env, which also carries POSTGRES_USER / POSTGRES_DB
cd "$HOME/insforge"
set -a
source .env
set +a

BACKUP_DIR="$HOME/insforge/backups"
RETENTION_DAYS=14
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

trap 'echo "[$(date)] ERROR: Backup failed at line $LINENO" >&2; exit 1' ERR

mkdir -p "$BACKUP_DIR"

# Dump the database
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-insforge}" \
  > "$BACKUP_DIR/db_$TIMESTAMP.sql"

# Copy the environment file
cp "$HOME/insforge/.env" "$BACKUP_DIR/env_$TIMESTAMP.bak"

# Remove backups older than retention period
find "$BACKUP_DIR" -name "db_*.sql" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "env_*.bak" -mtime +$RETENTION_DAYS -delete

echo "[$(date)] Backup completed successfully: db_$TIMESTAMP.sql"
```

```bash
chmod +x ~/insforge/backup.sh
```

#### 17.2 Programa con Cron

```bash
crontab -e
```

Añade esta línea para copias de seguridad diarias a las 3:00 a. m.:

```cron
0 3 * * * /home/deploy/insforge/backup.sh >> /home/deploy/insforge/backups/cron.log 2>&1
```

#### 17.3 Copias de seguridad fuera del sitio (recomendado)

Para la recuperación ante desastres, copia las copias de seguridad a una ubicación externa:

```bash
# Example: sync backups to S3-compatible storage
aws s3 sync ~/insforge/backups s3://your-backup-bucket/insforge/

# Example: sync to a remote server
rsync -avz ~/insforge/backups/ user@backup-server:/backups/insforge/
```

---

### 18. Monitorización y comprobaciones de estado

#### 18.1 Comprueba el estado de los servicios

```bash
# Container status
docker compose ps

# Resource usage per container
docker stats --no-stream

# Disk usage
df -h

# Memory usage
free -h
```

#### 18.2 Consulta los logs

```bash
# All services
docker compose logs -f --tail=100

# Specific service
docker compose logs -f insforge
docker compose logs -f postgres
docker compose logs -f deno
```

#### 18.3 Endpoint de comprobación de estado

Monitoriza el endpoint de estado desde el exterior. Una comprobación sencilla basada en cron:

```bash
# Add to crontab for monitoring
*/5 * * * * curl -sf https://insforge.yourdomain.com/api/health > /dev/null || echo "InsForge is DOWN" | mail -s "InsForge Alert" you@example.com
```

O usa un servicio gratuito de monitorización de disponibilidad como [UptimeRobot](https://uptimerobot.com) o [Betterstack](https://betterstack.com) para monitorizar `https://insforge.yourdomain.com/api/health`.

---

## Referencia rápida

### Comandos esenciales

```bash
# ── Lifecycle ─────────────────────────────────
docker compose up -d              # Start all services
docker compose down               # Stop all services
docker compose restart            # Restart all services
docker compose pull               # Pull latest images

# ── Diagnostics ───────────────────────────────
docker compose ps                 # Service status
docker compose logs -f            # Follow all logs
docker compose logs -f insforge   # Follow specific service
docker stats --no-stream          # Resource usage

# ── Database (source .env first for vars) ────
source ~/insforge/.env
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-insforge}" > backup.sql  # Backup
cat backup.sql | docker compose exec -T postgres psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-insforge}"  # Restore

# ── Updates ───────────────────────────────────
docker compose pull               # Pull new images
docker compose down && docker compose up -d   # Apply update
```

### Lista de verificación de seguridad

- [ ] Usuario de despliegue creado (no root)
- [ ] Autenticación por clave SSH habilitada
- [ ] Autenticación por contraseña de SSH deshabilitada
- [ ] Inicio de sesión root deshabilitado
- [ ] Firewall UFW habilitado (solo puertos 22, 80, 443)
- [ ] Puertos de Docker vinculados a `127.0.0.1`
- [ ] Fail2Ban instalado y activo
- [ ] `JWT_SECRET` cambiado del valor predeterminado (32+ caracteres)
- [ ] `ENCRYPTION_KEY` definida (distinta de `JWT_SECRET`)
- [ ] `ROOT_ADMIN_PASSWORD` cambiada del valor predeterminado
- [ ] `POSTGRES_PASSWORD` cambiada del valor predeterminado
- [ ] Permisos del archivo `.env` establecidos en `600`
- [ ] HTTPS habilitado mediante Certbot o Caddy
- [ ] Copias de seguridad diarias automatizadas configuradas
- [ ] Actualizaciones de seguridad no asistidas habilitadas

---

## Solución de problemas

### No se puede conectar tras habilitar UFW

Si te quedas bloqueado fuera, usa la **consola web** de tu proveedor de VPS (acceso fuera de banda) para:

```bash
sudo ufw allow OpenSSH
sudo ufw enable
```

### Docker se salta UFW

Docker manipula iptables directamente. Vincula los puertos a `127.0.0.1` en `docker-compose.yml` como se describe en la [Sección 9.2](#92-docker-and-ufw-caveat).

### Los servicios no arrancan

```bash
# Check logs for the failing service
docker compose logs postgres
docker compose logs insforge

# Verify disk space
df -h

# Verify memory
free -h

# Restart Docker daemon
sudo systemctl restart docker
docker compose up -d
```

### El certificado SSL no se renueva

```bash
# Check Certbot timer
sudo systemctl status certbot.timer

# Manual renewal
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

### Conflictos de puertos

```bash
# Find what's using a port
sudo ss -tlnp | grep :7130

# Change the port in .env
APP_PORT=7140
```

### Problemas de conexión a la base de datos

```bash
# Check PostgreSQL is healthy
docker compose ps postgres

# View PostgreSQL logs
docker compose logs postgres

# Connect to the database directly
docker compose exec postgres psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-insforge}"
```

---

## 🆘 ¿Necesitas ayuda?

- **Documentación**: [https://docs.insforge.dev](https://docs.insforge.dev)
- **Comunidad de Discord**: [https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)
- **Issues de GitHub**: [https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
