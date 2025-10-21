<div align="center">
  <a href="https://insforge.dev">
    <img src="../assets/banner.png" alt="Insforge Logo">
  </a>
  
</div>
<p align="center">
   <a href="#quickstart-tldr">Commencer</a> · 
   <a href="https://docs.insforge.dev/introduction">Documentation</a> · 
   <a href="https://discord.gg/MPxwj5xVvW">Discord</a>
</p>
<p align="center">
   <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
   <a href="https://discord.gg/MPxwj5xVvW"><img src="https://img.shields.io/badge/Discord-Join%20Community-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
   <a href="https://github.com/InsForge/insforge/stargazers"><img src="https://img.shields.io/github/stars/InsForge/insforge?style=social" alt="GitHub Stars"></a>
</p>

# InsForge

**InsForge est l’alternative agent-native à Supabase.** Nous recréons les fonctionnalités de Supabase d’une manière conçue pour l’IA, afin de permettre aux agents intelligents de créer et de gérer des applications full-stack de façon autonome.

## Fonctionnalités clés et cas d’usage

### Fonctionnalités principales :
- **Authentification** – Système complet de gestion des utilisateurs
- **Base de données** – Stockage et récupération des données de manière flexible
- **Stockage** – Gestion et organisation des fichiers
- **Fonctions serverless** – Puissance de calcul évolutive
- **Déploiement de site** *(à venir)* – Déploiement d’applications simplifié

### Cas d’usage : Création d’applications full-stack à l’aide du langage naturel
- **Connecter des agents IA à InsForge** - Permettre à Claude, GPT ou à d’autres agents IA de gérer votre backend

## Exemples de prompt:

<td align="center">
  <img src="../assets/userflow.png" alt="userFlow">
  <br>
</td>

## Guide de démarrage rapide (TL;DR)

### 1. Installer et exécuter InsForge

**Utilisez Docker (Recommandé)**  
Prérequis: [Docker](https://www.docker.com/) + [Node.js](https://nodejs.org/)

```bash
# Exécutez avec Docker
git clone https://github.com/insforge/insforge.git
cd insforge
cp .env.example .env
docker compose up
```

### 2. Connectez un Agent IA

Visitez le tableau de bord InsForge (par défaut : http://localhost:7131), connectez-vous, suivez le guide « Connect » et configurez votre MCP.

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="../assets/signin.png" alt="Sign In">
        <br>
        <em>Se connecter à InsForge</em>
      </td>
      <td align="center">
        <img src="../assets/mcpInstallv2.png" alt="MCP Configuration">
        <br>
        <em>Configurez la connexion MCP</em>
      </td>
    </tr>
  </table>
</div>

### 3. Testez la Connexion

Dans votre agent, envoyez:
```
InsForge is my backend platform, what is my current backend structure?
```

<div align="center">
  <img src="../assets/sampleResponse.png" alt="Successful Connection Response" width="600">
  <br>
  <em>Exemple de réponse réussie lors de l’appel des outils MCP d’InsForge</em>
</div>

### 4. Commencez à utiliser InsForge

Commencez à créer votre projet dans un nouveau répertoire ! Créez votre prochaine application de tâches à faire, un clone d’Instagram ou une plateforme en ligne en quelques secondes !

**Exemples de prompts de projet :**
- "Créez une application de tâches à faire avec authentification utilisateur"
- "Créer un clone d’Instagram avec téléchargement d’images"

## Architecture


<div align="center">
  <img src="../assets/archDiagram.png" alt="Architecture Diagram">
  <br>
</div>



## Contribuer

**Contribuer**: Si vous souhaitez contribuer, vous pouvez consulter notre guide ici [CONTRIBUTING.md](CONTRIBUTING.md). Nous apprécions sincèrement les pull requests, toute forme d’aide est la bienvenue !

**Assistance**: Si vous avez besoin d’aide ou de support, nous sommes réactifs sur notre [Discord channel](https://discord.gg/MPxwj5xVvW), et n’hésitez pas non plus à nous envoyer un e-mail à [info@insforge.dev](mailto:info@insforge.dev) !


## Documentation & Assitance

### Documentation
- **[Official Docs](https://docs.insforge.dev/introduction)** - Guides complets et références API

### Communauté
- **[Discord](https://discord.gg/D3Vf8zD2ZS)** - Rejoignez notre communauté dynamique
- **[Twitter](https://x.com/InsForge_dev)** - Suivez-nous pour les mises à jour et les conseils

### Contact
- **Email**: info@insforge.dev

## Licence

Ce projet est sous licence Apache 2.0 – voir le fichier [LICENSE](LICENSE) pour les détails.

---

[![Star History Chart](https://api.star-history.com/svg?repos=InsForge/insforge&type=Date)](https://www.star-history.com/#InsForge/insforge&Date)
