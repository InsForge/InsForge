<div align="center">
  <a href="https://insforge.dev">
    <img src="assets/banner.png" alt="Insforge Logo">
  </a>
  
</div>
<p align="center">
   <a href="#quickstart-tldr">Erste Schritte</a> · 
   <a href="https://docs.insforge.dev/introduction">Dokumentation</a> · 
   <a href="https://discord.com/invite/MPxwj5xVvW">Discord</a>
</p>
<p align="center">
   <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="Lizenz"></a>
   <a href="https://discord.com/invite/MPxwj5xVvW"><img src="https://img.shields.io/badge/Discord-Join%20Community-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
   <a href="https://github.com/InsForge/insforge/stargazers"><img src="https://img.shields.io/github/stars/InsForge/insforge?style=social" alt="GitHub Sterne"></a>
</p>

# InsForge

**InsForge ist die Agent-Native Supabase Alternative.** Wir entwickeln die Funktionen von Supabase auf eine AI-native Weise und ermöglichen es AI Agenten, vollständige Anwendungen autonom zu erstellen und zu verwalten.

## Hauptfunktionen & Anwendungsfälle

### Kernfunktionen:
- **Authentifizierung** - Vollständiges Benutzerverwaltungssystem
- **Datenbank** - Flexible Datenspeicherung und -abruf
- **Speicher** - Dateiverwaltung und -organisation
- **Serverless Functions** - Skalierbare Rechenleistung
- **Website-Deployment** *(in Kürze)* - Einfache Anwendungsbereitstellung

### Anwendungsfälle: Entwicklung von Full-Stack-Anwendungen mit natürlicher Sprache
- **AI-Agenten mit InsForge verbinden** - Ermöglichen Sie Claude, GPT oder anderen AI-Agenten die Verwaltung Ihres Backends
- **Backend zu Lovable oder Bolt-Style Vibe Coding-Projekten hinzufügen** - Sofortiges Backend für AI-generierte Frontends

## Prompt-Beispiele:

<td align="center">
  <img src="assets/userflow.png" alt="Benutzerablauf">
  <br>
</td>

## Schnellstart TLDR;

### 1. InsForge installieren und ausführen

**Docker verwenden (Empfohlen)**  
Voraussetzungen: [Docker](https://www.docker.com/) + [Node.js](https://nodejs.org/)

```bash
# Mit Docker ausführen
git clone https://github.com/insforge/insforge.git
cd insforge
cp .env.example .env
docker compose up
```

### 2. AI-Agent verbinden

Besuchen Sie das InsForge Dashboard (Standard: http://localhost:7131), melden Sie sich an und folgen Sie der "Verbinden"-Anleitung, um Ihren MCP einzurichten.

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="assets/signin.png" alt="Anmelden">
        <br>
        <em>Bei InsForge anmelden</em>
      </td>
      <td align="center">
        <img src="assets/mcpInstallv2.png" alt="MCP-Konfiguration">
        <br>
        <em>MCP-Verbindung konfigurieren</em>
      </td>
    </tr>
  </table>
</div>

### 3. Verbindung testen

Senden Sie in Ihrem Agenten:
```
InsForge ist meine Backend-Plattform, wie ist meine aktuelle Backend-Struktur?
```

<div align="center">
  <img src="assets/sampleResponse.png" alt="Erfolgreiche Verbindungsantwort" width="600">
  <br>
  <em>Beispiel einer erfolgreichen Antwort beim Aufruf von InsForge MCP-Tools</em>
</div>

### 4. InsForge verwenden

Beginnen Sie mit der Entwicklung Ihres Projekts in einem neuen Verzeichnis! Erstellen Sie Ihre nächste Todo-App, Instagram-Klon oder Online-Plattform in Sekundenschnelle!

**Beispiel-Projekt-Prompts:**
- "Erstelle eine Todo-App mit Benutzerauthentifizierung"
- "Erstelle ein Instagram mit Bild-Upload"

## Architektur

<div align="center">
  <img src="assets/archDiagram.png" alt="Architekturdiagramm">
  <br>
</div>

## Mitwirken

**Mitwirken**: Wenn Sie interessiert sind mitzuwirken, finden Sie unseren Leitfaden hier [CONTRIBUTING.md](CONTRIBUTING.md). Wir freuen uns sehr über Pull Requests, jede Art von Hilfe wird geschätzt!

**Unterstützung**: Wenn Sie Hilfe oder Unterstützung benötigen, sind wir in unserem [Discord-Kanal](https://discord.com/invite/MPxwj5xVvW) erreichbar, und Sie können uns auch gerne eine E-Mail an [info@insforge.dev](mailto:info@insforge.dev) schicken!

## Dokumentation & Unterstützung

### Dokumentation
- **[Offizielle Dokumentation](https://docs.insforge.dev/introduction)** - Umfassende Anleitungen und API-Referenzen

### Community
- **[Discord](https://discord.com/invite/MPxwj5xVvW)** - Treten Sie unserer lebendigen Community bei
- **[Twitter](https://x.com/InsForge_dev)** - Folgen Sie uns für Updates und Tipps

### Kontakt
- **E-Mail**: info@insforge.dev

## Lizenz

Dieses Projekt steht unter der Apache License 2.0 - siehe die [LICENSE](LICENSE) Datei für Details.

---

[![Stern-Historie-Diagramm](https://api.star-history.com/svg?repos=InsForge/insforge&type=Date)](https://www.star-history.com/#InsForge/insforge&Date)
