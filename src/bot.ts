import { Bot, InlineKeyboard } from "grammy";
import { progress, tasksFor, toggleTask } from "./store.js";

function mainKeyboard(publicUrl: string) {
  return new InlineKeyboard()
    .text("✅ Quick Checklist", "checklist").row()
    .webApp("📱 Open Restu Mini App", `${publicUrl}/app`).row()
    .text("🤖 Ask Restu AI", "ask").text("💍 Countdown", "countdown");
}

function checklistKeyboard(userId: number) {
  const keyboard = new InlineKeyboard();
  for (const task of tasksFor(userId)) {
    keyboard.text(`${task.completed ? "✅" : "⬜"} ${task.title}`, `task:${task.id}`).row();
  }
  return keyboard.text("⬅️ Main menu", "menu");
}

function checklistText(userId: number) {
  const value = progress(userId);
  const filled = Math.round(value.percent / 10);
  return `Your wedding checklist\n\n${"🟩".repeat(filled)}${"⬜".repeat(10 - filled)} ${value.percent}%\n${value.completed} of ${value.total} tasks completed\n\nTap any task to update it:`;
}

export function createBot(token: string, publicUrl: string) {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      `Hi ${ctx.from?.first_name ?? "there"}! 💍\n\nI'm Restu, your interactive wedding-planning assistant. What would you like to do?`,
      { reply_markup: mainKeyboard(publicUrl) }
    );
  });

  bot.command("checklist", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await ctx.reply(checklistText(userId), { reply_markup: checklistKeyboard(userId) });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply("Use /start for the interactive menu or /checklist to update tasks directly in Telegram.");
  });

  bot.callbackQuery("menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("What would you like to do?", { reply_markup: mainKeyboard(publicUrl) });
  });

  bot.callbackQuery("checklist", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(checklistText(ctx.from.id), { reply_markup: checklistKeyboard(ctx.from.id) });
  });

  bot.callbackQuery(/^task:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const task = toggleTask(ctx.from.id, taskId);
    await ctx.answerCallbackQuery(task ? `${task.completed ? "Completed" : "Reopened"}: ${task.title}` : "Task not found");
    await ctx.editMessageText(checklistText(ctx.from.id), { reply_markup: checklistKeyboard(ctx.from.id) });
  });

  bot.callbackQuery("ask", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Send me your wedding question. The Restu.ai connection is the next integration step.");
  });

  bot.callbackQuery("countdown", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("💍 Wedding countdown setup will ask for your wedding date in the next version.");
  });

  bot.catch((error) => console.error("Telegram bot error:", error.error));
  return bot;
}
