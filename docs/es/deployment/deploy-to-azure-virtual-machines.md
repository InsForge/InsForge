# 📖 Desplegar InsForge en Azure Virtual Machines (Guía extendida)

Esta guía proporciona instrucciones completas y paso a paso para desplegar, gestionar y proteger InsForge en una máquina virtual (VM) de Azure usando Docker Compose.

<Note>
  Este recorrido en la nube es mantenido por la comunidad y puede quedar rezagado respecto a la última versión de InsForge. La configuración canónica y siempre actualizada es el directorio `deploy/docker-compose/` en el [repositorio de InsForge](https://github.com/InsForge/InsForge).
</Note>

## Requisitos previos

* Una **cuenta de Azure** activa.
* Un **cliente SSH** para conectarse a la máquina virtual.
* Familiaridad básica con la **línea de comandos de Linux**.

---

## Paso 1: 🖥️ Crear una máquina virtual de Azure

1.  **Inicie sesión en el [Portal de Azure](https://portal.azure.com/)** y navegue a **Máquinas virtuales**.
2.  Haga clic en **+ Crear** > **Máquina virtual de Azure**.
3.  **Pestaña Básicos:**
    * **Grupo de recursos:** Cree uno nuevo (por ejemplo, `insforge-rg`).
    * **Nombre de la máquina virtual:** `insforge-vm`.
    * **Imagen:** **Ubuntu Server 22.04 LTS** o una versión más reciente.
    * **Tamaño:** `Standard_B2s` (2 vCPU, 4 GiB de memoria) es un buen punto de partida. Para producción, considere `Standard_B4ms` (4 vCPU, 16 GiB de memoria).
    * **Tipo de autenticación:** **Clave pública SSH**.
    * **Origen de la clave pública SSH:** **Generar nuevo par de claves**. Llámelo `insforge-key`.
4.  **Pestaña Redes:**
    * En la sección **Grupo de seguridad de red**, haga clic en **Crear nuevo**.
    * Agregue las siguientes **reglas de puertos de entrada** para permitir el tráfico:
        * `22` (SSH)
        * `80` (HTTP para Nginx)
        * `443` (HTTPS para Nginx/SSL)
        * `7130` (API y panel de InsForge)
5.  **Revisar y crear:**
    * Haga clic en **Revisar y crear**, luego en **Crear**.
    * Cuando se le solicite, **descargue la clave privada y cree el recurso**. Guarde el archivo `.pem` de forma segura.
    * Una vez desplegado, busque y copie la **dirección IP pública** de su VM.

---

## Paso 2: ⚙️ Conectar y configurar el servidor

1.  **Conectarse vía SSH:**
    Abra su terminal, asigne los permisos correctos a su clave y conéctese a la VM.

    ```bash
    chmod 400 /path/to/your/insforge-key.pem
    ssh -i /path/to/your/insforge-key.pem azureuser@<your-vm-public-ip>
    ```

2.  **Actualizar los paquetes del sistema:**
    ```bash
    sudo apt update && sudo apt upgrade -y
    ```

3.  **Instalar Docker:**
    Siga las instrucciones oficiales y actualizadas en el sitio web de Docker para instalar Docker Engine en Ubuntu:
    **[https://docs.docker.com/engine/install/ubuntu/](https://docs.docker.com/engine/install/ubuntu/)**

4.  **Agregar su usuario al grupo de Docker:**
    Este paso le permite ejecutar comandos de Docker sin `sudo`.

    ```bash
    # Add your user to the docker group
    sudo usermod -aG docker $USER

    # Apply the group changes
    newgrp docker
    ```
    Verifique que funcione. Este comando ahora debería ejecutarse sin `sudo`:
    ```bash
    docker ps
    ```
    > 💡 **Nota:** Si `docker ps` no funciona, cierre sesión de su sesión SSH y vuelva a iniciarla, luego intente de nuevo.
    >
    > ⚠️ **Nota de seguridad:** Agregar un usuario al grupo `docker` le otorga privilegios equivalentes a root. Esto es aceptable para una VM de un solo usuario, pero tenga cuidado en sistemas compartidos.

5.  **Instalar Git:**
    ```bash
    sudo apt install git -y
    ```

---

## Paso 3: 🚀 Desplegar InsForge

1.  **Clonar el repositorio:**
    Navegue a su directorio de inicio y clone el proyecto InsForge.
    ```bash
    cd ~
    git clone https://github.com/InsForge/InsForge.git
    cd InsForge/deploy/docker-compose
    ```

2.  **Crear la configuración del entorno:**
    Cree su archivo `.env` a partir del ejemplo y ábralo para editarlo.
    ```bash
    cp .env.example .env
    nano .env
    ```
    `.env.example` enumera todas las variables admitidas con comentarios. Para un despliegue básico solo necesita configurar unas pocas. Configure estos valores y actualice las URLs de la API con la IP pública de su VM:

    ```ini
    # Required
    JWT_SECRET=your-secret-key-here-must-be-32-char-or-above
    ROOT_ADMIN_USERNAME=admin
    ROOT_ADMIN_PASSWORD=change-this-password
    POSTGRES_PASSWORD=change-this-password

    # API URLs (replace with your VM public IP or domain)
    API_BASE_URL=http://<your-vm-public-ip>:7130
    VITE_API_BASE_URL=http://<your-vm-public-ip>:7130

    # Optional
    # ENCRYPTION_KEY falls back to JWT_SECRET if left empty
    ENCRYPTION_KEY=
    # OPENROUTER_API_KEY=
    # VERCEL_TOKEN=
    # GOOGLE_CLIENT_ID=
    ```
    El resto de `.env.example` cubre características opcionales (OpenRouter, despliegues de Vercel, proveedores OAuth). Déjelas en blanco a menos que las necesite.
    > **Generar un secreto JWT seguro:** Ejecute esto en su VM y pegue el resultado en `JWT_SECRET`:
    > ```bash
    > openssl rand -base64 32
    > ```

3.  **Iniciar los servicios de InsForge:**
    Descargue las imágenes de Docker e inicie todos los servicios en segundo plano.
    ```bash
    docker compose up -d
    ```

4.  **Verificar los servicios:**
    Compruebe que los cuatro contenedores estén en ejecución.
    ```bash
    docker compose ps
    ```
    Debería ver los servicios `postgres`, `postgrest`, `insforge` y `deno` en ejecución.

---

## Paso 4: 🔑 Acceder a su instancia de InsForge

1.  **Probar la API del backend:**
    Use `curl` para comprobar el endpoint de salud.
    ```bash
    curl http://<your-vm-public-ip>:7130/api/health
    ```
    Debería ver una respuesta como: `{"status":"ok", ...}`

2.  **Acceder al panel:**
    Abra su navegador y navegue a: `http://<your-vm-public-ip>:7130`
    Inicie sesión con el `ROOT_ADMIN_USERNAME` y `ROOT_ADMIN_PASSWORD` que configuró en su archivo `.env`.

---

## Paso 5: 🌐 Configurar el dominio (Opcional pero recomendado)

1.  **Actualizar los registros DNS:**
    En la configuración de DNS de su proveedor de dominio, agregue dos **registros A** que apunten a la dirección IP pública de su VM:
    * `api.yourdomain.com` → `<your-vm-public-ip>`
    * `app.yourdomain.com` → `<your-vm-public-ip>`

2.  **Instalar y configurar Nginx como proxy inverso:**
    ```bash
    sudo apt install nginx -y
    sudo nano /etc/nginx/sites-available/insforge
    ```
    Pegue la siguiente configuración:
    ```nginx
    # Backend API
    server {
        listen 80;
        server_name api.yourdomain.com;
        location / {
            proxy_pass http://localhost:7130;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
    # Frontend Dashboard (served by the same port as the API)
    server {
        listen 80;
        server_name app.yourdomain.com;
        location / {
            proxy_pass http://localhost:7130;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
        }
    }
    ```
    Habilite la configuración y recargue Nginx:
    ```bash
    sudo ln -s /etc/nginx/sites-available/insforge /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl reload nginx
    ```

3.  **Instalar el certificado SSL con Certbot:**
    ```bash
    # Install Certbot for Nginx
    sudo apt install certbot python3-certbot-nginx -y
    # Obtain SSL certificates and configure Nginx automatically
    sudo certbot --nginx -d api.yourdomain.com -d app.yourdomain.com
    ```
    Siga las indicaciones. Certbot se encargará del resto.

4.  **Actualizar `.env` con URLs HTTPS:**
    Edite su archivo `.env` y actualice las URLs.
    ```bash
    cd ~/InsForge
    nano .env
    ```
    Cambie las URLs a `https`:
    ```ini
    API_BASE_URL=https://api.yourdomain.com
    VITE_API_BASE_URL=https://api.yourdomain.com
    ```
    Reinicie los servicios para que los cambios surtan efecto:
    ```bash
    docker compose down && docker compose up -d
    ```

---

## 🔧 Gestión y mantenimiento

* **Ver registros:** `docker compose logs -f` (todos los servicios) o `docker compose logs -f insforge` (servicio específico).
* **Detener servicios:** `docker compose down`
* **Reiniciar servicios:** `docker compose restart`
* **Actualizar InsForge:** Ejecute esto desde `~/InsForge/deploy/docker-compose`. Las imágenes están preconstruidas, así que descargue las últimas etiquetas en lugar de reconstruir.
    ```bash
    cd ~/InsForge/deploy/docker-compose
    git -C ~/InsForge pull origin main
    docker compose pull && docker compose up -d
    ```
* **Respaldar la base de datos:** Ejecute desde `~/InsForge/deploy/docker-compose`.
    ```bash
    docker compose exec postgres pg_dump -U postgres insforge > backup_$(date +%Y%m%d_%H%M%S).sql
    ```

## 🐛 Solución de problemas

* **Los servicios no inician:** Revise `docker compose logs` en busca de errores. Asegúrese de tener suficiente espacio en disco (`df -h`) y memoria (`free -h`).
* **Puerto ya en uso:** Compruebe qué proceso está usando el puerto con `sudo netstat -tulpn | grep :7130`.
* **Falta de memoria:** Considere actualizar su VM de Azure a un tamaño con más RAM.

## 📊 Estimación de costos

> **Aviso legal:** Los precios son estimaciones basadas en tarifas de pago por uso en una región común (por ejemplo, Este de EE. UU.) y pueden variar. Consulte siempre la [calculadora de precios oficial de Azure](https://azure.microsoft.com/en-us/pricing/calculator/) para obtener la información más precisa. En Azure, usted paga por los recursos de la VM (CPU, RAM, almacenamiento), que son compartidos por todos los servicios de Docker que ejecute en ella.

### Nivel gratuito (para pruebas)
* **Costo:** **~$0/mes** durante los primeros 12 meses.
* **Recursos:** Azure ofrece un nivel gratuito que incluye 750 horas/mes de una VM `B1s` con capacidad de ráfaga (burstable).
* **Limitaciones:** Esta VM tiene recursos muy limitados (1 vCPU, 1 GiB de RAM) y puede funcionar lentamente. Es adecuada solo para pruebas básicas y familiarización, no para desarrollo activo o producción.

### Configuración inicial (para desarrollo y proyectos pequeños)
* **Costo:** **~$30 - $40/mes**
* **Recursos:** Esta estimación corresponde a una VM `Standard_B2s` (2 vCPU, 4 GiB de RAM) que ejecuta todos los contenedores Docker de InsForge.
* **Desglose:** El costo consiste principalmente en las horas de cómputo de la VM. También incluye el almacenamiento del disco del sistema operativo y una dirección IP pública estática. Esta única VM ejecuta su base de datos, backend, Deno y todos los demás servicios.

### Configuración de producción (para escalabilidad y confiabilidad)
Para producción, puede elegir entre una VM más grande todo en uno o una configuración más robusta que use servicios administrados.

* **Opción A: VM más grande todo en uno**
    * **Costo:** **~$150 - $170/mes**
    * **Recursos:** Una VM `Standard_B4ms` más potente (4 vCPU, 16 GiB de RAM) para manejar mayor tráfico y todos los servicios.
    * **Ventajas:** Simple de gestionar, costo consolidado.
    * **Desventajas:** La base de datos y la aplicación comparten recursos, lo que puede generar cuellos de botella de rendimiento. Escalar requiere actualizar toda la VM.

* **Opción B: Servicios administrados (recomendado para producción)**
    * **Costo:** **~$120+/mes** (muy variable)
    * **Recursos:**
        * **VM de aplicación:** Una VM `Standard_B2s` para los servicios de la aplicación (InsForge, PostgREST, Deno). `(~$30/mes)`
        * **Base de datos administrada:** Use **Azure Database for PostgreSQL** para confiabilidad, copias de seguridad automatizadas y escalabilidad. `(~$40+/mes para un nivel inicial)`
    * **Ventajas:** Altamente confiable y escalable. El rendimiento de la base de datos está aislado y garantizado. Copias de seguridad y seguridad administradas.
    * **Desventajas:** Configuración más compleja, los costos se distribuyen entre varios servicios.

## 🔒 Mejores prácticas de seguridad

* **Cambiar las contraseñas predeterminadas:** Actualice siempre las contraseñas de administrador y de la base de datos.
* **Habilitar el firewall:** Use los **Grupos de seguridad de red (NSG)** de Azure para restringir el acceso a los puertos e direcciones IP necesarios.
* **Actualizaciones regulares:** Ejecute periódicamente `sudo apt update && sudo apt upgrade -y` y actualice InsForge.
* **Respaldar regularmente:** Automatice las copias de seguridad de la base de datos y la configuración.
