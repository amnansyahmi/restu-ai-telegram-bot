import { Bot, InlineKeyboard } from "grammy";
import { acceptInvite, chatHistory, createInvite, cycleTask, getProfile, progress, saveChat, tasksFor, vendors } from "./store.js";

const statusIcon:any = { not_started:"○",in_progress:"◐",completed:"●",need_review:"◎" };
const CAPABILITIES = "• Checklist & progress tracking\n• Budget planner\n• Vendor discovery & comparison\n• Countdown to the big day\n• Ask Restu — instant answers, anytime";
const errText = (e:any) => typeof e==="string" ? e : (e?.message || JSON.stringify(e).slice(0,200));
// Parse an OpenAI-compatible completion body that may be JSON or a Server-Sent-Events stream.
function parseCompletion(raw:string):{content?:string;error?:string}{
  const trimmed=(raw||"").trim(); if(!trimmed) return {};
  if(trimmed.startsWith("data:")){ let content="",error:string|undefined;
    for(const line of trimmed.split("\n")){ const l=line.trim(); if(!l.startsWith("data:"))continue; const p=l.slice(5).trim(); if(p==="[DONE]")continue; let j:any; try{j=JSON.parse(p);}catch{continue;} if(j?.error)error=errText(j.error); content+=j?.choices?.[0]?.delta?.content||j?.choices?.[0]?.message?.content||""; }
    return error?{error}:{content};
  }
  try{ const j:any=JSON.parse(trimmed); if(j?.error)return{error:errText(j.error)}; return {content:j?.choices?.[0]?.message?.content}; }catch{ return {error:`Non-JSON response: ${trimmed.slice(0,200)}`}; }
}
function mainKeyboard(publicUrl:string) { return new InlineKeyboard()
  .webApp("Open Restu.ai Dashboard",`${publicUrl}/app`).row()
  .text("Ask Restu","ask").text("Today’s Plan","checklist").row()
  .text("Invite Partner","invite"); }
function categoryKeyboard(){ return new InlineKeyboard().text("Venue","vendor:Venue").text("Catering","vendor:Katering").row().text("Photography","vendor:Fotografi").text("← Menu","menu"); }

async function checklistKeyboard(userId:number) { const keyboard=new InlineKeyboard(); for(const task of await tasksFor(userId)) keyboard.text(`${statusIcon[task.status]} ${task.title}`,`task:${task.id}`).row(); return keyboard.text("← Main menu","menu"); }
async function checklistText(userId:number) { const value=await progress(userId),filled=Math.round(value.percent/10); return `Wedding checklist\n\n${"▰".repeat(filled)}${"▱".repeat(10-filled)} ${value.percent}%\n${value.completed} of ${value.total} completed\n\nTap a task to change its status:\n○ Not started → ◐ In progress → ● Completed → ◎ Review`; }
function daysUntil(value?:string){ if(!value)return undefined; return Math.ceil((new Date(`${value}T00:00:00`).getTime()-Date.now())/86400000); }

export async function askAI(userId:number,question:string){
  // Reuse the SSE-aware streaming path so both bot chat and Mini App handle the
  // same response shapes (JSON or event-stream) and surface upstream errors.
  let full=""; for await(const token of askAIStream(userId,question)) full+=token;
  return full.trim() || "I could not generate an answer.";
}

export async function checkAI(){
  const endpoint=(process.env.AI_NONYMAUZ_CLOUD_URL||process.env.RESTU_AI_URL)?.trim();
  if(!endpoint) return { configured:false, ok:false, error:"AI service URL not configured (AI_NONYMAUZ_CLOUD_URL)" };
  const apiKey=process.env.AI_NONYMAUZ_CLOUD_API_KEY||process.env.RESTU_AI_API_KEY;
  const model=(process.env.AI_NONYMAUZ_CLOUD_MODEL||process.env.RESTU_AI_MODEL)?.trim()||"restu-ai";
  const url=endpoint.endsWith("/v1/chat/completions")?endpoint:`${endpoint.replace(/\/$/,"")}/v1/chat/completions`;
  try{
    const response=await fetch(url,{method:"POST",signal:AbortSignal.timeout(15000),headers:{"Content-Type":"application/json",...(apiKey?{"Authorization":`Bearer ${apiKey}`}:{})},body:JSON.stringify({model,messages:[{role:"user",content:"ping"}],max_tokens:5})});
    const raw=await response.text().catch(()=>"");
    if(!response.ok) return { configured:true, ok:false, model, url, error:`HTTP ${response.status}${raw?`: ${raw.slice(0,200)}`:""}` };
    const parsed=parseCompletion(raw);
    if(parsed.error) return { configured:true, ok:false, model, url, error:parsed.error };
    return parsed.content ? { configured:true, ok:true, model, url } : { configured:true, ok:false, model, url, error:`200 OK but empty content: ${raw.slice(0,200)}` };
  }catch(error:any){ return { configured:true, ok:false, model, url, error:error?.message??"request failed" }; }
}

