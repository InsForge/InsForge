<div align="center">
  <a href="https://insforge.dev">
    <img src="../assets/banner.png" alt="Insforge Logo">
  </a>
  
</div>
<p align="center">
   <a href="#quickstart-tldr">Get Started</a> · 
   <a href="https://docs.insforge.dev/introduction">Documentation</a> · 
   <a href="https://discord.gg/MPxwj5xVvW">Discord</a>
</p>
<p align="center">
   <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
   <a href="https://discord.gg/MPxwj5xVvW"><img src="https://img.shields.io/badge/Discord-Join%20Community-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
   <a href="https://github.com/InsForge/insforge/stargazers"><img src="https://img.shields.io/github/stars/InsForge/insforge?style=social" alt="GitHub Stars"></a>
</p>

# InsForge

**InsForge는 에이전트 네이티브(Agent-Native) Supabase 대안입니다**. InsForge는 Supabase의 기능을 **AI Native 방식** 으로 구축하고 있으며, **AI Agent**가 자연스럽게 Full-stack Application을 구축하고 관리할 수 있도록 지원합니다.

## 핵심 기능 및 사용 사례

### 핵심 기능:

- **Authentication** - 완전한 사용자 관리 시스템
- **Database** - 유연한 데이터 저장 및 검색
- **Storage** - 파일 관리 및 구성
- **Serverless Functions** - 확장 가능한 컴퓨팅 환경
- **Site Deployment** _(출시예정)_ - 간편한 애플리케이션 배포

### 사용 사례: 자연어를 이용한 풀스택 애플리케이션 구축

- **AI 에이전트를 InsForge에 연결** - Claude, GPT 등 다양한 AI 에이전트가 백엔드를 관리할 수 있도록 지원
- **Lovable또는 Bolt 스타일의 생성형 프로젝트에 백엔드 통합하기** - AI가 생성한 프론트엔드에 즉시 연결되는 백엔드 제공

## 프롬프트 예시:

<td align="center">
  <img src="../assets/userflow.png" alt="userFlow">
  <br>
</td>

## 빠른 시작

### 1. InsForge 설치 및 실행

**Docker 사용 (권장)**  
필수 구성 요소: [Docker](https://www.docker.com/) + [Node.js](https://nodejs.org/)

```bash
# Run with Docker
git clone https://github.com/insforge/insforge.git
cd insforge
cp .env.example .env
docker compose up
```

### 2. AI Agent 연결

InsForge Dashboard (기본 주소: http://localhost:7131) 에 접속 후 로그인하고, "Connect" 가이드를 따라 MCP를 설정하세요.

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="../assets/signin.png" alt="Sign In">
        <br>
        <em>Sign in to InsForge</em>
      </td>
      <td align="center">
        <img src="../assets/mcpInstallv2.png" alt="MCP Configuration">
        <br>
        <em>Configure MCP connection</em>
      </td>
    </tr>
  </table>
</div>

### 3. 연결 테스트

에이전트에게 다음 메시지를 전송하세요:

```
InsForge is my backend platform, what is my current backend structure?
```

<div align="center">
  <img src="../assets/sampleResponse.png" alt="Successful Connection Response" width="600">
  <br>
  <em>Sample successful response calling insforge MCP tools</em>
</div>

### 4. InsForge 사용 시작

새로운 디렉토리에서 프로젝트 구축을 시작하세요! Todo 앱, Instagram 클론, 온라인 플랫폼 등 다양한 프로젝트를 몇 초 만에 생성할 수 있습니다.

**샘플 프로젝트 프롬프트:**

- "Build a todo app with user authentication"
- "Create an Instagram with image upload"

## 아키텍처

<div align="center">
  <img src="../assets/archDiagram.png" alt="Architecture Diagram">
  <br>
</div>

## 기여하기

**Contributing**: 기여에 관심이 있으신가요? [CONTRIBUTING.md](CONTRIBUTING.md) 가이드를 확인해주세요. Pull Request는 언제나 환영이며 어떤 형태의 도움도 감사히 받습니다!

**Support**: 도움이 필요하거나 지원이 필요하시다면, InsForge [Discord 채널](https://discord.gg/MPxwj5xVvW)에서 신속하게 응답해 드리고 있으며, [info@insforge.dev](mailto:info@insforge.dev)로 이메일을 보내주셔도 좋습니다!

## 문서 및 지원

### 문서

- **[공식 문서](https://docs.insforge.dev/introduction)** - 포괄적인 가이드 및 API 레퍼런스

### 커뮤니티

- **[Discord](https://discord.gg/D3Vf8zD2ZS)** - 활발한 커뮤니티에 참여하기
- **[Twitter](https://x.com/InsForge_dev)** - 최신 소식과 팁 확인하기

### 문의

- **Email**: info@insforge.dev

## 라이선스

이 프로젝트는 Apache License 2.0 하에 배포됩니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하십시오.

---

[![Star History Chart](https://api.star-history.com/svg?repos=InsForge/insforge&type=Date)](https://www.star-history.com/#InsForge/insforge&Date)