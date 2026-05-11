<div align="center">
  <a href="https://insforge.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.svg">
      <img src="assets/logo-dark.svg" alt="InsForge" width="500">
    </picture>
  </a>

  <p>
    The all-in-one, open-source backend platform for agentic coding.<br />
  </p>

  <p>
    <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-orange.svg" alt="License"></a>
    <a href="https://www.npmjs.com/package/@insforge/sdk"><img src="https://img.shields.io/npm/dt/@insforge/sdk?color=blue&label=downloads" alt="Downloads"></a>
    <a href="https://github.com/InsForge/InsForge/graphs/contributors"><img src="https://img.shields.io/github/contributors/InsForge/InsForge?color=green" alt="Contributors"></a>
    <a href="https://insforge.dev"><img src="https://img.shields.io/badge/Visit-InsForge.dev-181818?logoColor=white&labelColor=555555&logo=data:image/svg%2bxml;base64,PHN2ZyB3aWR0aD0iMjQwIiBoZWlnaHQ9IjI0MCIgdmlld0JveD0iMCAwIDI0MCAyNDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTI2LjExODQgMTAxLjZDMjMuMjkzOSA5OC43ODMzIDIzLjI5MzkgOTQuMjE2NiAyNi4xMTg0IDkxLjRMOTcuNzE2NyAyMEwyMDAgMjBMNzcuMjYgMTQyLjRDNzQuNDM1NSAxNDUuMjE3IDY5Ljg1NjIgMTQ1LjIxNyA2Ny4wMzE3IDE0Mi40TDI2LjExODQgMTAxLjZaIiBmaWxsPSJ3aGl0ZSIvPjxwYXRoIGQ9Ik0xNTUuMjUxIDc3LjM3NUwyMDAgMTIyVjIyNEwxMDQuMTA5IDEyOC4zNzVMMTU1LjI1MSA3Ny4zNzVaIiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPgo=" alt="Visit InsForge.dev"></a>
    <a href="https://gitcgr.com/InsForge/InsForge">
      <img src="https://gitcgr.com/badge/InsForge/InsForge.svg" alt="gitcgr" />
    </a>
  </p>
  <p>
    <a href="https://x.com/InsForge_dev"><img src="https://img.shields.io/badge/Follow%20on%20X-000000?logo=x&logoColor=white&style=for-the-badge" alt="Follow on X"></a>
    <a href="https://www.linkedin.com/company/insforge"><img src="https://img.shields.io/badge/Follow%20on%20LinkedIn-0A66C2?logo=linkedin&logoColor=white&style=for-the-badge" alt="Follow on LinkedIn"></a>
    <a href="https://discord.com/invite/MPxwj5xVvW"><img src="https://img.shields.io/badge/Join%20our%20Discord-5865F2?logo=discord&logoColor=white&style=for-the-badge" alt="Join our Discord"></a>
  </p>
  <a href="https://trendshift.io/repositories/19834" target="_blank">
    <img src="https://trendshift.io/api/badge/repositories/19834" alt="InsForge%2FInsForge | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/>
  </a>
  <br /><br />
  <a href="https://vercel.com/oss">
    <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge-2026.svg" />
  </a>
</div>

<p align="center">
  ⭐ <em>Help us reach more developers and grow the InsForge community. Star this repo!</em>
</p>

## InsForge
The all-in-one, open-source backend platform for agentic coding. InsForge gives your coding agent database, auth, storage, compute, hosting, and AI gateway to ship full-stack apps end-to-end.

https://github.com/user-attachments/assets/345efbc6-ca63-4189-bde0-12ef3bda561b

### How it works

Coding agents interact with InsForge through one of two interfaces:

- **MCP Server** (self-hosted and cloud): exposes InsForge's operations as tools any MCP-compatible agent can call.
- **CLI + Skills** (cloud only): a command-line interface paired with Skills that agents invoke directly from the terminal.

