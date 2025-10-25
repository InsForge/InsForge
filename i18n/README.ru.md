<div align="center">
  <a href="https://insforge.dev">
    <img src="../assets/banner.png" alt="Insforge Logo">
  </a>
</div>
<p align="center">
   <a href="#quickstart-tldr">Начать работу</a> · 
   <a href="https://docs.insforge.dev/introduction">Документация</a> · 
   <a href="https://discord.gg/MPxwj5xVvW">Discord</a>
</p>
<p align="center">
   <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
   <a href="https://discord.gg/MPxwj5xVvW"><img src="https://img.shields.io/badge/Discord-Join%20Community-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
   <a href="https://github.com/InsForge/insforge/stargazers"><img src="https://img.shields.io/github/stars/InsForge/insforge?style=social" alt="GitHub Stars"></a>
</p>

# InsForge

**InsForge — это агентно-ориентированная альтернатива Supabase.** Мы создаём функциональность Supabase с использованием AI-нативного подхода, позволяя AI-агентам автономно создавать и управлять полнофункциональными приложениями.

## Ключевые возможности и варианты использования

### Основные возможности:
- **Аутентификация** — полная система управления пользователями
- **База данных** — гибкое хранение и получение данных
- **Хранилище** — управление и организация файлов
- **Бессерверные функции** — масштабируемые вычислительные мощности
- **Развёртывание сайтов** *(скоро)* — простое развёртывание приложений

### Варианты использования: создание полнофункциональных приложений с помощью естественного языка
- **Подключайте AI-агентов к InsForge** — позвольте Claude, GPT или другим AI-агентам управлять вашим бэкендом

## Примеры промптов:

<td align="center">
  <img src="../assets/userflow.png" alt="userFlow">
  <br>
</td>

## Быстрый старт TLDR;

### 1. Установите и запустите InsForge

**Используйте Docker (рекомендуется)**  
Требования: [Docker](https://www.docker.com/) + [Node.js](https://nodejs.org/)

```bash
# Запуск с Docker
git clone https://github.com/insforge/insforge.git
cd insforge
cp .env.example .env
docker compose up
```

### 2. Подключите AI-агента

Перейдите на панель управления InsForge (по умолчанию: http://localhost:7131), войдите в систему, следуйте руководству «Подключение» и настройте свой MCP.

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="../assets/signin.png" alt="Sign In">
        <br>
        <em>Войдите в InsForge</em>
      </td>
      <td align="center">
        <img src="../assets/mcpInstallv2.png" alt="MCP Configuration">
        <br>
        <em>Настройте подключение MCP</em>
      </td>
    </tr>
  </table>
</div>

### 3. Проверьте подключение

В вашем агенте отправьте:
```
InsForge — моя бэкенд-платформа, какова моя текущая структура бэкенда?
```

<div align="center">
  <img src="../assets/sampleResponse.png" alt="Successful Connection Response" width="600">
  <br>
  <em>Пример успешного ответа при вызове инструментов InsForge MCP</em>
</div>

### 4. Начните использовать InsForge

Начните создавать свой проект в новой директории! Создайте своё следующее приложение для задач, клон Instagram или онлайн-платформу за считанные секунды!

**Примеры промптов для проектов:**
- "Создай приложение для задач с аутентификацией пользователей"
- "Создай Instagram с загрузкой изображений"

## Архитектура

<div align="center">
  <img src="../assets/archDiagram.png" alt="Architecture Diagram">
  <br>
</div>

## Участие в проекте

**Участие**: Если вы заинтересованы во вкладе в проект, вы можете ознакомиться с нашим руководством здесь [CONTRIBUTING.md](CONTRIBUTING.md). Мы искренне ценим pull request'ы, любая помощь приветствуется!

**Поддержка**: Если вам нужна помощь или поддержка, мы отвечаем на нашем [Discord канале](https://discord.gg/MPxwj5xVvW), а также не стесняйтесь писать нам на [info@insforge.dev](mailto:info@insforge.dev)!

## Документация и поддержка

### Документация
- **[Официальная документация](https://docs.insforge.dev/introduction)** — исчерпывающие руководства и справочник по API

### Сообщество
- **[Discord](https://discord.gg/MPxwj5xVvW)** — присоединяйтесь к нашему активному сообществу
- **[Twitter](https://x.com/InsForge_dev)** — подписывайтесь для получения новостей и советов

### Контакты
- **Email**: [info@insforge.dev](mailto:info@insforge.dev)

## Лицензия

Этот проект лицензирован под Apache License 2.0 — подробности смотрите в файле [LICENSE](LICENSE).

---

[![Star History Chart](https://api.star-history.com/svg?repos=InsForge/insforge&type=Date)](https://www.star-history.com/#InsForge/insforge&Date)
