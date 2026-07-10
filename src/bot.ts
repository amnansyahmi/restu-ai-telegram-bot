import { Bot, InlineKeyboard } from "grammy";
import { acceptInvite, chatHistory, createInvite, cycleTask, getProfile, progress, saveChat, tasksFor, updateProfile, vendors } from "./store.js";

const statusIcon:any = { not_started:"⬜",in_progress:"🟨",completed:"✅",need_review:"🔎" };
function mainKeyboard(publicUrl:string) { return new InlineKeyboard().text("✅ Checklist","checklist").text("💍 Countdown","countdown").row().webApp("📱 Open Restu.ai",`${publicUrl}/app`).row().text("🤖 Ask Restu AI","ask").text("🏪 Vendors","vendors"); }
function roleKeyboard(){ return new InlineKeyboard().text("👰 Bride","role:bride").text("🤵 Groom","role:groom").row().text("👨‍👩‍👧 Family","role:family"); }
function categoryKeyboard(){ return new InlineKeyboard().text("🏛️ Venue","vendor:Venue").text("🍽️ Catering","vendor:Katering").row().text("📸 Photography","vendor:Fotografi").text("⬅️ Menu","menu"); }

async function checklistKeyboard(userId:number) { const keyboard=new InlineKeyboard(); for(const task of await tasksFor(userId)) keyboard.text(`${statusIcon[task.status]} ${task.title}`,`task:${task.id}`).row(); return keyboard.text("⬅️ Main menu","menu"); }
async function checklistText(userId:number) { const value=await progress(userId),filled=Math.round(value.percent/10); return `Wedding checklist\n\n${"🟩".repeat(filled)}${"⬜".repeat(10-filled)} ${value.percent}%\n${value.completed} of ${value.total} completed\n\nTap a task to change its status:\n⬜ Not started → 🟨 In progress → ✅ Completed → 🔎 Review`; }
function daysUntil(value?:string){ if(!value)return undefined; return Math.ceil((new Date(`${value}T00:00:00`).getTime()-Date.now())/86400000); }

export async function askAI(userId:number,question:string){
  const endpoint=process.env.RESTU_AI_URL?.trim(); if(!endpoint) return "Ask Restu AI is ready, but RESTU_AI_URL has not been configured yet.";
  const profile=await getProfile(userId), history=await chatHistory(userId);
  const context=`User wedding: date=${profile.weddingDate??"unknown"}, location=${profile.location??"unknown"}, budget=RM${profile.budget}, guests=${profile.guestCount}, event=${profile.eventType}.`;
  const url=endpoint.endsWith("/v1/chat/completions")?endpoint:`${endpoint.replace(/\/$/,"")}/v1/chat/completions`;
  const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",...(process.env.RESTU_AI_API_KEY?{"Authorization":`Bearer ${process.env.RESTU_AI_API_KEY}`}:{})},body:JSON.stringify({model:"restu-ai",messages:[{role:"system",content:`You are Restu, a concise Malaysian wedding planning assistant. ${context}`},...history.slice(-8),{role:"user",content:question}],temperature:.4})});
  if(!response.ok) throw new Error(`Restu AI returned ${response.status}`); const data:any=await response.json(); return data.choices?.[0]?.message?.content??"I could not generate an answer.";
}

async function continueOnboarding(ctx:any) {
  const userId=ctx.from.id, profile=await getProfile(userId,ctx.from.first_name);
  if(profile.onboardingStep==="complete") return false;
  if(profile.onboardingStep==="role") { await ctx.reply("Welcome to Restu.ai 💍\n\nFirst, who are you planning for?",{reply_markup:roleKeyboard()}); return true; }
  const text=ctx.message?.text?.trim(); if(!text) return true;
  if(profile.onboardingStep==="date") {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(new Date(text).getTime())) { await ctx.reply("Please enter the date as YYYY-MM-DD, for example 2027-12-14."); return true; }
    await updateProfile(userId,{weddingDate:text,onboardingStep:"location"}); await ctx.reply("Which city or area will the wedding be held in?\nExample: Shah Alam"); return true;
  }
  if(profile.onboardingStep==="location") { await updateProfile(userId,{location:text,onboardingStep:"budget"}); await ctx.reply("What is your estimated total budget in RM?\nExample: 30000"); return true; }
  if(profile.onboardingStep==="budget") { const amount=Number(text.replace(/[^0-9.]/g,"")); if(!amount){await ctx.reply("Enter a number such as 30000.");return true;} await updateProfile(userId,{budget:amount,onboardingStep:"guests"}); await ctx.reply("Approximately how many guests?\nExample: 500"); return true; }
  if(profile.onboardingStep==="guests") { const count=Number(text.replace(/\D/g,"")); if(!count){await ctx.reply("Enter a number such as 500.");return true;} await updateProfile(userId,{guestCount:count,onboardingStep:"complete"}); await ctx.reply("Your personalised wedding plan is ready ✨",{reply_markup:mainKeyboard(ctx.publicUrl)}); return true; }
  return false;
}