Both interfaces let coding agents operate the backend like backend engineers:

- **Read backend context and state**: Pull documentation, schemas, metadata (deployed functions, bucket contents, auth config), and runtime logs, so the agent has what it needs to write code, verify what it built, and debug when something breaks.
- **Configure primitives**: Deploy edge functions, run database migrations, create storage buckets, set up auth providers, and configure other backend resources directly.

```mermaid
graph TB

    subgraph TOP[" "]
        AG[AI Coding Agents]
    end

    subgraph MID[" "]
        SL[InsForge]
    end

    AG --> SL

    SL --> AUTH[Authentication]
    SL --> DB[Database]
    SL --> ST[Storage]
    SL --> EF[Edge Functions]
    SL --> MG[Model Gateway]
    SL --> CP[Compute]
    SL --> DEP[Deployment]

    classDef bar fill:#0b0f14,stroke:#30363d,stroke-width:1px,color:#ffffff
    classDef card fill:#161b22,stroke:#30363d,stroke-width:1px,color:#ffffff

    class AG,SL bar
    class AUTH,DB,ST,EF,MG,CP,DEP card

    style TOP fill:transparent,stroke:transparent
    style MID fill:transparent,stroke:transparent

    linkStyle default stroke:#30363d,stroke-width:1px
```

### Core Products:
- **Authentication**: User management, authentication, and sessions
- **Database**: Postgres relational database
- **Storage**: S3 compatible file storage
- **Model Gateway**: OpenAI compatible API across multiple LLM providers
- **Edge Functions**: Serverless code running on the edge
- **Compute** (private preview): Long-running container services
- **Site Deployment**: Site build and deployment


## ⭐️ Star the Repository

<p align="center">
  <img src="assets/insforge-star.gif" alt="Star InsForge" width="100%">
</p>

If you find InsForge useful or interesting, a GitHub Star ⭐️ would be greatly appreciated.

## Quickstart

### Cloud-hosted: [insforge.dev](https://insforge.dev)

<a href="https://insforge.dev" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/insforge.dev-181818?logo=data:image/svg%2bxml;base64,PHN2ZyB3aWR0aD0iMjQwIiBoZWlnaHQ9IjI0MCIgdmlld0JveD0iMCAwIDI0MCAyNDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTI2LjExODQgMTAxLjZDMjMuMjkzOSA5OC43ODMzIDIzLjI5MzkgOTQuMjE2NiAyNi4xMTg0IDkxLjRMOTcuNzE2NyAyMEwyMDAgMjBMNzcuMjYgMTQyLjRDNzQuNDM1NSAxNDUuMjE3IDY5Ljg1NjIgMTQ1LjIxNyA2Ny4wMzE3IDE0Mi40TDI2LjExODQgMTAxLjZaIiBmaWxsPSJ3aGl0ZSIvPjxwYXRoIGQ9Ik0xNTUuMjUxIDc3LjM3NUwyMDAgMTIyVjIyNEwxMDQuMTA5IDEyOC4zNzVMMTU1LjI1MSA3Ny4zNzVaIiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPgo=&logoColor=white" alt="InsForge.dev"></a>

### Self-hosted: Docker Compose

