<div align="center">
  <a href="https://insforge.dev">
    <img src="../assets/banner.png" alt="Logo de InsForge">
  </a>
</div>

<p align="center">
   <a href="#inicio-rápido-tldr">Comenzar</a> · 
   <a href="https://docs.insforge.dev/introduction">Documentación</a> · 
   <a href="https://discord.com/invite/MPxwj5xVvW">Discord</a>
</p>

<p align="center">
   <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="Licencia"></a>
   <a href="https://discord.com/invite/MPxwj5xVvW"><img src="https://img.shields.io/badge/Discord-Unirse%20a%20la%20Comunidad-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
   <a href="https://github.com/InsForge/insforge/stargazers"><img src="https://img.shields.io/github/stars/InsForge/insforge?style=social" alt="Estrellas en GitHub"></a>
</p>

# InsForge

**InsForge es la alternativa nativa para agentes de Supabase.**  
Estamos construyendo las funcionalidades de Supabase de una manera nativa para IA, permitiendo que los agentes de inteligencia artificial creen y administren aplicaciones full-stack de forma autónoma.

---

## Funciones Clave y Casos de Uso

### Funciones Principales:
- **Autenticación** - Sistema completo de gestión de usuarios  
- **Base de Datos** - Almacenamiento y recuperación de datos flexible  
- **Almacenamiento** - Gestión y organización de archivos  
- **Funciones Serverless** - Potencia de cómputo escalable  
- **Despliegue de Sitios** *(próximamente)* - Despliegue de aplicaciones fácilmente  

### Casos de Uso: Crear aplicaciones full-stack usando lenguaje natural  
- **Conecta agentes de IA a InsForge** - Permite que Claude, GPT u otros agentes de IA administren tu Backend  
- **Agrega un Backend a proyectos tipo Lovable o Bolt** - Backend instantáneo para Frontends generados por IA  

---

## Ejemplos de Prompts:

<td align="center">
  <img src="../assets/userflow.png" alt="Flujo de usuario">
  <br>
</td>

---

## Inicio Rápido (TLDR)

### 1. Instalar y ejecutar InsForge

**Usar Docker (Recomendado)**  
Requisitos previos: [Docker](https://www.docker.com/) + [Node.js](https://nodejs.org/)

```bash
# Ejecutar con Docker
git clone https://github.com/insforge/insforge.git
cd insforge
cp .env.example .env
docker compose up
```

---

### 2. Conectar un Agente de IA

Visita el **Panel de Control de InsForge** (por defecto: http://localhost:7131), inicia sesión y sigue la guía “Connect” para configurar tu MCP.

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="../assets/signin.png" alt="Iniciar Sesión">
        <br>
        <em>Inicia sesión en InsForge</em>
      </td>
      <td align="center">
        <img src="../assets/mcpInstallv2.png" alt="Configuración MCP">
        <br>
        <em>Configura la conexión MCP</em>
      </td>
    </tr>
  </table>
</div>

---

### 3. Probar la Conexión

En tu agente, envía:
```
InsForge es mi plataforma Backend, ¿cuál es mi estructura actual de Backend?
```

<div align="center">
  <img src="../assets/sampleResponse.png" alt="Respuesta de Conexión Exitosa" width="600">
  <br>
  <em>Ejemplo de respuesta exitosa usando las herramientas MCP de InsForge</em>
</div>

---

### 4. Comienza a Usar InsForge

Empieza a construir tu proyecto en un nuevo directorio.  
¡Crea tu próxima aplicación de tareas, clon de Instagram o plataforma en línea en segundos!

**Ejemplos de Prompts de Proyecto:**
- “Crea una aplicación de tareas con autenticación de usuario”  
- “Crea un Instagram con carga de imágenes”  

---

## Arquitectura

<div align="center">
  <img src="../assets/archDiagram.png" alt="Diagrama de Arquitectura">
  <br>
</div>

---

## Contribuir

**Contribuciones:** Si estás interesado en contribuir, revisa nuestra guía [CONTRIBUTING.md](CONTRIBUTING.md).  
Agradecemos mucho los *pull requests* — ¡toda ayuda es bienvenida!

**Soporte:** Si necesitas ayuda, somos muy receptivos en nuestro [canal de Discord](https://discord.com/invite/MPxwj5xVvW), o puedes escribirnos a [info@insforge.dev](mailto:info@insforge.dev).

---

## Documentación y Soporte

### Documentación
- **[Documentación Oficial](https://docs.insforge.dev/introduction)** - Guías completas y referencias de API

### Comunidad
- **[Discord](https://discord.com/invite/MPxwj5xVvW)** - Únete a nuestra comunidad activa  
- **[Twitter](https://x.com/InsForge_dev)** - Síguenos para actualizaciones y consejos  

### Contacto
- **Correo Electrónico:** info@insforge.dev

---

## Licencia

Este proyecto está licenciado bajo la **Licencia Apache 2.0** – consulta el archivo [LICENSE](LICENSE) para más detalles.

---

[![Historial de Estrellas](https://api.star-history.com/svg?repos=InsForge/insforge&type=Date)](https://www.star-history.com/#InsForge/insforge&Date)
