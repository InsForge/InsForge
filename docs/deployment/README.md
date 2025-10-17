# InsForge Deployment Guides

This directory contains deployment guides for self-hosting InsForge on various platforms.

## 📚 Available Guides

### Cloud Platforms

- **[AWS EC2](./deploy-to-aws-ec2.md)** - Deploy InsForge on Amazon EC2 with Docker Compose
  - Instance setup and configuration
  - Docker Compose deployment
  - Domain and SSL configuration
  - Production best practices

### Coming Soon

- **Digital Ocean** - Droplet deployment guide
- **Google Cloud Platform** - GCE deployment guide
- **Azure** - VM deployment guide
- **Hetzner** - VPS deployment guide
- **Kubernetes** - Production-grade Kubernetes deployment
- **Railway** - One-click Railway deployment
- **Fly.io** - Global edge deployment

## 🎯 Choosing a Platform

### For Beginners
- **Railway** (Coming Soon) - Easiest, one-click deployment
- **AWS EC2** - Well-documented, widely used

### For Production
- **AWS EC2** - Reliable, scalable, extensive features
- **Kubernetes** (Coming Soon) - High availability, auto-scaling

### For Cost-Conscious
- **Hetzner** (Coming Soon) - Best price-to-performance ratio
- **Digital Ocean** (Coming Soon) - Simple pricing, good performance

### For Global Distribution
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

InsForge consists of 5 main services:

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

