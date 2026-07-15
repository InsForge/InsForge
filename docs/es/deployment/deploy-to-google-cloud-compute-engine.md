---
title: "Implementar InsForge en Google Cloud Compute Engine"
description: "Implementa InsForge en una VM de Google Cloud Compute Engine con Docker Compose, cubriendo reglas de firewall, acceso SSH, dominios personalizados y configuración de HTTPS."
---

# Implementar InsForge en Google Cloud Compute Engine

Esta guía te llevará paso a paso por la implementación de InsForge en Google Cloud Compute Engine usando Docker Compose.

<Note>
  Esta guía de nube la mantiene la comunidad y puede quedar por detrás de la última versión de InsForge. La configuración canónica y siempre actualizada es el directorio `deploy/docker-compose/` en el [repositorio de InsForge](https://github.com/InsForge/InsForge).
</Note>

## 📋 Requisitos previos

- Cuenta de Google Cloud con facturación habilitada
- Conocimientos básicos de SSH y operaciones de línea de comandos
- Nombre de dominio (opcional, para configuración de dominio personalizado)

## 🚀 Pasos de implementación

### 1. Crear y configurar la instancia de Compute Engine

#### 1.1 Crear un proyecto de Google Cloud

1. **Inicia sesión en Google Cloud Console** en [console.cloud.google.com](https://console.cloud.google.com)
2. **Haz clic en "Select a project"** en la barra de navegación superior
3. **Haz clic en "New Project"**
4. **Ingresa el nombre del proyecto** (p. ej., `insforge-deployment`)
5. **Haz clic en "Create"**
6. **Espera a que se complete la creación del proyecto**

#### 1.2 Habilitar las APIs necesarias

1. En tu proyecto, navega a **APIs & Services** → **Library**
2. Busca y habilita estas APIs:
   - **Compute Engine API**
   - **Cloud Storage API** (si la usas para copias de seguridad)
   - **Cloud SQL Admin API** (si usas Cloud SQL)

#### 1.3 Crear la instancia de Compute Engine

1. Navega a **Compute Engine** → **VM instances**
2. Haz clic en **"Create Instance"**
3. Configura tu instancia:
   - **Name**: `insforge-server` (o el nombre que prefieras)
   - **Region**: Elige una región cercana a tus usuarios
   - **Zone**: Selecciona una zona de disponibilidad (p. ej., us-central1-a)
   - **Machine configuration**:
     - **Series**: N2 o E2
     - **Machine type**: `e2-medium` o superior (mínimo 2 vCPU, 4 GB de RAM)
       - Para producción: se recomienda `e2-standard-2` (2 vCPU, 8 GB de RAM)
       - Para pruebas: mínimo `e2-small` (2 vCPU, 2 GB de RAM)
   - **Boot disk**:
     - **Operating system**: Ubuntu LTS (Ubuntu 22.04 LTS o más reciente)
     - **Boot disk type**: Disco persistente equilibrado
     - **Size**: 30 GB (se recomienda un mínimo de 20 GB)
   - **Firewall**:
     - Permitir tráfico HTTP: **Marcado**
     - Permitir tráfico HTTPS: **Marcado**

#### 1.4 Configurar las reglas de firewall

1. Navega a **VPC network** → **Firewall**
2. Crea o modifica reglas de firewall para permitir los siguientes puertos:

| Name | Direction | Targets | Protocols/ports | Source filters |
|------|-----------|---------|-----------------|----------------|
| insforge-ssh | Ingress | insforge-server | tcp:22 | Tu dirección IP |
| insforge-http | Ingress | insforge-server | tcp:80 | 0.0.0.0/0 |
| insforge-https | Ingress | insforge-server | tcp:443 | 0.0.0.0/0 |
| insforge-app | Ingress | insforge-server | tcp:7130 | 0.0.0.0/0 |
| insforge-deno | Ingress | insforge-server | tcp:7133 | 0.0.0.0/0 |
| insforge-postgrest | Ingress | insforge-server | tcp:5430 | 0.0.0.0/0 |
| insforge-postgres | Ingress | insforge-server | tcp:5432 | 0.0.0.0/0 (solo si se necesita acceso externo) |

> ⚠️ **Nota de seguridad**: Para producción, restringe PostgreSQL (5432) a direcciones IP específicas o elimina por completo el acceso externo. Considera usar un proxy inverso (nginx) y exponer solo los puertos 80/443.

### 2. Conectarte a tu instancia de Compute Engine

1. En Google Cloud Console, ve a **Compute Engine** → **VM instances**
2. Busca tu instancia y haz clic en el botón **SSH** en la misma fila, o:

```bash
# Usa la CLI de gcloud para conectarte por SSH (si tienes el SDK de gcloud instalado localmente)
gcloud compute ssh insforge-server --zone=your-zone
```

### 3. Instalar dependencias

#### 3.1 Actualizar los paquetes del sistema

```bash
sudo apt update && sudo apt upgrade -y
```

#### 3.2 Instalar Docker

```bash
# Agrega la clave GPG oficial de Docker
sudo apt-get update
sudo apt-get install ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Agrega el repositorio de Docker
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Instala Docker
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

#### 3.3 Agregar tu usuario al grupo de Docker

Después de instalar Docker, necesitas agregar tu usuario al grupo `docker` para poder ejecutar comandos de Docker sin `sudo`:

```bash
# Agrega tu usuario al grupo docker
sudo usermod -aG docker $USER

# Aplica los cambios de grupo
newgrp docker
```

**Verifica que funciona:**

```bash
# Esto ahora debería funcionar sin sudo
docker ps
```

> 💡 **Nota**: Si `docker ps` no funciona de inmediato, cierra sesión y vuelve a iniciar sesión por SSH, luego inténtalo de nuevo.

> ⚠️ **Nota de seguridad**: Agregar un usuario al grupo `docker` le otorga privilegios equivalentes a root en el sistema. Esto es aceptable en entornos de un solo usuario como tu instancia de Compute Engine, pero ten cuidado en sistemas compartidos.

#### 3.4 Instalar Git

```bash
sudo apt install git -y
```

### 4. Implementar InsForge

#### 4.1 Clonar el repositorio

```bash
cd ~
git clone https://github.com/insforge/insforge.git
cd insforge/deploy/docker-compose
```

#### 4.2 Crear la configuración del entorno

Crea tu archivo `.env` con los valores de producción:

```bash
nano .env
```

El repositorio incluye una plantilla en `deploy/docker-compose/.env.example`. Cópiala y edita los valores:

```bash
cp .env.example .env
nano .env
```

Como mínimo, establece estos valores:

```env
# Authentication (required)
# IMPORTANT: Generate a strong random secret for production (32+ characters)
JWT_SECRET=your-secret-key-here-must-be-32-char-or-above

# Admin account (used for initial setup)
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=change-this-password

# Database (required)
POSTGRES_PASSWORD=your-secure-postgres-password
```

Valores opcionales que quizá quieras establecer:

```env
# Encryption key for secrets and database encryption.
# Falls back to JWT_SECRET if left empty.
ENCRYPTION_KEY=

# AI/LLM (get a key from https://openrouter.ai/keys)
OPENROUTER_API_KEY=

# Site deployments and custom domains
VERCEL_TOKEN=
VERCEL_TEAM_ID=
VERCEL_PROJECT_ID=

# OAuth providers (Google, GitHub, etc.)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

Consulta `deploy/docker-compose/.env.example` para ver la lista completa de variables admitidas.

**Genera secretos seguros:**

```bash
# Genera JWT_SECRET (32+ caracteres)
openssl rand -base64 32

# Genera ENCRYPTION_KEY (32 caracteres)
openssl rand -base64 24
```

> 💡 **Importante**: Guarda estos secretos de forma segura. Los necesitarás si alguna vez migras o restauras tu instancia.

#### 4.3 Iniciar los servicios de InsForge

```bash
# Descarga las imágenes de Docker e inicia los servicios
docker compose up -d

# Consulta los logs para asegurarte de que todo se inició correctamente
docker compose logs -f
```

Presiona `Ctrl+C` para salir de la vista de logs.

#### 4.4 Verificar los servicios

```bash
# Comprueba los contenedores en ejecución
docker compose ps

# Deberías ver 4 servicios en ejecución:
# - postgres
# - postgrest
# - insforge
# - deno
```

### 5. Acceder a tu instancia de InsForge

#### 5.1 Probar la API del backend

```bash
curl http://your-external-ip:7130/api/health
```

Respuesta esperada:
```json
{
  "status": "ok",
  "version": "2.1.7",
  "service": "Insforge OSS Backend",
  "timestamp": "2025-10-17T..."
}
```

#### 5.2 Acceder al panel de control

Abre tu navegador y navega a:
```text
http://your-external-ip:7130
```

### 6. Configurar el dominio (opcional pero recomendado)

#### 6.1 Reservar una IP externa estática

1. En Google Cloud Console, ve a **VPC network** → **External IP addresses**
2. Haz clic en **Reserve Static Address**
3. **Name**: `insforge-ip`
4. **Type**: Regional o Global (Regional para instancias de VM)
5. **Region**: La misma que tu instancia de VM
6. **Haz clic en Reserve**

#### 6.2 Actualizar los registros DNS

Apunta los registros DNS de tu dominio a la IP estática reservada:
```text
api.yourdomain.com    → your-static-external-ip
app.yourdomain.com    → your-static-external-ip
```

#### 6.3 Instalar el proxy inverso Nginx

```bash
sudo apt install nginx -y
```

Crea la configuración de Nginx:

```bash
sudo nano /etc/nginx/sites-available/insforge
```

Agrega la siguiente configuración:

```nginx
# Backend API
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:7130;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Dashboard
server {
    listen 80;
    server_name app.yourdomain.com;

    location / {
        proxy_pass http://localhost:7130;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Habilita la configuración:

```bash
sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 6.4 Instalar el certificado SSL (recomendado)

```bash
# Instala Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtén los certificados SSL
sudo certbot --nginx -d api.yourdomain.com -d app.yourdomain.com

# Sigue las instrucciones para completar la configuración
```

Actualiza tu archivo `.env` con las URLs de HTTPS:

```bash
cd ~/insforge/deploy/docker-compose
nano .env
```

Cambia:
```env
API_BASE_URL=https://api.yourdomain.com
VITE_API_BASE_URL=https://api.yourdomain.com
```

Reinicia los servicios:

```bash
docker compose down
docker compose up -d
```

## 🔧 Administración y mantenimiento

### Ver logs

```bash
# Todos los servicios
docker compose logs -f

# Servicio específico
docker compose logs -f insforge
docker compose logs -f postgres
docker compose logs -f deno
```

### Detener servicios

```bash
docker compose down
```

### Reiniciar servicios

```bash
docker compose restart
```

### Actualizar InsForge

```bash
cd ~/insforge/deploy/docker-compose
git pull origin main
docker compose pull && docker compose up -d
```

### Copia de seguridad de la base de datos

```bash
# Crea una copia de seguridad (ejecutar desde deploy/docker-compose/)
docker compose exec postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql

# Almacena la copia de seguridad en Google Cloud Storage (opcional)
# Primero, instala la CLI de Google Cloud y autentícate
# Luego:
gsutil cp backup_$(date +%Y%m%d_%H%M%S).sql gs://your-backup-bucket/
```

### Monitorear recursos

```bash
# Comprueba el uso de disco
df -h

# Comprueba el uso de memoria
free -h

# Comprueba las estadísticas de Docker
docker stats
```

## 🐛 Solución de problemas

### Los servicios no inician

```bash
# Comprueba los logs en busca de errores
docker compose logs

# Comprueba el espacio en disco
df -h

# Comprueba la memoria
free -h

# Reinicia el daemon de Docker
sudo systemctl restart docker
docker compose up -d
```

### No se puede conectar a la base de datos

```bash
# Comprueba si PostgreSQL se está ejecutando
docker compose ps postgres

# Comprueba los logs de PostgreSQL
docker compose logs postgres

# Verifica las credenciales en el archivo .env
cat .env | grep POSTGRES
```

### El puerto ya está en uso

```bash
# Comprueba qué está usando el puerto
sudo netstat -tulpn | grep :7130

# Termina el proceso o cambia el puerto en docker-compose.yml
```

### Falta de memoria

Considera actualizar a un tipo de instancia más grande:
```text
- Actual: e2-small (2 vCPU, 2 GB de RAM)
- Actualizar a: e2-standard-2 (2 vCPU, 8 GB de RAM)
```

### Problemas con el certificado SSL

```bash
# Renueva los certificados
sudo certbot renew

# Prueba la renovación
sudo certbot renew --dry-run
```

## 📊 Optimización del rendimiento

### Para cargas de trabajo de producción

1. **Actualizar el tipo de instancia**: Usa `e2-standard-2` o `e2-standard-4`
2. **Usar Cloud SQL**: Migra de PostgreSQL en contenedores a Google Cloud SQL para mayor fiabilidad
3. **Habilitar Cloud Monitoring**: Monitorea las métricas y configura alertas
4. **Configurar copias de seguridad**: Configura copias de seguridad diarias automatizadas
5. **Usar Cloud Storage**: Configura Google Cloud Storage para las subidas de archivos en lugar del almacenamiento local

### Optimización de la base de datos

```conf
# Aumenta shared_buffers de PostgreSQL (edita postgresql.conf en deploy/docker-init/db/)
# Recomendado: 25% de la RAM disponible
shared_buffers = 1GB
effective_cache_size = 3GB
```

## 🔒 Prácticas recomendadas de seguridad

1. **Cambiar las contraseñas predeterminadas**: Actualiza las contraseñas de administrador y de la base de datos
2. **Habilitar el firewall**: Usa las reglas de Google Cloud Firewall de forma efectiva
3. **Actualizaciones regulares**: Mantén el sistema y las imágenes de Docker actualizados
4. **SSL/TLS**: Usa siempre HTTPS en producción
5. **Copias de seguridad periódicas**: Automatiza las copias de seguridad de la base de datos
6. **Monitorear logs**: Configura el monitoreo de logs y alertas
7. **Limitar el acceso SSH**: Restringe el SSH a direcciones IP específicas
8. **Usar cuentas de servicio**: En lugar de claves de API cuando sea posible

## 🆘 Soporte y recursos

- **Documentación**: [https://docs.insforge.dev](https://docs.insforge.dev)
- **Issues de GitHub**: [https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
- **Comunidad de Discord**: [https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)

## 📝 Estimación de costos

**Costos mensuales aproximados de Google Cloud:**

| Component | Type | Monthly Cost |
|-----------|------|--------------|
| Compute Engine | e2-medium (2 vCPU, 4 GB RAM) | ~$29 |
| Persistent Disk (30 GB) | Standard | ~$3 |
| Network Egress | First 1GB free | Variable |
| **Total** | | **~$32/month** |

> 💡 **Optimización de costos**: Usa descuentos por uso sostenido para instancias que se ejecutan 24/7 y ahorra hasta un 30%. Considera instancias interrumpibles (preemptible) para entornos de desarrollo/pruebas.

---

**¡Felicidades! 🎉** Tu instancia de InsForge ahora se está ejecutando en Google Cloud Compute Engine. Puedes empezar a construir aplicaciones conectando agentes de IA a tu plataforma backend.

Para otras estrategias de implementación en producción, consulta nuestras [guías de implementación](/deployment/deployment-security-guide).
