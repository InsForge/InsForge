# InsForge Deployment Guides

This directory contains deployment guides for self-hosting InsForge on various platforms.

## 📚 Available Guides

### Self-Hosted Platforms

- **[Coolify](./deploy-to-coolify.md)** - Deploy InsForge on Coolify (open-source self-hosted PaaS)
  - 100% free and open source
  - Docker Compose deployment
  - Automatic SSL certificates (Let's Encrypt)
  - Built-in monitoring and backups
  - No vendor lock-in
  - Lowest cost option (~$5/month for VPS only)

### Cloud Platforms

- **[Render](./deploy-to-render.md)** - Deploy InsForge on Render with managed services
  - Managed PostgreSQL database
  - Automatic deployments from Git
  - Free SSL certificates
  - Simple scaling and monitoring
  - Blueprint (IaC) support

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

### Coming Soon

- **Digital Ocean** - Droplet deployment guide
- **Azure** - VM deployment guide
- **Hetzner** - VPS deployment guide
- **Kubernetes** - Production-grade Kubernetes deployment
- **Railway** - One-click Railway deployment
- **Fly.io** - Global edge deployment

## 🎯 Choosing a Platform

### For Beginners
- **Coolify** - Easiest self-hosted option with web UI and automatic SSL
- **Render** - Easiest managed deployment with auto-SSL and Git integration
- **Railway** (Coming Soon) - One-click deployment
- **AWS EC2** - Well-documented, widely used

### For Production
- **Coolify** - Self-hosted control with professional features
- **Render** - Managed services, auto-scaling, simple operations
- **AWS EC2** - Reliable, scalable, extensive features
- **Kubernetes** (Coming Soon) - High availability, auto-scaling

### For Cost-Conscious
- **Coolify** - Most affordable (~$5/month VPS only, software is free)
- **Render** - Competitive pricing, free tier available (~$28/month for production)
- **Hetzner** (Coming Soon) - Best price-to-performance ratio
- **Digital Ocean** (Coming Soon) - Simple pricing, good performance

### For Self-Hosting & Privacy
- **Coolify** - Complete control, your infrastructure, your data
- **AWS EC2** - Self-managed on your own EC2 instances
- **Google Cloud Compute Engine** - Self-managed on your own VMs
- **Hetzner** (Coming Soon) - Privacy-focused European provider

### For Global Distribution
- **Render** - Multi-region deployment with automatic CDN
- **Fly.io** (Coming Soon) - Edge deployment in multiple regions
- **AWS with CloudFront** - Global CDN integration

## 📋 General Requirements

All deployment methods require:

- Docker & Docker Compose support (for container-based deployments)
- Minimum 2 GB RAM (4 GB recommended)
- 20 GB storage (30 GB recommended)
- PostgreSQL 15+ compatible
- Internet connectivity for external services

## 🔧 Architecture Overview

InsForge consists of 6 main services:

1. **PostgreSQL** - Database (port 5432)
2. **PostgREST** - Auto-generated REST API (port 5430)
3. **Backend** - Node.js API server (port 7130)
4. **Frontend** - React dashboard (port 7131)
5. **Deno Runtime** - Serverless functions (port 7133)
6. **Vector** - Log collection and shipping

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
