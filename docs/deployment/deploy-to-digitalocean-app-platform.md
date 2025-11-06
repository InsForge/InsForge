# Deploy InsForge on DigitalOcean App Platform

## Overview

This guide walks you through deploying **InsForge** — an open-source backend-as-a-service — on **DigitalOcean App Platform**.  
It covers the backend, frontend, and database setup, turning your local Docker Compose workflow into a fully managed cloud deployment.

---

## Before We Dive In

Here's what you'll need to get started:

* A DigitalOcean account (don't have one? [Sign up here](https://cloud.digitalocean.com/registrations/new) - they offer $200 in credits for new users!)
* Your InsForge code in a GitHub repo (we'll use this for automatic deployments)
* Basic familiarity with DigitalOcean's control panel

Pro tip: Keep this page open while you deploy, you'll thank me later!

---

## Let's Get Started!

### 1. Create Your New App (It's Easy!)

1. Head over to the [DigitalOcean App Platform](https://cloud.digitalocean.com/apps) - your new deployment home!
2. Look for that big blue **Create → Apps** button (you can't miss it!)
3. Connect your **GitHub** account - this is where the magic begins
4. Find and select your **InsForge** repository
5. Choose **Deploy from your source code** - DigitalOcean will automatically detect your app structure (pretty cool, right?)

### 2. Set Up Your Database

1. While setting up, click **Add Component → Database**
2. Pick **PostgreSQL v15**
3. Choose a plan that matches your needs
4. Name it `insforge-db` (or something cool - it's your call!)
5. Save those connection details somewhere safe - we'll need them in a bit!

Hot tip: DigitalOcean's managed PostgreSQL comes with automatic backups and updates - one less thing for you to worry about!

---

## Time to Set Up Your Environment!

Let's configure those important environment variables. Don't worry, I'll explain what each one does!

Head to **Settings → Environment Variables** and add these

```bash
# Your App's Core Settings
NODE_ENV=production            # Let's keep it professional in production!
PORT=7130                      # Your app's main port
JWT_SECRET=your-super-secure-jwt-secret       # Make this super strong!
ENCRYPTION_KEY=your-encryption-key-for-secrets # This too!

# Database Connection (The Important Stuff!)
DATABASE_URL=postgresql://doadmin:${DB_PASSWORD}@${DB_HOST}:5432/insforge?sslmode=require

# Your API Services (Where the Magic Happens)
POSTGREST_BASE_URL=https://your-app.ondigitalocean.app/api/postgrest
DENO_RUNTIME_URL=https://your-app.ondigitalocean.app/deno

# Admin Superuser (Your Keys to the Kingdom)
ADMIN_EMAIL=admin@yourapp.com
ADMIN_PASSWORD=secure-admin-password  # Please change this! 🙏
```

Pro tip: Use DigitalOcean's built-in secret manager for sensitive values - it's much safer than copying them directly!

---

## Deploying Services

### 1. Backend (Node.js)

* **Type:** Web Service
* **Build Command:**

  ```bash
  cd backend && npm install && npm run build
  ```
* **Run Command:**

  ```bash
  cd backend && npm run migrate:up && node index.js
  ```
* **HTTP Port:** 7130

### 2. Frontend (React)

* **Type:** Static Site
* **Build Command:**

  ```bash
  cd frontend && npm install && npm run build
  ```
* **Output Directory:** `frontend/dist`
* **Environment Variable:**

  ```bash
  VITE_API_BASE_URL=https://your-app.ondigitalocean.app/api
  ```

### 3. PostgREST

* **Type:** Web Service
* **Image:** `postgrest/postgrest:v12.2.12`
* **Environment Variables:**

  ```bash
  PGRST_DB_URI=${DATABASE_URL}
  PGRST_DB_SCHEMA=public
  PGRST_DB_ANON_ROLE=anon
  PGRST_JWT_SECRET=${JWT_SECRET}
  ```
* **Route:** `/api/postgrest/*`

### 4. Deno Runtime

* **Type:** Web Service
* **Build Command:**

  ```bash
  deno cache functions/server.ts
  ```
* **Run Command:**

  ```bash
  deno run --allow-net --allow-env --allow-read functions/server.ts
  ```
* **Environment Variables:**

  ```bash
  PORT=7133
  DENO_ENV=production
  DATABASE_URL=${DATABASE_URL}
  POSTGREST_BASE_URL=https://your-app.ondigitalocean.app/api/postgrest
  JWT_SECRET=${JWT_SECRET}
  ```
* **Route:** `/deno/*`

---

## The Moment of Truth! 🎉

Once everything is deployed (fingers crossed!), here's where you'll find your services:

* 🏠 Main App → `https://your-app.ondigitalocean.app`
* ⚙️ Backend API → `https://your-app.ondigitalocean.app/api`
* 🔄 PostgREST API → `https://your-app.ondigitalocean.app/api/postgrest`
* 🦕 Deno Runtime → `https://your-app.ondigitalocean.app/deno`

## Uh-oh! Troubleshooting Guide 🔧

Don't worry if things don't work right away - we've got your back! Here are some common hiccups and how to fix them:

### 🔌 Database Connection Issues?

* Double-check that connection string - those sneaky character errors can be tricky!
* Make sure your PostgreSQL instance is up and running
* Is `sslmode=require` included in your connection string? (DigitalOcean loves its security!)

### 🏗️ Build Acting Up?

* Take a peek at your Node.js and Deno versions in `package.json` - they should match your local setup
* Missing files? Make sure `functions/server.ts` and `backend/index.js` are where they should be
* Build logs are your friends - they'll tell you exactly what's wrong!

### 🤝 APIs Not Playing Nice?

* Check those URLs! Make sure `VITE_API_BASE_URL`, `POSTGREST_BASE_URL`, and `DENO_RUNTIME_URL` are pointing to the right places
* Try hitting the endpoints directly - sometimes it's just a small typo!

Remember: Most deployment issues are just tiny configuration oversights. Take a deep breath, check the logs, and you'll figure it out! 💪

---

# Level Up: Advanced Production Guide 🚀

## Ready to Go Pro?

Awesome! You've got the basics down - now let's take your InsForge deployment to the next level! This section is packed with pro tips for running a production-grade setup. We'll cover everything from scaling to security, and all those cool features that make your app enterprise-ready! 💪

---

## Components

### 1. Main InsForge Backend

* Type: **Web Service (Node.js)**
* Ports: 7130
* Handles user authentication, API routes, and migration scripts.

### 2. PostgREST API

* Type: **Internal API Gateway**
* Provides SQL-to-REST translation for PostgreSQL.
* Secured via JWT using `PGRST_JWT_SECRET`.

### 3. Deno Worker Runtime

* Type: **Background Execution Service**
* Executes async tasks, triggers, or scripts defined in `/functions`.

### 4. Frontend Dashboard

* Type: **React Web UI**
* Built into static files served via App Platform.

### 5. Managed PostgreSQL Database

* Replace Docker’s local Postgres container with **DigitalOcean Managed PostgreSQL**.

---

## Required Environment Variables

| Variable             | Description                        |
| -------------------- | ---------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string       |
| `JWT_SECRET`         | Secret for signing JWT tokens      |
| `ENCRYPTION_KEY`     | Used for sensitive data encryption |
| `POSTGREST_BASE_URL` | URL of PostgREST service           |
| `DENO_RUNTIME_URL`   | URL of Deno service                |
| `ADMIN_EMAIL`        | Default admin account email        |
| `ADMIN_PASSWORD`     | Default admin password             |

### Optional Variables

| Variable                                   | Description               |
| ------------------------------------------ | ------------------------- |
| `AWS_ACCESS_KEY_ID`                        | For S3-compatible storage |
| `AWS_SECRET_ACCESS_KEY`                    | For S3-compatible storage |
| `AWS_S3_BUCKET`                            | Bucket name               |
| `AWS_REGION`                               | AWS region                |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth integration         |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth integration  |
| `OPENROUTER_API_KEY`                       | LLM/AI services key       |

---

## Deployment Flow

1. Deploy the database and backend first.
2. Deploy PostgREST and Deno as internal services.
3. Deploy the frontend last and verify environment variables.

---

## Monitoring & Security

* Use DigitalOcean’s built-in logs and metrics.
* Store secrets only in App Platform environment variables.
* Use HTTPS in production.
* Regularly rotate JWT and encryption keys.
* Enable database firewall rules and backups.

---

## What's Next? Let's Make It Even Better! 🌟

Now that your app is live, here are some cool things you might want to do:

* 🔒 Add your own domain and SSL (look how professional!)
* 🤖 Set up CI/CD for automatic deployments (because who likes manual deploys?)
* 💾 Enable those sweet, sweet automatic database backups
* 📈 Keep an eye on your metrics (trust me, your future self will thank you!)

## Need Help? 

* 💬 Join our [Discord community](https://discord.gg/insforge) - we're always happy to help!
* 📚 Check out the [DigitalOcean App Platform docs](https://docs.digitalocean.com/products/app-platform/)
* 🐛 Found a bug? Open an issue on our [GitHub repo](https://github.com/ryassho/InsForge)

Remember: You've got this! And if you build something cool with InsForge, we'd love to see it! Tag us on Twitter [@InsForge](https://twitter.com/InsForge)

Happy coding! 🚀