# Restu.ai Telegram Bot MVP

An interactive Telegram bot and Telegram Mini App for Restu.ai. The MVP includes:

- `/start`, `/help`, and `/checklist` commands
- Inline checklist buttons inside Telegram chat
- Live progress bar and task completion
- Embedded visual Mini App
- Local polling for development and automatic webhook setup on Render
- Clear integration points for the Restu.ai database and AI service

## 1. Create the bot

In Telegram, open **@BotFather**:

1. Send `/newbot` and follow the instructions.
2. Copy the API token.
3. Send `/setmenubutton`, select the bot, and enter the deployed Mini App URL: `https://YOUR-SERVICE.onrender.com/app`.
4. Send `/setcommands` and paste:

```text
start - Open the Restu.ai menu
checklist - View and update the wedding checklist
help - Show instructions
```

## 2. Run locally

```bash
npm install
cp .env.example .env
```

Put the BotFather token in `.env`, then run:

```bash
npm run dev
```

The bot uses Telegram long polling locally. Preview the Mini App at `http://localhost:3000/app?userId=1`.

## 3. Deploy to Render

1. Push this folder to GitHub.
2. In Render, create a **Blueprint** and choose the repository. Render reads `render.yaml`.
3. Add `TELEGRAM_BOT_TOKEN` using the BotFather token.
4. Set `PUBLIC_URL` to the Render URL, for example `https://restu-telegram-bot.onrender.com`.
5. Deploy. The app automatically registers `PUBLIC_URL/telegram/webhook` with Telegram.

Never commit the real bot token.

## Current MVP limitation

Checklist data is stored in memory and resets when the server restarts. Replace `src/store.ts` with Restu.ai's database access before production. The **Ask Restu AI** button is currently a placeholder ready to connect to `ai-nonymauz-cloud` or the Restu.ai API.

## Recommended next integration

1. Link Telegram user IDs to existing Restu.ai accounts.
2. Replace the in-memory checklist with PostgreSQL/Firebase.
3. Connect normal text messages to the Restu.ai AI endpoint.
4. Add wedding-date collection and scheduled reminders.
5. Validate Telegram Mini App `initData` server-side before production.
