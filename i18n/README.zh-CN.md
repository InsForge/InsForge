<div align="center">
  <a href="https://insforge.dev">
    <img src="../assets/banner.png" alt="Insforge Logo">
  </a>
</div>

<p align="center">
   <a href="#快速开始">开始</a> · 
   <a href="https://docs.insforge.dev/introduction">文档</a> · 
   <a href="https://discord.com/invite/MPxwj5xVvW">Discord</a>
</p>
<p align="center">
   <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
   <a href="https://discord.com/invite/MPxwj5xVvW"><img src="https://img.shields.io/badge/Discord-Join%20Community-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
   <a href="https://github.com/InsForge/insforge/stargazers"><img src="https://img.shields.io/github/stars/InsForge/insforge?style=social" alt="GitHub Stars"></a>
</p>

# InsForge

**InsForge 是专为 AI 代理构建的（Agent-Native） Supabase 替代方案。** 我们以专为 AI 设计的架构实现 Supabase 的功能，使 AI 代理能够自主构建和管理全栈应用程序。
## 主要功能与用例

### 核心功能:
- **身份验证** - 完整的用户管理系统
- **数据库** - 灵活的数据存储和检索
- **存储** - 文件管理和组织
- **无服务器函数** - 可扩展的计算能力
- **站点部署** *(即将推出)* - 轻松部署应用程序

### 用例: 使用自然语言部署全栈应用程序
- **将 AI 编程代理接入 InsForge** - 启用 Claude、GPT或其他 AI 编程代理管理您的后端
- **为 Lovable 或 Bolt 风格的“氛围编程”项目添加后端** - 为 AI 生成的前端提供即时后端支持

## 提示词示例:

<td align="center">
  <img src="../assets/userflow.png" alt="userFlow">
  <br>
</td>

## 快速开始

### 1. 安装并运行 InsForge

**使用 Docker (推荐)**  
先决条件：[Docker](https://www.docker.com/) + [Node.js](https://nodejs.org/)

```bash
# Run with Docker
git clone https://github.com/insforge/insforge.git
cd insforge
cp .env.example .env
docker compose up
```

### 2. 接入 AI 编程助手

访问 InsForge 控制面板 (默认: http://localhost:7131)，登录，并按照"Connect"指南设置您的 MCP。

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="../assets/signin.png" alt="Sign In">
        <br>
        <em>登录 InsForge</em>
      </td>
      <td align="center">
        <img src="../assets/mcpInstallv2.png" alt="MCP Configuration">
        <br>
        <em>配置 MCP 连接</em>
      </td>
    </tr>
  </table>
</div>

### 3. 测试连接

在您的编程助手中，发送：
```
InsForge is my backend platform, what is my current backend structure?
```

<div align="center">
  <img src="../assets/sampleResponse.png" alt="Successful Connection Response" width="600">
  <br>
  <em>调用 insforge MCP 工具的成功响应示例</em>
</div>

### 4. 开始使用 InsForge

在新目录中开始构建你的项目！只需几秒钟，即可构建你的下一个待办事项应用、Instagram 克隆版或在线平台！

**示例项目提示:**
- "Build a todo app with user authentication"
- "Create an Instagram with image upload"

## 系统架构


<div align="center">
  <img src="../assets/archDiagram.png" alt="Architecture Diagram">
  <br>
</div>



## 贡献

**贡献**：如果您有兴趣参与贡献，可以查看我们的贡献指南 [CONTRIBUTING.md](../CONTRIBUTING.md)。我们非常欢迎 pull requests（PR），衷心感谢任何形式的帮助！

**支持**：如果您需要任何帮助，欢迎通过我们的 [Discord channel](https://discord.com/invite/MPxwj5xVvW) 联系我们，我们会及时回复；也欢迎随时给我们发送邮件至 [info@insforge.dev](mailto:info@insforge.dev) ！


## 文档与支持

### 文档
- **[Official Docs](https://docs.insforge.dev/introduction)** - 全面的指南与 API 参考

### 社区
- **[Discord](https://discord.com/invite/MPxwj5xVvW)** - 加入我们充满活力的社区
- **[Twitter](https://x.com/InsForge_dev)** - 关注更新与提示

### 联系我们
- **邮箱**: info@insforge.dev

## 许可证

该项目使用 Apache License 2.0 许可证 - 完整细节见 [LICENSE](../LICENSE) 文件.

---

[![Star History Chart](https://api.star-history.com/svg?repos=InsForge/insforge&type=Date)](https://www.star-history.com/#InsForge/insforge&Date)
