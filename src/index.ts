import "dotenv/config";
import express from "express";
import { webhookCallback } from "grammy";
import { createBot } from "./bot.js";
import { tasksFor, toggleTask } from "./store.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const publicUrl = (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
const port = Number(process.env.PORT ?? 3000);

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required. Copy .env.example to .env.");

const app = express();
const bot = createBot(token, publicUrl);
const useWebhook = publicUrl.startsWith("https://");
app.use(express.json());
app.use(express.static("public"));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/tasks", (req, res) => {
  const userId = Number(req.query.userId);
  if (!Number.isSafeInteger(userId)) return res.status(400).json({ error: "Valid userId required" });
  res.json(tasksFor(userId));
});

app.post("/api/tasks/:taskId/toggle", (req, res) => {
  const userId = Number(req.body.userId);
  if (!Number.isSafeInteger(userId)) return res.status(400).json({ error: "Valid userId required" });
  const task = toggleTask(userId, req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task);
});

// grammY allows either webhook mode or long polling, never both. Registering
// webhookCallback marks the bot as webhook-driven, so only install it when an
// HTTPS public URL is configured.
if (useWebhook) {
  app.use("/telegram/webhook", webhookCallback(bot, "express"));
}

app.listen(port, async () => {
  console.log(`Restu bot listening on port ${port}`);
  if (useWebhook) {
    await bot.api.setWebhook(`${publicUrl}/telegram/webhook`);
    console.log("Telegram webhook configured");
  } else {
    await bot.api.deleteWebhook();
    bot.start({ drop_pending_updates: true });
    console.log("Telegram long polling started for local development");
  }
});