export async function* askAIStream(userId:number,question:string):AsyncGenerator<string>{
  const endpoint=(process.env.AI_NONYMAUZ_CLOUD_URL||process.env.RESTU_AI_URL)?.trim(); if(!endpoint){ yield "Ask Restu AI is ready, but the AI service URL has not been configured yet."; return; }
  const apiKey=process.env.AI_NONYMAUZ_CLOUD_API_KEY||process.env.RESTU_AI_API_KEY;
  const model=(process.env.AI_NONYMAUZ_CLOUD_MODEL||process.env.RESTU_AI_MODEL)?.trim()||"restu-ai";
  const profile=await getProfile(userId), history=await chatHistory(userId);
  const context=`User wedding: date=${profile.weddingDate??"unknown"}, location=${profile.location??"unknown"}, budget=RM${profile.budget}, guests=${profile.guestCount}, event=${profile.eventType}.`;
  const url=endpoint.endsWith("/v1/chat/completions")?endpoint:`${endpoint.replace(/\/$/,"")}/v1/chat/completions`;
  const response=await fetch(url,{method:"POST",signal:AbortSignal.timeout(60000),headers:{"Content-Type":"application/json",...(apiKey?{"Authorization":`Bearer ${apiKey}`}:{})},body:JSON.stringify({model,stream:true,messages:[{role:"system",content:`You are Restu, a concise Malaysian wedding planning assistant. ${context}`},...history.slice(-8),{role:"user",content:question}],temperature:.4})});
  if(!response.ok){const detail=await response.text().catch(()=>""); throw new Error(`Restu AI returned ${response.status}${detail?`: ${detail.slice(0,200)}`:""}`);}
  // Fall back to a single JSON payload if the service ignored stream:true.
  if(!response.headers.get("content-type")?.includes("text/event-stream")){const raw=await response.text().catch(()=>""); const parsed=parseCompletion(raw); if(parsed.error) throw new Error(`Restu AI error: ${parsed.error}`); if(parsed.content){yield parsed.content;}else{console.error("Restu AI returned no content (non-stream):",raw.slice(0,400));} return;}
  const reader=response.body?.getReader(); if(!reader){ console.error("Restu AI stream returned no body"); return; }
  const decoder=new TextDecoder(); let buffer="";
  while(true){ const {done,value}=await reader.read(); if(done)break; buffer+=decoder.decode(value,{stream:true});
    let nl:number; while((nl=buffer.indexOf("\n"))>=0){ const line=buffer.slice(0,nl).trim(); buffer=buffer.slice(nl+1);
      if(!line.startsWith("data:"))continue; const payload=line.slice(5).trim(); if(payload==="[DONE]")return;
      let parsed:any; try{ parsed=JSON.parse(payload); }catch{ continue; }
      if(parsed?.error) throw new Error(`Restu AI error: ${errText(parsed.error)}`);
      const token=parsed?.choices?.[0]?.delta?.content; if(token) yield token; } }
}

