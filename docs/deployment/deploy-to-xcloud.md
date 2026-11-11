---
title: "Self-Host InsForge on xCloud"
description: "Self-host InsForge on xCloud from its OneClick app catalog, with domain, HTTPS and generated admin credentials set up for you."
---

# Self-Host InsForge on xCloud

This guide walks through self-hosting the InsForge platform on [xCloud](https://xcloud.host/insforge-hosting/), a managed hosting control panel that deploys InsForge from its OneClick app catalog onto a server you choose.

<Note>
  **This deploys InsForge itself, not the app you built.** If you just want to take your app live, use [Sites](/core-concepts/sites/overview) instead.
</Note>

<Note>
  xCloud is a commercial service, and this template is maintained by xCloud, not by the InsForge team. The steps below describe the xCloud side; for anything about the InsForge services themselves, the rest of these docs apply.
</Note>

## Prerequisites

- An xCloud account
- A server connected to xCloud
- A domain or subdomain for the install

The template asks for a server with at least 1 GB of RAM, 2 CPU cores and 10 GB of disk, running xCloud's Docker and Nginx stack.

## 1. Pick InsForge from the catalog

In xCloud, choose **InsForge** from the OneClick app catalog. Select your domain and the target server.

## 2. Set the admin login

Enter the **Admin Login** email. Leave **Admin Password** empty to have xCloud generate one.

xCloud also generates the API key and anon key for the install and shows them in the credentials panel. Use the anon key in client apps and keep the API key for servers and agents only.

## 3. Deploy

Start the install. The first start runs database migrations and takes a few minutes. xCloud runs the pinned InsForge images together with Postgres, PostgREST and the Deno functions runtime, mounts four volumes (Postgres data, storage, logs and the functions cache), and publishes the dashboard and API over HTTPS.

Only the InsForge service on port `7130` is published. Postgres, PostgREST and the Deno runtime stay private to the server.

## 4. Sign in

Open your domain and sign in with the root admin login. If you left the password empty, find the generated password in the credentials panel for the install.

From there you can create your first table, or open the **Connect** page in the dashboard to link an AI coding agent over MCP.

## Limitations

- The root admin is the only dashboard login.
- The InsForge CLI and Skills work only with InsForge Cloud, not with this install.
- Running your own containers is disabled, because it would need access to the Docker socket.

## Storage

xCloud mounts a storage volume for uploads, so files live on the local disk of the server you chose. Uploads are limited to 50 MB each. S3-compatible storage can be configured later through the environment editor.
