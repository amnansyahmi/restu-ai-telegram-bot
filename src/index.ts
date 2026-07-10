import "dotenv/config";
import express from "express";
import { webhookCallback } from "grammy";
import { askAI, createBot } from "./bot.js";
import { cycleTask, dueReminders, getProfile, markReminderSent, progress, saveChat, storageMode, tasksFor, updateProfile, vendors } from "./store.js";
import { telegramUser } from "./telegram-auth.js";

const token=process.env.TELEGRAM_BOT_TOKEN;
const publicUrl=(process.env.PUBLIC_URL?.trim()||process.env.RENDER_EXTERNAL_URL?.trim()||"http://localhost:3000").replace(/\/$/,"");
const port=Number(process.env.PORT??3000); if(!token) throw new Error("TELEGRAM_BOT_TOKEN is required.");
const botToken:string=token;
const app=express(),bot=createBot(botToken,publicUrl),useWebhook=publicUrl.startsWith("https://");
app.use(express.json({limit:"100kb"})); app.use(express.static("public"));
app.get("/health",(_req,res)=>res.json({ok:true,storage:storageMode()}));

function api(handler:(req:any,res:any,userId:number)=>Promise<any>){return async(req:any,res:any)=>{try{const userId=telegramUser(req,botToken);await handler(req,res,userId);}catch(error:any){res.status(error?.message?.includes("Telegram")?401:500).json({error:error?.message??"Unexpected error"});}};}
app.get("/api/dashboard",api(async(_req,res,userId)=>{const [profile,tasks,value,vendorList]=await Promise.all([getProfile(userId),tasksFor(userId),progress(userId),vendors()]);res.json({profile,tasks,progress:value,vendors:vendorList});}));
app.get("/api/tasks",api(async(_req,res,userId)=>res.json(await tasksFor(userId))));
app.post("/api/tasks/:taskId/cycle",api(async(req,res,userId)=>{const task=await cycleTask(userId,req.params.taskId);if(!task)return res.status(404).json({error:"Task not found"});res.json(task);}));
app.patch("/api/profile",api(async(req,res,userId)=>{const allowed=["partnerName","weddingDate","location","budget","guestCount","eventType","remindersEnabled"];const patch=Object.fromEntries(Object.entries(req.body??{}).filter(([key])=>allowed.includes(key)));res.json(await updateProfile(userId,patch));}));
app.get("/api/vendors",api(async(req,res)=>res.json(await vendors(typeof req.query.category==="string"?req.query.category:undefined))));
app.post("/api/chat",api(async(req,res,userId)=>{const question=String(req.body?.message??"").trim().slice(0,2000);if(!question)return res.status(400).json({error:"Message required"});await saveChat(userId,"user",question);const answer=await askAI(userId,question);await saveChat(userId,"assistant",answer);res.json({answer});}));

app.post("/internal/reminders",async(req,res)=>{if(!process.env.CRON_SECRET||req.header("authorization")!==`Bearer ${process.env.CRON_SECRET}`)return res.status(401).json({error:"Unauthorized"});const items=await dueReminders();let sent=0;for(const item of items){try{await bot.api.sendMessage(item.telegramId,`📅 Wedding task due\n\n${item.task.title}\n${item.task.dueDate??"Due now"}`,{reply_markup:{inline_keyboard:[[{text:"✅ Open checklist",callback_data:"checklist"}]]}});await markReminderSent(item.task.id);sent++;}catch(error){console.error("Reminder failed",error);}}res.json({ok:true,sent});});
if(useWebhook) app.use("/telegram/webhook",(req,res,next)=>{const secret=process.env.WEBHOOK_SECRET;if(secret&&req.header("x-telegram-bot-api-secret-token")!==secret)return res.sendStatus(401);next();},webhookCallback(bot,"express"));
app.listen(port,async()=>{console.log(`Restu bot listening on port ${port}`);console.log(`Storage: ${storageMode()}`);if(process.env.DISABLE_BOT_START==="true"){console.log("Bot transport disabled for UI testing");return;}console.log(`Bot transport: ${useWebhook?"webhook":"long polling"}`);if(useWebhook){await bot.api.setWebhook(`${publicUrl}/telegram/webhook`,{secret_token:process.env.WEBHOOK_SECRET});console.log("Telegram webhook configured");}else{await bot.api.deleteWebhook();bot.start({drop_pending_updates:true});}});
