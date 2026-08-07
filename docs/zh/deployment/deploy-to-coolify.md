---
title: "将 InsForge 自托管到 Coolify"
description: "在 Coolify 上以 Docker Compose 资源部署 InsForge 后端，Postgres 镜像从仓库构建，配置始终与所部署的版本一致。"
---

# 将 InsForge 自托管到 Coolify

本指南介绍如何在 [Coolify](https://coolify.io) 上自托管 InsForge 平台。Coolify 是一个跑在你自己服务器上的开源 PaaS。

<Note>
  **这里部署的是 InsForge 本身，而不是你用它构建的应用。** 如果你只想让自己的应用上线，请用 [Sites](/core-concepts/sites/overview)。
</Note>

## 前置条件

- 一个 Coolify 实例，以及挂在它下面的服务器
- 一个解析到该服务器的域名或子域名

## 1. 创建资源

**New Resource → Docker Compose**，连接本仓库（公开仓库不需要 GitHub App），然后设置：

| 字段 | 值 |
| --- | --- |
| Base Directory | `/` |
| Docker Compose Location | `/deploy/coolify/docker-compose.yml` |

Base Directory 保持仓库根目录。compose 文件用 `deploy/Dockerfile.postgres` 构建 Postgres，它的构建上下文就是根目录。

## 2. 环境变量

在 **Environment Variables** 里设置以下变量。每个密钥都用 `openssl rand -hex 32` 生成：

```env
JWT_SECRET=<32+ characters>
ENCRYPTION_KEY=<32+ characters, different from JWT_SECRET>
POSTGRES_PASSWORD=<strong password>
ROOT_ADMIN_USERNAME=admin
ROOT_ADMIN_PASSWORD=<strong password>
```

`ENCRYPTION_KEY` 不设时会回退到 `JWT_SECRET`，而之后轮换 `JWT_SECRET` 会让所有已存密钥无法解密——现在就给它一个独立的值。

Postgres 只在初始化数据簇时读 `POSTGRES_PASSWORD`。之后再改不会改变数据库密码。

其余都是可选的；[`.env.example`](https://github.com/insforge/insforge/blob/main/.env.example) 列出了所有支持的变量及其默认值。

## 3. 分配域名

Coolify 不会暴露没有发布端口的 compose 服务。在资源的 **insforge** 服务下分配你的域名并把端口设为 `7130`，然后把对应的地址加进环境变量：

```env
API_BASE_URL=https://insforge.example.com
VITE_API_BASE_URL=https://insforge.example.com
```

这两个必须和浏览器实际访问的地址一致，否则面板会请求错误的源。

只有 `insforge` 需要域名。Postgres、PostgREST 和 Deno 运行时都留在内部网络里。

## 4. 部署

按 **Deploy**。首次运行会构建两个小镜像（Postgres 和 Deno function host）、拉取其余镜像，然后自动执行后端迁移。

打开你的域名，用 `ROOT_ADMIN_USERNAME` / `ROOT_ADMIN_PASSWORD` 登录。

## 更新

如果开了自动部署，Coolify 会在推送时重新部署，也可以手动按 **Redeploy**。每次部署都会用当前 commit 重建 Postgres 和 Deno 镜像，所以它们的配置和 function host 始终跟着版本走。

更新前先看一下 `.env.example` 的 diff——新版本增加的变量不会自动出现在你的 Coolify 环境里。

## 存储

对象存储默认落在 Docker 卷上的容器文件系统里。要用 S3、MinIO 或 RustFS，请参见 [Self-Hosted Storage](./self-host-storage.mdx)，并在 Coolify 的环境变量里设置 `S3_*`——compose 文件会把它们透传进去。

## 为什么 Postgres 是构建而不是拉取

InsForge 的 Postgres 需要仓库里的三个文件：`postgresql.conf`（它预加载 `insforge_pg_utils` 扩展，托管表上的行级安全依赖这个扩展）以及两个 init 脚本。

Coolify 会把文件类型的 bind mount 创建成目录（[coollabsio/coolify#3375](https://github.com/coollabsio/coolify/issues/3375)），所以挂载这条路走不通——Postgres 起不来。改为在部署时构建镜像，把当前的文件放进去，这也意味着配置不会像预构建镜像那样落后于代码。
