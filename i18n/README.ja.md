<div align="center">
  <a href="https://insforge.dev">
    <img src="../assets/banner.png" alt="Insforge Logo">
  </a>
 
</div>
<p align="center">
   <a href="#quickstart-tldr">はじめに</a> ·
   <a href="https://docs.insforge.dev/introduction">ドキュメント</a> ·
   <a href="https://discord.gg/MPxwj5xVvW">Discord</a>
</p>
<p align="center">
   <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
   <a href="https://discord.gg/MPxwj5xVvW"><img src="https://img.shields.io/badge/Discord-Join%20Community-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
   <a href="https://github.com/InsForge/insforge/stargazers"><img src="https://img.shields.io/github/stars/InsForge/insforge?style=social" alt="GitHub Stars"></a>
</p>


# InsForge


**InsForgeはAgent-NativeなSupabaseの代替です。** 私たちはSupabaseの機能をAIネイティブな形で構築しており、AIエージェントがフルスタックアプリケーションを自律的に構築・管理できるようにしています。


## 主な機能と利用例


### コア機能：
- **Authentication** - 完全なユーザー管理システム
- **Database** - 柔軟なデータの保存と取得
- **Storage** - ファイル管理と整理
- **Serverless Functions** - スケーラブルなコンピューティングパワー
- **Site Deployment** *(近日公開予定)* - 簡単なアプリケーションのデプロイ


### 利用例：自然言語を使ったフルスタックアプリ構築
- **AIエージェントをInsForgeに接続** - Claude、GPTなどのAIエージェントがバックエンドを管理可能に
- **LovableやBoltスタイルのvibeコーディングプロジェクトにバックエンド追加** - AI生成のフロントエンド向け即時バックエンド


## プロンプト例：


<td align="center">
  <img src="../assets/userflow.png" alt="userFlow">
  <br>
</td>


## クイックスタート TLDR;


### 1. InsForgeをインストールして起動する


**Dockerの利用（推奨）**  
必要環境: [Docker](https://www.docker.com/) + [Node.js](https://nodejs.org/)


```bash
# Dockerで起動する
git clone https://github.com/insforge/insforge.git
cd insforge
cp .env.example .env
docker compose up
````


### 2. AIエージェントを接続する


InsForgeダッシュボード（デフォルト: [http://localhost:7131）にアクセスし、ログイン後、「Connect」ガイドに従ってMCPを設定してください。](http://localhost:7131）にアクセスし、ログイン後、「Connect」ガイドに従ってMCPを設定してください。)


<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="../assets/signin.png" alt="Sign In">
        <br>
        <em>InsForgeにサインイン</em>
      </td>
      <td align="center">
        <img src="../assets/mcpInstallv2.png" alt="MCP Configuration">
        <br>
        <em>MCP接続の設定</em>
      </td>
    </tr>
  </table>
</div>


### 3. 接続をテストする


エージェントに以下を送信してください：


```
InsForge is my backend platform, what is my current backend structure?
```


<div align="center">
  <img src="../assets/sampleResponse.png" alt="Successful Connection Response" width="600">
  <br>
  <em>insforge MCPツールを呼び出した成功例のレスポンス</em>
</div>


### 4. InsForgeの使用開始


新しいディレクトリでプロジェクトを作成し始めましょう！次のTodoアプリ、Instagramクローン、オンラインプラットフォームを数秒で構築できます！


**サンプルプロンプト：**


* 「ユーザー認証付きのTodoアプリを作って」
* 「画像アップロード機能付きのInstagramを作って」


## アーキテクチャ


<div align="center">
  <img src="../assets/archDiagram.png" alt="Architecture Diagram">
  <br>
</div>


## コントリビューション


**コントリビュートについて**: コントリビュートに興味がある方は、こちらのガイドをご覧ください [CONTRIBUTING.md](CONTRIBUTING.md)。プルリクエストは大歓迎です。あらゆるサポートに感謝します！


**サポート**: ご質問やサポートが必要な場合は、[Discordチャンネル](https://discord.gg/MPxwj5xVvW)で対応しています。また、メールでのお問い合わせも歓迎です：[info@insforge.dev](mailto:info@insforge.dev)


## ドキュメント & サポート


### ドキュメント


* **[公式ドキュメント](https://docs.insforge.dev/introduction)** - 詳細なガイドとAPIリファレンス


### コミュニティ


* **[Discord](https://discord.gg/D3Vf8zD2ZS)** - 活発なコミュニティに参加しよう
* **[Twitter](https://x.com/InsForge_dev)** - 最新情報やヒントをフォロー


### 連絡先


* **メール**: [info@insforge.dev](mailto:info@insforge.dev)


## ライセンス


本プロジェクトはApache License 2.0の下でライセンスされています。詳細は[LICENSE](LICENSE)ファイルをご覧ください。


---


[![Star History Chart](https://api.star-history.com/svg?repos=InsForge/insforge\&type=Date)](https://www.star-history.com/#InsForge/insforge&Date)

