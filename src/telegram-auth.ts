import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export function telegramUser(req:Request, botToken:string):number {
  const initData=String(req.header("x-telegram-init-data")??"");
  if(!initData && process.env.NODE_ENV!=="production") {
    const value=Number(req.query.userId??req.body?.userId); if(Number.isSafeInteger(value)) return value;
  }
  if(!initData) throw new Error("Open this page inside Telegram.");
  const params=new URLSearchParams(initData),received=params.get("hash"); if(!received) throw new Error("Invalid Telegram signature.");
  params.delete("hash");
  const dataCheck=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secret=createHmac("sha256","WebAppData").update(botToken).digest();
  const expected=createHmac("sha256",secret).update(dataCheck).digest("hex");
  const a=Buffer.from(received,"hex"),b=Buffer.from(expected,"hex");
  if(a.length!==b.length||!timingSafeEqual(a,b)) throw new Error("Invalid Telegram signature.");
  const authDate=Number(params.get("auth_date")); if(!authDate||Date.now()/1000-authDate>86400) throw new Error("Telegram session expired. Reopen the Mini App.");
  const user=JSON.parse(params.get("user")??"{}"); if(!Number.isSafeInteger(user.id)) throw new Error("Telegram user missing."); return user.id;
}