Prerequisites: [Docker](https://www.docker.com/) + [Node.js](https://nodejs.org/)

#### 1. Setup

You can run InsForge locally using Docker Compose. This will start a local InsForge instance on your machine.

[![Deploy on Docker][docker-btn]][docker-deploy]

Or run from source:
```bash
# Run with Docker
git clone https://github.com/InsForge/InsForge.git
cd insforge
cp .env.example .env
docker compose -f docker-compose.prod.yml up
```

#### 2. Connect InsForge MCP

Open [http://localhost:7130](http://localhost:7130)

Follow the steps to connect InsForge MCP Server

<div align="center">
  <img src="assets/connect.png" alt="Connect InsForge MCP" width="600">
</div>

#### 3. Verify installation

To verify the connection, send the following prompt to your agent:
```
I'm using InsForge as my backend platform, call InsForge MCP's fetch-docs tool to learn about InsForge instructions.
```

#### 4. Running Multiple Projects

You can run multiple InsForge projects on the same host by using different ports and project names.

```bash
# Create a separate env file for each project
cp .env.example .env.project1
cp .env.example .env.project2
```

Edit `.env.project2` with different ports:
```
POSTGRES_PORT=5442
POSTGREST_PORT=5440
APP_PORT=7230
AUTH_PORT=7231
DENO_PORT=7233
```

Start each project with a unique name:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.project1 -p project1 up -d
docker compose -f docker-compose.prod.yml --env-file .env.project2 -p project2 up -d
```

Each project gets its own isolated database, storage, and configuration. Manage them with:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.project1 -p project1 ps      # status
docker compose -f docker-compose.prod.yml --env-file .env.project1 -p project1 logs -f  # logs
docker compose -f docker-compose.prod.yml --env-file .env.project1 -p project1 down     # stop
```

### One-click Deployment

In addition to running InsForge locally, you can also launch InsForge using a pre-configured setup. This allows you to get up and running quickly with InsForge without installing Docker on your local machine.

| Railway | Zeabur | Sealos |
| --- | --- | --- |
| [![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/insforge) | [![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/Q82M3Y) | [![Deploy on Sealos](https://sealos.io/Deploy-on-Sealos.svg)](https://sealos.io/products/app-store/insforge) |


## Contributing

**Contributing**: If you're interested in contributing, you can check our guide here [CONTRIBUTING.md](CONTRIBUTING.md). We truly appreciate pull requests, all types of help are appreciated!

**Support**: If you need any help or support, we're responsive on our [Discord channel](https://discord.com/invite/MPxwj5xVvW), and also feel free to email us [info@insforge.dev](mailto:info@insforge.dev) too!


## Documentation & Support

### Documentation
- **[Official Docs](https://docs.insforge.dev/introduction)** - Comprehensive guides and API references

### Community
- **[Discord](https://discord.com/invite/MPxwj5xVvW)** - Join our vibrant community
- **[Twitter](https://x.com/InsForge_dev)** - Follow for updates and tips

### Contact
- **Email**: info@insforge.dev

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

---

[![Star History Chart](https://api.star-history.com/svg?repos=InsForge/InsForge&type=Date)](https://www.star-history.com/#InsForge/InsForge&Date)

## Badges

Show your project is built with InsForge.

### Made with InsForge

<a href="https://insforge.dev">
  <img
    width="168"
    height="30"
    src="https://insforge.dev/badge-made-with-insforge.svg"
    alt="Made with InsForge"
  />
</a>

**Markdown:**
```md
[![Made with InsForge](https://insforge.dev/badge-made-with-insforge.svg)](https://insforge.dev)
```

**HTML:**
```html
<a href="https://insforge.dev">
  <img
    width="168"
    height="30"
    src="https://insforge.dev/badge-made-with-insforge.svg"
    alt="Made with InsForge"
  />
</a>
```

### Made with InsForge (dark)

<a href="https://insforge.dev">
  <img
    width="168"
    height="30"
    src="https://insforge.dev/badge-made-with-insforge-dark.svg"
    alt="Made with InsForge"
  />
</a>

**Markdown:**
```md
[![Made with InsForge](https://insforge.dev/badge-made-with-insforge-dark.svg)](https://insforge.dev)
```

**HTML:**
```html
<a href="https://insforge.dev">
  <img
    width="168"
    height="30"
    src="https://insforge.dev/badge-made-with-insforge-dark.svg"
    alt="Made with InsForge"
  />
</a>
```


<p align="center">⭐ <b>Star us on GitHub</b> to get notified about new releases!</p>

<!-- LINK GROUPS -->

[docker-btn]: ./deploy/buttons/docker.png
[docker-deploy]: ./deploy/docker-deploy.md
