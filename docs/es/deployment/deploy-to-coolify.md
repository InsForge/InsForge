---
title: "Autoalojar InsForge en Coolify"
description: "Autoaloja InsForge en Coolify como recurso de Docker Compose, con la imagen de Postgres construida desde el repositorio para coincidir con la versión."
---

# Autoalojar InsForge en Coolify

Esta guía explica cómo autoalojar la plataforma InsForge en [Coolify](https://coolify.io), un PaaS de código abierto que ejecutas en tu propio servidor.

<Note>
  **Esto despliega InsForge en sí, no la aplicación que construiste.** Si solo quieres publicar tu aplicación, usa [Sites](/core-concepts/sites/overview).
</Note>

## Requisitos previos

- Una instancia de Coolify y un servidor asociado a ella
- Un dominio o subdominio apuntando a ese servidor

## 1. Crear el recurso

**New Resource → Docker Compose**, conecta este repositorio (uno público no requiere GitHub App) y define:

| Campo | Valor |
| --- | --- |
| Base Directory | `/` |
| Docker Compose Location | `/deploy/coolify/docker-compose.yml` |

Deja Base Directory en la raíz del repositorio. El archivo compose construye Postgres desde `deploy/Dockerfile.postgres`, cuyo contexto de compilación es la raíz.

## 2. Variables de entorno

Define estas en **Environment Variables**. Genera cada secreto con `openssl rand -hex 32`:

```env
JWT_SECRET=<32+ characters>
ENCRYPTION_KEY=<32+ characters, different from JWT_SECRET>
POSTGRES_PASSWORD=<strong password>
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=<strong password>
```

`ENCRYPTION_KEY` recurre a `JWT_SECRET` si no se define, y rotar `JWT_SECRET` después vuelve indescifrable todo secreto almacenado: dale su propio valor ahora.

Postgres lee `POSTGRES_PASSWORD` solo cuando inicializa el clúster. Cambiarla después no cambia la contraseña de la base de datos.

Todo lo demás es opcional; [`.env.example`](https://github.com/insforge/insforge/blob/main/.env.example) enumera cada variable admitida con su valor por defecto.

## 3. Asignar un dominio

Coolify no expone un servicio compose que no publique puertos. En el servicio **insforge** del recurso, asigna tu dominio y define el puerto `7130`; luego añade las URL correspondientes al entorno:

```env
API_BASE_URL=https://insforge.example.com
VITE_API_BASE_URL=https://insforge.example.com
```

Deben coincidir con la URL que usan los navegadores, o el panel llamará al origen equivocado.

Solo `insforge` necesita un dominio. Postgres, PostgREST y el runtime de Deno permanecen en la red interna.

## 4. Desplegar

Pulsa **Deploy**. La primera ejecución construye dos imágenes pequeñas (Postgres y el host de funciones Deno), descarga el resto y ejecuta las migraciones del backend automáticamente.

Abre tu dominio e inicia sesión con `ROOT_ADMIN_USERNAME` / `ROOT_ADMIN_PASSWORD`.

## Actualizar

Coolify redespliega al hacer push si activaste el despliegue automático, o pulsa **Redeploy**. Cada despliegue reconstruye las imágenes de Postgres y Deno desde el commit actual, por lo que su configuración y el host de funciones siguen a la versión.

Revisa el diff de `.env.example` antes de actualizar: una versión que añada una variable no la añadirá a tu entorno de Coolify.

## Almacenamiento

El almacenamiento de objetos usa por defecto el sistema de archivos del contenedor en un volumen de Docker. Para S3, MinIO o RustFS, consulta [Self-Hosted Storage](./self-host-storage.mdx) y define las variables `S3_*` en el entorno de Coolify; el archivo compose las pasa al contenedor.

## Por qué Postgres se construye en lugar de descargarse

El Postgres de InsForge necesita tres archivos de este repositorio: `postgresql.conf` (que precarga la extensión `insforge_pg_utils`, de la que depende la seguridad a nivel de fila en las tablas gestionadas) y dos scripts de inicialización.

Coolify crea los bind mounts de archivos como directorios ([coollabsio/coolify#3375](https://github.com/coollabsio/coolify/issues/3375)), así que montarlos no es opción: Postgres no arranca. Construir la imagen en el despliegue coloca los archivos actuales dentro, lo que además impide que la configuración se quede atrás respecto al código, como sí ocurre con una imagen preconstruida.
