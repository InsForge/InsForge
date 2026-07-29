---
title: "Implementar InsForge en AWS EC2"
description: "Guía paso a paso para implementar InsForge en una instancia de AWS EC2 usando Docker Compose, incluyendo configuración de SSH, dominio y terminación TLS."
---

# Implementar InsForge en AWS EC2

Esta guía te llevará paso a paso por la implementación de InsForge en una instancia de AWS EC2 usando Docker Compose.

<Note>
  Esta guía de nube la mantiene la comunidad y puede quedar por detrás de la última versión de InsForge. La configuración canónica y siempre actualizada es el directorio `deploy/docker-compose/` en el [repositorio de InsForge](https://github.com/InsForge/InsForge).
</Note>

## 📋 Requisitos previos

- Cuenta de AWS con acceso a EC2
- Conocimientos básicos de SSH y operaciones de línea de comandos
- Nombre de dominio (opcional, para configuración de dominio personalizado)

## 🚀 Pasos de implementación

### 1. Crear y configurar la instancia EC2

#### 1.1 Lanzar la instancia EC2

1. **Inicia sesión en AWS Console** y navega al panel de EC2
2. **Haz clic en "Launch Instance"**
3. **Configura la instancia:**
   - **Name**: `insforge-server` (o el nombre que prefieras)
   - **AMI**: Ubuntu Server 24.04 LTS (HVM), tipo de volumen SSD
   - **Instance Type**: `t3.medium` o superior (mínimo 2 vCPU, 4 GB de RAM)
     - Para producción: se recomienda `t3.large` (2 vCPU, 8 GB de RAM)
     - Para pruebas: mínimo `t3.small` (2 vCPU, 2 GB de RAM)
   - **Key Pair**: Crea uno nuevo o selecciona un par de claves existente (descarga y guarda el archivo `.pem`)
   - **Storage**: 30 GB gp3 (se recomienda un mínimo de 20 GB)

#### 1.2 Configurar el grupo de seguridad

Crea o configura un grupo de seguridad con las siguientes reglas de entrada:

| Type        | Protocol | Port Range | Source    | Description          |
|-------------|----------|------------|-----------|----------------------|
| SSH         | TCP      | 22         | My IP     | Acceso SSH           |
| HTTP        | TCP      | 80         | 0.0.0.0/0 | Acceso HTTP          |
| HTTPS       | TCP      | 443        | 0.0.0.0/0 | Acceso HTTPS         |
| Custom TCP  | TCP      | 7130       | 0.0.0.0/0 | Panel + API      |
| Custom TCP  | TCP      | 5432       | 0.0.0.0/0 | PostgreSQL (opcional)|

> ⚠️ **Nota de seguridad**: Para producción, restringe PostgreSQL (5432) a direcciones IP específicas o elimina por completo el acceso externo. Considera usar un proxy inverso (nginx) y exponer solo los puertos 80/443.

#### 1.3 Asignar una IP elástica (recomendado)

1. Navega a **Elastic IPs** en el panel de EC2
2. Haz clic en **Allocate Elastic IP address**
3. Asocia la IP elástica con tu instancia

Esto garantiza que tu instancia conserve la misma dirección IP incluso después de reinicios.

### 2. Conectarte a tu instancia EC2

```bash
# Establece los permisos correctos para tu archivo de clave
chmod 400 your-key-pair.pem

# Conéctate por SSH
ssh -i your-key-pair.pem ubuntu@your-ec2-public-ip
```

### 3. Instalar dependencias

#### 3.1 Actualizar los paquetes del sistema

```bash
sudo apt update && sudo apt upgrade -y
```

#### 3.2 Instalar Docker

```text
Sigue las instrucciones del siguiente enlace para instalar y verificar Docker en tu nueva instancia EC2 de Ubuntu:
https://docs.docker.com/engine/install/ubuntu/
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

> ⚠️ **Nota de seguridad**: Agregar un usuario al grupo `docker` le otorga privilegios equivalentes a root en el sistema. Esto es aceptable en entornos de un solo usuario como tu instancia EC2, pero ten cuidado en sistemas compartidos.

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

Copia la plantilla de ejemplo para crear tu archivo `.env`:

```bash
cp .env.example .env
nano .env
```

La plantilla completa se encuentra en `deploy/docker-compose/.env.example`. Estas son las variables que debes establecer:

```env
# Required
JWT_SECRET=your-secret-key-here-must-be-32-char-or-above
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=change-this-password
POSTGRES_PASSWORD=change-this-password

# Optional: falls back to JWT_SECRET if left blank
ENCRYPTION_KEY=

# Optional: enables AI features
OPENROUTER_API_KEY=

# Optional: enables site deployments
VERCEL_TOKEN=
VERCEL_TEAM_ID=
VERCEL_PROJECT_ID=

# Optional: OAuth providers
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

La plantilla `.env.example` incluye el resto de las variables y sus valores predeterminados, así que basta con editar el archivo copiado.

**Genera secretos seguros:**

```bash
# Genera JWT_SECRET (32+ caracteres)
openssl rand -base64 32

# Genera ENCRYPTION_KEY (debe tener exactamente 32 caracteres)
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
curl http://your-ec2-ip:7130/api/health
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
http://your-ec2-ip:7130
```

Inicia sesión con el `ROOT_ADMIN_USERNAME` y `ROOT_ADMIN_PASSWORD` que estableciste en `.env`.

### 6. Configurar el dominio (opcional pero recomendado)

#### 6.1 Actualizar los registros DNS

Agrega registros DNS A que apunten a tu IP elástica de EC2:
```text
api.yourdomain.com    → your-ec2-ip
app.yourdomain.com    → your-ec2-ip
```

#### 6.2 Instalar el proxy inverso Nginx

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

# Dashboard (served by the backend on the same port as the API)
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

#### 6.3 Instalar el certificado SSL (recomendado)

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

InsForge distribuye imágenes precompiladas, así que actualizar consiste en descargar y reiniciar. Ejecuta esto desde `~/insforge/deploy/docker-compose`:

```bash
cd ~/insforge/deploy/docker-compose
git pull origin main
docker compose pull && docker compose up -d
```

### Copia de seguridad de la base de datos

Ejecuta esto desde `~/insforge/deploy/docker-compose`:

```bash
# Crea una copia de seguridad
docker compose exec postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql

# Restaura desde una copia de seguridad
cat backup_file.sql | docker compose exec -T postgres psql -U postgres -d insforge
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
- Actual: t3.medium (4 GB de RAM)
- Actualizar a: t3.large (8 GB de RAM)
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

1. **Actualizar el tipo de instancia**: Usa `t3.large` o `t3.xlarge`
2. **Habilitar el autoescalado**: Configura un Application Load Balancer con grupos de autoescalado
3. **Usar RDS**: Migra de PostgreSQL en contenedores a AWS RDS para mayor fiabilidad
4. **Habilitar CloudWatch**: Monitorea las métricas y configura alarmas
5. **Configurar copias de seguridad**: Configura copias de seguridad diarias automatizadas
6. **Usar S3 para almacenamiento**: Configura un bucket de S3 para las subidas de archivos en lugar del almacenamiento local

### Optimización de la base de datos

```conf
# Aumenta shared_buffers de PostgreSQL (edita postgresql.conf en deploy/docker-init/db/)
# Recomendado: 25% de la RAM disponible
shared_buffers = 1GB
effective_cache_size = 3GB
```

## 🔒 Prácticas recomendadas de seguridad

1. **Cambiar las contraseñas predeterminadas**: Actualiza las contraseñas de administrador y de la base de datos
2. **Habilitar el firewall**: Usa los grupos de seguridad de AWS de forma efectiva
3. **Actualizaciones regulares**: Mantén el sistema y las imágenes de Docker actualizados
4. **SSL/TLS**: Usa siempre HTTPS en producción
5. **Copias de seguridad periódicas**: Automatiza las copias de seguridad de la base de datos
6. **Monitorear logs**: Configura el monitoreo de logs y alertas
7. **Limitar el acceso SSH**: Restringe el SSH a direcciones IP específicas
8. **Usar roles de IAM**: En lugar de claves de acceso de AWS cuando sea posible

## 🆘 Soporte y recursos

- **Documentación**: [https://docs.insforge.dev](https://docs.insforge.dev)
- **Issues de GitHub**: [https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
- **Comunidad de Discord**: [https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)

## 📝 Estimación de costos

**Costos mensuales aproximados de AWS:**

| Component | Type | Monthly Cost |
|-----------|------|--------------|
| EC2 Instance | t3.medium | ~$30 |
| Storage (30 GB) | EBS gp3 | ~$3 |
| Elastic IP | (if running 24/7) | $0 |
| Data Transfer | First 100GB free | Variable |
| **Total** | | **~$33/month** |

> 💡 **Optimización de costos**: Usa AWS Savings Plans o Reserved Instances para implementaciones a largo plazo y ahorra hasta un 70%.

---

**¡Felicidades! 🎉** Tu instancia de InsForge ahora se está ejecutando en AWS EC2. Puedes empezar a construir aplicaciones conectando agentes de IA a tu plataforma backend.

Para otras estrategias de implementación en producción, consulta nuestras [guías de implementación](/deployment/deployment-security-guide).
