# Restu.ai Telegram Bot MVP

An interactive Telegram bot and Telegram Mini App for Restu.ai. It includes:

- `/start`, `/help`, and `/checklist` commands
- Inline checklist buttons inside Telegram chat
- Persistent onboarding, profile, countdown and four-state task tracking
- Full Mini App: Home, Plan, Ask Restu AI, Vendors, Budget and Profile
- Supabase/PostgreSQL schema with a memory fallback for demos
- Telegram Mini App signature validation and webhook secret validation
- AI chat history and OpenAI-compatible `ai-nonymauz-cloud` integration
- One-time collaborator invitation links and reminder dispatch endpoint
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
invite - Invite your partner or family
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

Never commit real bot, Supabase service-role, AI or cron secrets.

## 4. Enable persistent storage with Supabase

1. Create a Supabase project.
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, and run it once.
3. In Render, add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
4. Redeploy and open `/health`. It should report `"storage":"supabase"`.

The service-role key is server-only. Never expose it in browser code.

## 5. Connect Ask Restu AI

Set these Render variables:

```text
AI_NONYMAUZ_CLOUD_URL=https://your-ai-service.example.com
AI_NONYMAUZ_CLOUD_API_KEY=optional-secret
```

The service calls the OpenAI-compatible `/v1/chat/completions` endpoint and injects the user's wedding profile into the system context.

`RESTU_AI_URL` and `RESTU_AI_API_KEY` remain supported as aliases.

## Vendor shortlist and comparison

Users can save vendors and add up to three vendors to a persistent comparison. If Supabase was configured before this feature was added, rerun `supabase/schema.sql` once so the safe `compare_selected` migration is applied.

## 6. Reminders

Set long random values for `CRON_SECRET` and `WEBHOOK_SECRET`. Configure an external scheduler to POST daily to:

```text
https://YOUR-SERVICE.onrender.com/internal/reminders
Authorization: Bearer YOUR_CRON_SECRET
```

## Production notes

- `/invite` creates a one-time partner/family invitation link.
- Checklist data remains in memory only when Supabase variables are missing.
- Free Render services sleep after inactivity, so the first Telegram response can be delayed.
- Add real verified vendor data before presenting vendor results as production recommendations.

## Recommended next integration

1. Add document uploads through Supabase Storage.
2. Import verified vendor inventory and contact links.
3. Add payment/subscription entitlements.
4. Add RSVP and moodboard modules from the main Restu.ai roadmap.
