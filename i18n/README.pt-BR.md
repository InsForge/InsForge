<div align="center">
  <a href="https://insforge.dev">
    <img src="../assets/banner.png" alt="Insforge Logo">
  </a>
</div>

<p align="center">
  <a href="#quickstart-tldr">Começar</a> ·
  <a href="https://docs.insforge.dev/introduction">Documentação</a> ·
  <a href="https://discord.com/invite/MPxwj5xVvW">Discord</a>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="Licença"></a>
  <a href="https://discord.com/invite/MPxwj5xVvW"><img src="https://img.shields.io/badge/Discord-Entre%20na%20Comunidade-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/InsForge/insforge/stargazers"><img src="https://img.shields.io/github/stars/InsForge/insforge?style=social" alt="GitHub Stars"></a>
</p>

# InsForge

**InsForge é a Alternativa Supabase Nativa para Agentes.**
Estamos construindo os recursos do Supabase de forma nativa para IA, permitindo que agentes de IA criem e gerenciem aplicações full-stack de forma autônoma.

## Principais Recursos e Casos de Uso

### Recursos Principais:
- **Autenticação** - Sistema completo de gerenciamento de usuários  
- **Banco de Dados** - Armazenamento e recuperação de dados flexível  
- **Armazenamento** - Gerenciamento e organização de arquivos  
- **Funções Serverless** - Poder computacional escalável  
- **Implantação de Sites** *(em breve)* - Implantação fácil de aplicações  

### Casos de Uso:
Criação de aplicações full-stack usando linguagem natural  
- **Conecte agentes de IA ao InsForge**  
- Permita que Claude, GPT ou outros agentes de IA gerenciem seu backend  
- **Adicione backend a projetos no estilo Lovable ou Bolt**  
- Backend instantâneo para frontends gerados por IA  

## Exemplos de Prompt:

<td align="center">
  <img src="../assets/userflow.png" alt="userFlow">
  <br>
</td>

## Início Rápido (TLDR)

### 1. Instalar e executar o InsForge

**Usar Docker (Recomendado)**  
Pré-requisitos: [Docker](https://www.docker.com/) + [Node.js](https://nodejs.org/)

```bash
# Executar com Docker
git clone https://github.com/insforge/insforge.git
cd insforge
cp .env.example .env
docker compose up
```

### 2. Conectar um Agente de IA

Visite o painel do InsForge (padrão: http://localhost:7131), faça login e siga o guia “Connect”, configurando seu MCP.

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="../assets/signin.png" alt="Sign In">
        <br>
        <em>Entrar no InsForge</em>
      </td>
      <td align="center">
        <img src="../assets/mcpInstallv2.png" alt="MCP Configuration">
        <br>
        <em>Configurar conexão MCP</em>
      </td>
    </tr>
  </table>
</div>

### 3. Testar a Conexão

No seu agente, envie:
> InsForge é minha plataforma de backend, qual é a estrutura atual do meu backend?

<div align="center">
  <img src="../assets/sampleResponse.png" alt="Successful Connection Response" width="600">
  <br>
  <em>Exemplo de resposta bem-sucedida chamando ferramentas MCP do InsForge</em>
</div>

### 4. Começar a Usar o InsForge

Comece a construir seu projeto em um novo diretório!  
Crie seu próximo aplicativo de tarefas, clone do Instagram ou plataforma online em segundos!

**Exemplos de Prompts de Projeto:**
- "Crie um app de tarefas com autenticação de usuários"
- "Crie um Instagram com upload de imagens"

## Arquitetura

<div align="center">
  <img src="../assets/archDiagram.png" alt="Architecture Diagram">
  <br>
</div>

## Contribuindo

**Contribuições**: Se você tiver interesse em contribuir, confira nosso guia [CONTRIBUTING.md](CONTRIBUTING.md).  
Agradecemos muito pull requests — todo tipo de ajuda é bem-vinda!  

**Suporte**: Se precisar de ajuda, estamos disponíveis no nosso [canal do Discord](https://discord.com/invite/MPxwj5xVvW) ou envie um e-mail para [info@insforge.dev](mailto:info@insforge.dev)!

## Documentação e Suporte

### Documentação
- **[Documentação Oficial](https://docs.insforge.dev/introduction)** - Guias abrangentes e referências de API

### Comunidade
- **[Discord](https://discord.com/invite/MPxwj5xVvW)** - Junte-se à nossa comunidade vibrante
- **[Twitter](https://x.com/InsForge_dev)** - Siga para atualizações e dicas

### Contato
- **E-mail**: info@insforge.dev

## Licença

Este projeto está licenciado sob a Licença Apache 2.0 — veja o arquivo [LICENSE](LICENSE) para mais detalhes.