export function createBot(token:string,publicUrl:string){
  const bot=new Bot(token); bot.use(async(ctx,next)=>{(ctx as any).publicUrl=publicUrl;await next();});
  bot.command("start",async ctx=>{ if(!ctx.from)return;const payload=ctx.match?.trim();if(payload?.startsWith("invite_")){const accepted=await acceptInvite(ctx.from.id,payload.slice(7));await ctx.reply(accepted?"You have joined the shared wedding plan.":"This invitation is invalid or has already been used.");if(accepted){await ctx.reply("Open the shared plan:",{reply_markup:mainKeyboard(publicUrl)});return;}} await getProfile(ctx.from.id,ctx.from.first_name); await ctx.reply(`Hi ${ctx.from.first_name}, welcome to Restu.ai — your personal wedding planner.\n\nHere's what I can help with:\n\n${CAPABILITIES}\n\nTap Open Restu.ai Dashboard below to set up your wedding and get started. You can also ask me anything, anytime.`,{reply_markup:mainKeyboard(publicUrl)}); });
  bot.command("menu",async ctx=>{if(!ctx.from)return;await ctx.reply("What would you like to do?",{reply_markup:mainKeyboard(publicUrl)});});
  bot.command("checklist",async ctx=>{if(!ctx.from)return;await ctx.reply(await checklistText(ctx.from.id),{reply_markup:await checklistKeyboard(ctx.from.id)});});
  bot.command("help",async ctx=>ctx.reply(`What Restu can do for you:\n\n${CAPABILITIES}\n\nTap the Dashboard button next to the message box to open Restu.ai anytime, or just send me any wedding question.`,{reply_markup:mainKeyboard(publicUrl)}));
  bot.command("invite",async ctx=>{if(!ctx.from)return;const code=await createInvite(ctx.from.id);const me=await ctx.api.getMe();await ctx.reply(`Invite your partner or family with this one-time link:\n\nhttps://t.me/${me.username}?start=invite_${code}\n\nAnyone with this link can join your wedding plan, so share it privately.`);});
  bot.callbackQuery("menu",async ctx=>{await ctx.answerCallbackQuery();await ctx.editMessageText("What would you like to do?",{reply_markup:mainKeyboard(publicUrl)});});
  bot.callbackQuery("checklist",async ctx=>{await ctx.answerCallbackQuery();await ctx.editMessageText(await checklistText(ctx.from.id),{reply_markup:await checklistKeyboard(ctx.from.id)});});
  bot.callbackQuery(/^task:(.+)$/,async ctx=>{const task=await cycleTask(ctx.from.id,ctx.match[1]);await ctx.answerCallbackQuery(task?`${statusIcon[task.status]} ${task.title}`:"Task not found");await ctx.editMessageText(await checklistText(ctx.from.id),{reply_markup:await checklistKeyboard(ctx.from.id)});});
  bot.callbackQuery("countdown",async ctx=>{await ctx.answerCallbackQuery();const profile=await getProfile(ctx.from.id),days=daysUntil(profile.weddingDate);await ctx.reply(days===undefined?"Set your wedding date in the Mini App first.":days<0?"Your saved wedding date has passed. Update it in your profile.":`${days} days until your wedding\n${profile.location??"Location not set"}\n${(await progress(ctx.from.id)).percent}% wedding readiness`,{reply_markup:new InlineKeyboard().webApp("Open wedding plan",`${publicUrl}/app`)});});
  bot.callbackQuery("ask",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("Ask me any wedding question—for example:\n\n“Berapa bajet katering untuk 500 pax di Shah Alam?”");});
  bot.callbackQuery("budget",async ctx=>{await ctx.answerCallbackQuery();const p=await getProfile(ctx.from.id);const perGuest=p.guestCount?Math.round(p.budget/p.guestCount):0;await ctx.reply(`Your wedding budget\n\nTotal: RM${p.budget.toLocaleString("en-MY")}\nGuests: ${p.guestCount.toLocaleString("en-MY")}\nAverage: RM${perGuest.toLocaleString("en-MY")} per guest\nEmergency buffer: RM${Math.round(p.budget*.1).toLocaleString("en-MY")}`,{reply_markup:new InlineKeyboard().webApp("Open Budget Planner",`${publicUrl}/app#budget`)});});
  bot.callbackQuery("invite",async ctx=>{await ctx.answerCallbackQuery();const code=await createInvite(ctx.from.id),me=await ctx.api.getMe();await ctx.reply(`Plan together\n\nShare this one-time link privately with your partner or family:\nhttps://t.me/${me.username}?start=invite_${code}`);});
  bot.callbackQuery("vendors",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("Choose a vendor category:",{reply_markup:categoryKeyboard()});});
  bot.callbackQuery(/^vendor:(.+)$/,async ctx=>{await ctx.answerCallbackQuery();const list=await vendors(ctx.match[1]);const body=list.length?list.map(v=>`${v.completionScore} · ${v.name}\nFrom RM${v.priceFrom} · ${v.location}`).join("\n\n"):"No vendors found yet.";await ctx.reply(body,{reply_markup:new InlineKeyboard().webApp("Compare in Restu.ai",`${publicUrl}/app#vendors`)});});
  bot.on("message:text",async ctx=>{const question=ctx.message.text;if(question.startsWith("/"))return;await ctx.replyWithChatAction("typing");try{await saveChat(ctx.from.id,"user",question);const answer=await askAI(ctx.from.id,question);await saveChat(ctx.from.id,"assistant",answer);await ctx.reply(answer,{reply_markup:new InlineKeyboard().text("Open checklist","checklist").webApp("Open Restu.ai",`${publicUrl}/app`)});}catch(error){console.error("AI error",error);await ctx.reply("Restu AI is temporarily unavailable. Your question has been saved—please try again shortly.");}});
  bot.catch(async err=>{const e=err.error as any;console.error("Telegram bot error:",e?.stack||e?.message||JSON.stringify(e));try{await err.ctx?.reply("Something went wrong on our side. Please try again in a moment.");}catch(replyError){console.error("Failed to send error reply:",replyError);}}); return bot;
}
