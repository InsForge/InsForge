---
title: "Autoalojar InsForge en Dokploy"
description: "Autoaloja InsForge en Dokploy como aplicación Compose, con la imagen de Postgres construida desde el repositorio para coincidir con la versión desplegada."
---

# Autoalojar InsForge en Dokploy

Esta guía explica cómo autoalojar la plataforma InsForge en [Dokploy](https://dokploy.com), un PaaS de código abierto que ejecutas en tu propio servidor.

<Note>
  **Esto despliega InsForge en sí, no la aplicación que construiste.** Si solo quieres publicar tu aplicación, usa [Sites](/core-concepts/sites/overview).
</Note>

## Requisitos previos

- Una instancia de Dokploy
- Un dominio o subdominio apuntando a ese servidor

## 1. Crear la aplicación

**Create → Compose**, conecta este repositorio como proveedor y define:

| Campo | Valor |
| --- | --- |
| Compose Path | `deploy/dokploy/docker-compose.yml` |
| Compose Type | Docker Compose |

## 2. Variables de entorno

Define estas en **Environment**. Genera cada secreto con `openssl rand -hex 32`:

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

## 3. Añadir un dominio

Nada se publica en el host, así que el stack solo es accesible cuando enrutas hacia él. En **Domains**, añade tu dominio con:

| Campo | Valor |
| --- | --- |
| Service Name | `insforge` |
| Container Port | `7130` |

Luego añade las URL correspondientes al entorno:

```env
API_BASE_URL=https://insforge.example.com
VITE_API_BASE_URL=https://insforge.example.com
```

Deben coincidir con la URL que usan los navegadores, o el panel llamará al origen equivocado.

Solo `insforge` necesita un dominio. Postgres, PostgREST y el runtime de Deno permanecen en la red interna de Dokploy.

## 4. Desplegar

Pulsa **Deploy**. La primera ejecución construye dos imágenes pequeñas (Postgres y el host de funciones Deno), descarga el resto y ejecuta las migraciones del backend automáticamente.

Abre tu dominio e inicia sesión con `ROOT_ADMIN_USERNAME` / `ROOT_ADMIN_PASSWORD`.

## Actualizar

Pulsa **Deploy** de nuevo, o activa Auto Deploy para redesplegar al hacer push. Cada despliegue reconstruye las imágenes de Postgres y Deno desde el commit actual, por lo que su configuración y el host de funciones siguen a la versión.

Revisa el diff de `.env.example` antes de actualizar: una versión que añada una variable no la añadirá a tu entorno de Dokploy.

## Almacenamiento

El almacenamiento de objetos usa por defecto el sistema de archivos del contenedor en un volumen de Docker. Dokploy acepta un único archivo compose, así que los overlays de MinIO y RustFS no aplican; consulta [Self-Hosted Storage](./self-host-storage.mdx) para las dos opciones que sí.

## Por qué Postgres se construye en lugar de descargarse

El Postgres de InsForge necesita tres archivos de este repositorio: `postgresql.conf` (que precarga la extensión `insforge_pg_utils`, de la que depende la seguridad a nivel de fila en las tablas gestionadas) y dos scripts de inicialización.

Dokploy vuelve a clonar `code/` en cada despliegue, así que un bind mount que apunte al repositorio queda obsoleto: [su documentación](https://docs.dokploy.com/docs/core/troubleshooting/volumes-mounts) exige File Mounts creados en la UI y referenciados como `../files/`, lo que supone configuración manual en cada instalación. Construir la imagen en el despliegue coloca los archivos actuales dentro, sin nada que configurar, y la configuración no puede quedarse atrás respecto al código como sí ocurre con una imagen preconstruida.
