# InsForge Deployment Guides

This directory contains deployment guides for self-hosting InsForge on various platforms.

## 📚 Available Guides

### General (Any VPS)

- **[Deployment & Security Guide](./deployment-security-guide.md)** - Comprehensive guide for any Linux VPS
  - Full deployment walkthrough with Docker Compose
  - Reverse proxy setup (Nginx & Caddy)
  - Firewall, SSH hardening, and security best practices
  - Update, rollback, and automated backup procedures

### Cloud Platforms

> Note: the cloud-provider walkthroughs (AWS, Azure, GCP) are community-maintained and can lag the current release.

- **[AWS EC2](./deploy-to-aws-ec2.md)** - Deploy InsForge on Amazon EC2 with Docker Compose
  - Instance setup and configuration
  - Docker Compose deployment
  - Domain and SSL configuration
  - Production best practices

- **[Google Cloud Compute Engine](./deploy-to-google-cloud-compute-engine.md)** - Deploy InsForge on Google Cloud Compute Engine with Docker Compose
  - VM instance setup and configuration
  - Docker Compose deployment
  - Domain and SSL configuration
  - Production best practices

- **[Azure Virtual Machines](./deploy-to-azure-virtual-machines.md)** - Deploy InsForge on an Azure VM with Docker Compose
  - VM instance setup and configuration
  - Docker Compose deployment
  - Domain and SSL configuration
  - Production best practices

- **[Containarium](./deploy-to-containarium.md)** - Deploy InsForge on a self-hosted Containarium host (LXC + MCP-native control plane)
  - One-command box provisioning with Docker pre-installed
  - Built-in TLS-on-a-hostname via Caddy + ACME
  - Compose-autostart survives host reboots
  - Multi-tenant: many isolated InsForge projects per host
  - Optional agent-driven deploy via MCP

### Coming Soon

- **Digital Ocean** - Droplet deployment guide
- **Hetzner** - VPS deployment guide
- **Kubernetes** - Production-grade Kubernetes deployment
- **Railway** - One-click Railway deployment
- **Fly.io** - Global edge deployment

## 🎯 Choosing a Platform

### For Beginners
- **AWS EC2** - Well-documented, widely used
- **Railway** (Coming Soon) - One-click deployment

### For Production
- **AWS EC2** - Reliable, scalable, extensive features
- **Kubernetes** (Coming Soon) - High availability, auto-scaling

### For Cost-Conscious
- **Hetzner** (Coming Soon) - Best price-to-performance ratio
- **Digital Ocean** (Coming Soon) - Simple pricing, good performance

### For Global Distribution
- **AWS with CloudFront** - Global CDN integration
- **Fly.io** (Coming Soon) - Edge deployment in multiple regions

## 📋 General Requirements

All deployment methods require:

- Docker & Docker Compose support (for container-based deployments)
- Minimum 2 GB RAM (4 GB recommended)
- 20 GB storage (30 GB recommended)
- PostgreSQL 15+ compatible
- Internet connectivity for external services

## 🔧 Architecture Overview

InsForge consists of 4 main services:

1. **PostgreSQL** - Database (port 5432)
2. **PostgREST** - Auto-generated REST API (port 5430)
3. **InsForge Backend** - Node.js API server, also serves the dashboard (port 7130)
4. **Deno Runtime** - Serverless functions (port 7133)

## 🤝 Contributing

Have experience deploying InsForge on a platform not listed here? We'd love your contribution!

1. Fork the repository
2. Create a deployment guide following the AWS EC2 template
3. Submit a pull request

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for more details.

## 🆘 Need Help?

- **Documentation**: [https://docs.insforge.dev](https://docs.insforge.dev)
- **Discord Community**: [https://discord.com/invite/MPxwj5xVvW](https://discord.com/invite/MPxwj5xVvW)
- **GitHub Issues**: [https://github.com/insforge/insforge/issues](https://github.com/insforge/insforge/issues)
