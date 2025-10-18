<div align="center">
  <a href="https://insforge.dev">
    <img src="assets/banner.png" alt="Insforge Logo">
  </a>
  
</div>
<p align="center">
   <a href="#quickstart-tldr">Get Started</a> · 
   <a href="https://docs.insforge.dev/introduction">Documentation</a> · 
   <a href="https://discord.com/invite/MPxwj5xVvW">Discord</a>
</p>
<p align="center">
   <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
   <a href="https://discord.com/invite/MPxwj5xVvW"><img src="https://img.shields.io/badge/Discord-Join%20Community-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
   <a href="https://github.com/InsForge/insforge/stargazers"><img src="https://img.shields.io/github/stars/InsForge/insforge?style=social" alt="GitHub Stars"></a>
</p>

# InsForge

**InsForge is the Agent-Native Supabase Alternative.** We are building the features of Supabase in an AI-native way, enabling AI agents to build and manage full-stack applications autonomously. 

## Key Features & Use Cases

### Core Features:
- **Authentication** - Complete user management system
- **Database** - Flexible data storage and retrieval
- **Storage** - File management and organization
- **Serverless Functions** - Scalable compute power
- **Site Deployment** *(coming soon)* - Easy application deployment

### Use Cases: Building full-stack applications using natural language
- **Connect AI agents to InsForge** - Enable Claude, GPT, or other AI agents to manage your backend
- **Add backend to Lovable or Bolt-style vibe coding project projects** - Instant backend for AI-generated frontends

## Prompt Examples:

<td align="center">
  <img src="assets/userflow.png" alt="userFlow">
  <br>
</td>

## Quickstart TLDR;

### 1. Install and run InsForge

**Use Docker (Recommended)**  
Prerequisites: [Docker](https://www.docker.com/) + [Node.js](https://nodejs.org/)

```bash
# Run with Docker
git clone https://github.com/insforge/insforge.git
cd insforge
cp .env.example .env
docker compose up
```

### 2. Connect an AI Agent

Visit InsForge Dashboard (default: http://localhost:7131), log in, and follow the "Connect" guide, and set up your MCP.

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="assets/signin.png" alt="Sign In">
        <br>
        <em>Sign in to InsForge</em>
      </td>
      <td align="center">
        <img src="assets/mcpInstallv2.png" alt="MCP Configuration">
        <br>
        <em>Configure MCP connection</em>
      </td>
    </tr>
  </table>
</div>

### 3. Test the Connection

In your agent, send:
```
InsForge is my backend platform, what is my current backend structure?
```

<div align="center">
  <img src="assets/sampleResponse.png" alt="Successful Connection Response" width="600">
  <br>
  <em>Sample successful response calling insforge MCP tools</em>
</div>

### 4. Start Using InsForge

Start building your project in a new directory! Build your next todo app, Instagram clone, or online platform in seconds!

**Sample Project Prompts:**
- "Build a todo app with user authentication"
- "Create an Instagram with image upload"

## Architecture


<div align="center">
  <img src="assets/archDiagram.png" alt="Architecture Diagram">
  <br>
</div>



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

[![Star History Chart](https://api.star-history.com/svg?repos=InsForge/insforge&type=Date)](https://www.star-history.com/#InsForge/insforge&Date)

## Translations

- [Arabic | العربية](/i18n/README.ar.md)
- [Spanish | Español](/i18n/README.es.md)
- [French | Français](/i18n/README.fr.md)
- [Hindi | हिंदी](/i18n/README.hi.md)
- [Japanese | 日本語](/i18n/README.ja.md)
- [Korean | 한국어](/i18n/README.ko.md)
- [Portuguese (Brazilian) / Português Brasileiro](/i18n/README.pt-BR.md)
- [Russian | Русский](/i18n/README.ru.md)
- [Chinese (Simplified) | 简体中文](/i18n/README.zh-CN.md)
