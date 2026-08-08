---
title: "将 InsForge 自托管到 Dokploy"
description: "在 Dokploy 上以 Compose 应用部署 InsForge 后端，Postgres 镜像从仓库构建，配置始终与所部署的版本一致。"
---

# 将 InsForge 自托管到 Dokploy

本指南介绍如何在 [Dokploy](https://dokploy.com) 上自托管 InsForge 平台。Dokploy 是一个跑在你自己服务器上的开源 PaaS。

<Note>
  **这里部署的是 InsForge 本身，而不是你用它构建的应用。** 如果你只想让自己的应用上线，请用 [Sites](/core-concepts/sites/overview)。
</Note>

## 前置条件

- 一个 Dokploy 实例
- 一个解析到该服务器的域名或子域名

## 1. 创建应用

**Create → Compose**，把本仓库设为 provider，然后设置：

| 字段 | 值 |
| --- | --- |
| Compose Path | `deploy/dokploy/docker-compose.yml` |
| Compose Type | Docker Compose |

## 2. 环境变量

在 **Environment** 里设置以下变量。每个密钥都用 `openssl rand -hex 32` 生成：

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

## 3. 添加域名

栈不向宿主发布任何端口，所以只有配好路由才能访问。在 **Domains** 里添加你的域名：

| 字段 | 值 |
| --- | --- |
| Service Name | `insforge` |
| Container Port | `7130` |

然后把对应的地址加进环境变量：

```env
API_BASE_URL=https://insforge.example.com
VITE_API_BASE_URL=https://insforge.example.com
```

这两个必须和浏览器实际访问的地址一致，否则面板会请求错误的源。

只有 `insforge` 需要域名。Postgres、PostgREST 和 Deno 运行时都留在 Dokploy 的内部网络里。

## 4. 部署

按 **Deploy**。首次运行会构建两个小镜像（Postgres 和 Deno function host）、拉取其余镜像，然后自动执行后端迁移。

打开你的域名，用 `ROOT_ADMIN_USERNAME` / `ROOT_ADMIN_PASSWORD` 登录。

## 更新

再按一次 **Deploy**，或开启 Auto Deploy 让推送时自动重新部署。每次部署都会用当前 commit 重建 Postgres 和 Deno 镜像，所以它们的配置和 function host 始终跟着版本走。

更新前先看一下 `.env.example` 的 diff——新版本增加的变量不会自动出现在你的 Dokploy 环境里。

## 存储

对象存储默认落在 Docker 卷上的容器文件系统里。Dokploy 只接受单个 compose 文件，所以 MinIO 和 RustFS 的 overlay 用不了；可用的两种方案见 [Self-Hosted Storage](./self-host-storage.mdx)。

## 为什么 Postgres 是构建而不是拉取

InsForge 的 Postgres 需要仓库里的三个文件：`postgresql.conf`（它预加载 `insforge_pg_utils` 扩展，托管表上的行级安全依赖这个扩展）以及两个 init 脚本。

Dokploy 每次部署都会重新 clone `code/`，所以指向仓库的 bind mount 会失效——[它的文档](https://docs.dokploy.com/docs/core/troubleshooting/volumes-mounts)要求在 UI 里创建 File Mounts 并以 `../files/` 引用，这对每个安装都是一次手工配置。改为在部署时构建镜像、把当前文件放进去，什么都不用配，而且配置不会像预构建镜像那样落后于代码。