export function createBot(token:string,publicUrl:string){
  const bot=new Bot(token); bot.use(async(ctx,next)=>{(ctx as any).publicUrl=publicUrl;await next();});
  bot.command("start",async ctx=>{ if(!ctx.from)return;const payload=ctx.match?.trim();if(payload?.startsWith("invite_")){const accepted=await acceptInvite(ctx.from.id,payload.slice(7));await ctx.reply(accepted?"You have joined the shared wedding plan 💛":"This invitation is invalid or has already been used.");if(accepted){await ctx.reply("Open the shared plan:",{reply_markup:mainKeyboard(publicUrl)});return;}} const profile=await getProfile(ctx.from.id,ctx.from.first_name); if(profile.onboardingStep!=="complete"){await continueOnboarding(ctx);return;} await ctx.reply(`Welcome back, ${ctx.from.first_name}! 💍\n\nWhat would you like to plan today?`,{reply_markup:mainKeyboard(publicUrl)}); });
  bot.command("checklist",async ctx=>{if(!ctx.from)return;await ctx.reply(await checklistText(ctx.from.id),{reply_markup:await checklistKeyboard(ctx.from.id)});});
  bot.command("help",async ctx=>ctx.reply("Use /start for the menu, /checklist for tasks, or simply send any wedding question to Ask Restu AI."));
  bot.command("invite",async ctx=>{if(!ctx.from)return;const code=await createInvite(ctx.from.id);const me=await ctx.api.getMe();await ctx.reply(`Invite your partner or family with this one-time link:\n\nhttps://t.me/${me.username}?start=invite_${code}\n\nAnyone with this link can join your wedding plan, so share it privately.`);});
  bot.callbackQuery(/^role:(bride|groom|family)$/,async ctx=>{await updateProfile(ctx.from.id,{role:ctx.match[1] as any,onboardingStep:"date"});await ctx.answerCallbackQuery();await ctx.editMessageText("Great! What is the wedding date?\n\nEnter it as YYYY-MM-DD, for example 2027-12-14.");});
  bot.callbackQuery("menu",async ctx=>{await ctx.answerCallbackQuery();await ctx.editMessageText("What would you like to do?",{reply_markup:mainKeyboard(publicUrl)});});
  bot.callbackQuery("checklist",async ctx=>{await ctx.answerCallbackQuery();await ctx.editMessageText(await checklistText(ctx.from.id),{reply_markup:await checklistKeyboard(ctx.from.id)});});
  bot.callbackQuery(/^task:(.+)$/,async ctx=>{const task=await cycleTask(ctx.from.id,ctx.match[1]);await ctx.answerCallbackQuery(task?`${statusIcon[task.status]} ${task.title}`:"Task not found");await ctx.editMessageText(await checklistText(ctx.from.id),{reply_markup:await checklistKeyboard(ctx.from.id)});});
  bot.callbackQuery("countdown",async ctx=>{await ctx.answerCallbackQuery();const profile=await getProfile(ctx.from.id),days=daysUntil(profile.weddingDate);await ctx.reply(days===undefined?"Set your wedding date in the Mini App first.":days<0?"Your saved wedding date has passed. Update it in your profile.":`💍 ${days} days until your wedding\n📍 ${profile.location??"Location not set"}\n✅ ${(await progress(ctx.from.id)).percent}% wedding readiness`,{reply_markup:new InlineKeyboard().webApp("Open wedding plan",`${publicUrl}/app`)});});
  bot.callbackQuery("ask",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("Ask me any wedding question—for example:\n\n“Berapa bajet katering untuk 500 pax di Shah Alam?”");});
  bot.callbackQuery("vendors",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("Choose a vendor category:",{reply_markup:categoryKeyboard()});});
  bot.callbackQuery(/^vendor:(.+)$/,async ctx=>{await ctx.answerCallbackQuery();const list=await vendors(ctx.match[1]);const body=list.length?list.map(v=>`⭐ ${v.completionScore} · ${v.name}\nFrom RM${v.priceFrom} · ${v.location}`).join("\n\n"):"No vendors found yet.";await ctx.reply(body,{reply_markup:new InlineKeyboard().webApp("Compare in Restu.ai",`${publicUrl}/app#vendors`)});});
  bot.on("message:text",async ctx=>{if(await continueOnboarding(ctx))return;const question=ctx.message.text;if(question.startsWith("/"))return;await ctx.replyWithChatAction("typing");try{await saveChat(ctx.from.id,"user",question);const answer=await askAI(ctx.from.id,question);await saveChat(ctx.from.id,"assistant",answer);await ctx.reply(answer,{reply_markup:new InlineKeyboard().text("✅ Open checklist","checklist").webApp("📱 Open Restu.ai",`${publicUrl}/app`)});}catch(error){console.error("AI error",error);await ctx.reply("Restu AI is temporarily unavailable. Your question has been saved—please try again shortly.");}});
  bot.catch(error=>console.error("Telegram bot error:",error.error)); return bot;
}
