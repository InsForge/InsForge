<div align="center">
  <a href="https://insforge.dev">
    <img src="assets/banner.png" alt="Insforge ロゴ">
  </a>
</div>
<p align="center">
   <a href="#quickstart-tldr">はじめに</a> · 
   <a href="https://docs.insforge.dev/introduction">ドキュメント</a> · 
   <a href="https://discord.com/invite/MPxwj5xVvW">Discord</a>
</p>
<p align="center">
   <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="ライセンス"></a>
   <a href="https://discord.com/invite/MPxwj5xVvW"><img src="https://img.shields.io/badge/Discord-コミュニティに参加-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
   <a href="https://github.com/InsForge/insforge/stargazers"><img src="https://img.shields.io/github/stars/InsForge/insforge?style=social" alt="GitHub スター"></a>
</p>

# InsForge

**InsForge は Agent-Native な Supabase の代替です。**  
私たちは Supabase の機能を AI ネイティブな方法で構築しており、AI エージェントが自律的にフルスタックアプリケーションを構築・管理できるようにします。

## 主な特徴とユースケース

### コア機能:
- **認証 (Authentication)** - 完全なユーザー管理システム  
- **データベース (Database)** - 柔軟なデータの保存と取得  
- **ストレージ (Storage)** - ファイルの管理と整理  
- **サーバーレス関数 (Serverless Functions)** - スケーラブルな計算能力  
- **サイトデプロイ (Site Deployment)** *(近日公開)* - 簡単なアプリケーションデプロイ  

### ユースケース: 自然言語でフルスタックアプリケーションを構築
- **AI エージェントを InsForge に接続** - Claude、GPT などの AI エージェントがバックエンドを管理可能  
- **Lovable や Bolt スタイルのプロジェクトにバックエンドを追加** - AI 生成フロントエンドに即座にバックエンドを追加  

## プロンプト例:

<td align="center">
  <img src="assets/userflow.png" alt="ユーザーフロー">
  <br>
</td>

## クイックスタート TLDR;

### 1. InsForge をインストールして実行

**Docker を使用 (推奨)**  
前提条件: [Docker](https://www.docker.com/) + [Node.js](https://nodejs.org/)

```bash
# Dockerで実行
git clone https://github.com/insforge/insforge.git
cd insforge
cp .env.example .env
docker compose up
```

### 2. AI エージェントを接続

InsForge ダッシュボード (デフォルト: http://localhost:7131) にアクセスし、ログイン後、「Connect」ガイドに従って MCP を設定します。

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="assets/signin.png" alt="サインイン">
        <br>
        <em>InsForge にサインイン</em>
      </td>
      <td align="center">
        <img src="assets/mcpInstallv2.png" alt="MCP 設定">
        <br>
        <em>MCP 接続の設定</em>
      </td>
    </tr>
  </table>
</div>

### 3. 接続をテスト

あなたのエージェントで次のように送信します:
```
InsForge is my backend platform, what is my current backend structure?
```

<div align="center">
  <img src="assets/sampleResponse.png" alt="接続成功のサンプル応答" width="600">
  <br>
  <em>InsForge MCP ツールを呼び出す成功応答の例</em>
</div>

### 4. InsForge を使用開始

新しいディレクトリでプロジェクトを構築しましょう！Todo アプリ、Instagram クローン、またはオンラインプラットフォームを数秒で構築できます！

**サンプルプロジェクトプロンプト:**
- "Build a todo app with user authentication"
- "Create an Instagram with image upload"

## アーキテクチャ

<div align="center">
  <img src="assets/archDiagram.png" alt="アーキテクチャ図">
  <br>
</div>

## 貢献について

**貢献**: 貢献に興味がある方は [CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。プルリクエストを心から歓迎します。どんな形のサポートも感謝します！

**サポート**: サポートが必要な場合は、[Discord チャンネル](https://discord.com/invite/MPxwj5xVvW) またはメール [info@insforge.dev](mailto:info@insforge.dev) までお気軽にご連絡ください。

## ドキュメントとサポート

### ドキュメント
- **[公式ドキュメント](https://docs.insforge.dev/introduction)** - 詳細なガイドと API 参照

### コミュニティ
- **[Discord](https://discord.com/invite/MPxwj5xVvW)** - 活発なコミュニティに参加  
- **[Twitter](https://x.com/InsForge_dev)** - 最新情報とヒントをチェック

### 連絡先
- **メール**: info@insforge.dev

## ライセンス

このプロジェクトは Apache License 2.0 の下でライセンスされています。詳細は [LICENSE](LICENSE) ファイルをご確認ください。

---

[![Star History Chart](https://api.star-history.com/svg?repos=InsForge/insforge&type=Date)](https://www.star-history.com/#InsForge/insforge&Date)
