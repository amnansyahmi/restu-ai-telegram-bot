import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export type TaskStatus = "not_started" | "in_progress" | "completed" | "need_review";
export type Task = { id: string; title: string; category: string; status: TaskStatus; dueDate?: string };
export type Profile = {
  weddingId: string;
  telegramId: number;
  name?: string;
  role?: "bride" | "groom" | "family";
  partnerName?: string;
  weddingDate?: string;
  location?: string;
  budget: number;
  guestCount: number;
  eventType: string;
  onboardingStep: string;
  remindersEnabled: boolean;
};
export type Vendor = { id: string; name: string; category: string; location: string; priceFrom: number; completionScore: number; description?: string };
export type Guest = { id: string; name: string; rsvp: "pending" | "yes" | "no"; pax: number };

const starterTasks = [
  ["Tetapkan bajet perkahwinan", "Planning"], ["Sahkan tarikh perkahwinan", "Planning"],
  ["Sediakan senarai tetamu", "Guests"], ["Daftar kursus kahwin", "Documentation"],
  ["Tempah ujian HIV", "Documentation"], ["Senarai pendek tiga venue", "Venue"],
  ["Bandingkan pakej katering", "Vendors"], ["Tempah jurugambar", "Vendors"]
];
const seedVendors: Vendor[] = [
  { id:"v1", name:"Selera Kampung Catering", category:"Katering", location:"Shah Alam", priceFrom:28, completionScore:88 },
  { id:"v2", name:"Dapur Mak Long", category:"Katering", location:"Klang", priceFrom:25, completionScore:76 },
  { id:"v3", name:"Laman Seri Venue", category:"Venue", location:"Shah Alam", priceFrom:18000, completionScore:84 },
  { id:"v4", name:"Cerita Kita Studio", category:"Fotografi", location:"Selangor", priceFrom:3500, completionScore:82 }
];

function dbError(error: any): Error {
  const detail = error?.message || error?.details || error?.hint || error?.code || "unknown database error";
  const e = new Error(`Supabase: ${detail}${error?.code ? ` (${error.code})` : ""}`);
  (e as any).cause = error;
  return e;
}

// Normalise SUPABASE_URL to the bare project origin. Guards against a common
// misconfiguration where a trailing slash or the "/rest/v1" path is included,
// which makes PostgREST reject the request URL (PGRST125: invalid path).
const url = process.env.SUPABASE_URL?.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const db: SupabaseClient | undefined = url && key ? createClient(url, key, { auth: { persistSession:false } }) : undefined;
const profiles = new Map<number, Profile>();
const memoryTasks = new Map<number, Task[]>();
const memoryBudget = new Map<number, { category:string; allocated:number; spent:number }[]>();
const memoryGuests = new Map<number, Guest[]>();
const DEFAULT_ALLOC:[string,number][] = [["Food & Catering",.37],["Venue & Rental",.15],["Pelamin & Decoration",.10],["Photo & Video",.08],["Attire & Makeup",.11],["Gifts & PA System",.09],["Emergency Buffer",.10]];
const messages = new Map<number, { role:"user"|"assistant"; content:string }[]>();
const inviteOwners = new Map<string,number>();
const collaboratorOwners = new Map<number,number>();
const memorySaved = new Map<number,Map<string,boolean>>();

function mapProfile(row: any): Profile {
  return { weddingId:row.id, telegramId:Number(row.owner_telegram_id), name:row.owner_name ?? undefined,
    role:row.role ?? undefined, partnerName:row.partner_name ?? undefined, weddingDate:row.wedding_date ?? undefined,
    location:row.location ?? undefined, budget:Number(row.budget ?? 0), guestCount:row.guest_count ?? 0,
    eventType:row.event_type ?? "Nikah + Resepsi", onboardingStep:row.onboarding_step ?? "role",
    remindersEnabled:row.reminders_enabled ?? true };
}

async function seedTasks(weddingId: string) {
  if (!db) return;
  const { count } = await db.from("tasks").select("id", { count:"exact", head:true }).eq("wedding_id", weddingId);
  if (!count) await db.from("tasks").insert(starterTasks.map(([title,category]) => ({ wedding_id:weddingId,title,category })));
}

export function storageMode() { return db ? "supabase" : "memory"; }

export async function checkStorage(): Promise<{ mode: string; ok: boolean; error?: string }> {
  if (!db) return { mode: "memory", ok: true };
  try {
    const { error } = await db.from("weddings").select("id", { head: true, count: "exact" });
    if (error) return { mode: "supabase", ok: false, error: dbError(error).message };
    return { mode: "supabase", ok: true };
  } catch (error: any) {
    return { mode: "supabase", ok: false, error: error?.message ?? "connection failed" };
  }
}

export async function getProfile(telegramId: number, name?: string): Promise<Profile> {
  if (db) {
    let { data } = await db.from("weddings").select("*").eq("owner_telegram_id", telegramId).maybeSingle();
    if (!data) {
      const collaborator=await db.from("collaborators").select("wedding_id").eq("telegram_id",telegramId).not("accepted_at","is",null).maybeSingle();
      if(collaborator.data) data=(await db.from("weddings").select("*").eq("id",collaborator.data.wedding_id).single()).data;
    }
    if (!data) {
      const created = await db.from("weddings").insert({ owner_telegram_id:telegramId, owner_name:name }).select("*").single();
      if (created.error) throw dbError(created.error);
      data = created.data;
      await seedTasks(data.id);
    }
    return mapProfile(data);
  }
  const ownerId=collaboratorOwners.get(telegramId); if(ownerId)return getProfile(ownerId,name);
  if (!profiles.has(telegramId)) profiles.set(telegramId, { weddingId:randomUUID(),telegramId,name,budget:0,guestCount:0,eventType:"Nikah + Resepsi",onboardingStep:"role",remindersEnabled:true });
  return profiles.get(telegramId)!;
}

export async function updateProfile(telegramId: number, patch: Partial<Profile>): Promise<Profile> {
  const profile = await getProfile(telegramId);
  const updated = { ...profile, ...patch };
  if (db) {
    const fields:any = {};
    const mapping:any = { name:"owner_name",role:"role",partnerName:"partner_name",weddingDate:"wedding_date",location:"location",budget:"budget",guestCount:"guest_count",eventType:"event_type",onboardingStep:"onboarding_step",remindersEnabled:"reminders_enabled" };
    for (const [key,value] of Object.entries(patch)) if (mapping[key]) fields[mapping[key]] = value;
    fields.updated_at = new Date().toISOString();
    const { data,error } = await db.from("weddings").update(fields).eq("id",profile.weddingId).select("*").single();
    if (error) throw dbError(error);
    return mapProfile(data);
  }
  profiles.set(telegramId,updated); return updated;
}

export async function tasksFor(telegramId: number): Promise<Task[]> {
  const profile = await getProfile(telegramId);
  if (db) {
    await seedTasks(profile.weddingId);
    const { data,error } = await db.from("tasks").select("*").eq("wedding_id",profile.weddingId).order("created_at");
    if (error) throw dbError(error);
    return data.map((x:any) => ({ id:x.id,title:x.title,category:x.category,status:x.status,dueDate:x.due_date ?? undefined }));
  }
  if (!memoryTasks.has(telegramId)) memoryTasks.set(telegramId,starterTasks.map(([title,category]) => ({ id:randomUUID(),title,category,status:"not_started" })));
  return memoryTasks.get(telegramId)!;
}

export async function cycleTask(telegramId:number, taskId:string): Promise<Task|undefined> {
  const task = (await tasksFor(telegramId)).find(x => x.id === taskId); if (!task) return;
  const order:TaskStatus[] = ["not_started","in_progress","completed","need_review"];
  task.status = order[(order.indexOf(task.status)+1)%order.length];
  if (db) { const { error } = await db.from("tasks").update({status:task.status}).eq("id",taskId); if(error) throw dbError(error); }
  return task;
}

export async function setTaskDone(telegramId:number, taskId:string, done:boolean): Promise<Task|undefined> {
  const task = (await tasksFor(telegramId)).find(x => x.id === taskId); if (!task) return;
  task.status = done ? "completed" : "not_started";
  if (db) { const { error } = await db.from("tasks").update({status:task.status}).eq("id",taskId); if(error) throw dbError(error); }
  return task;
}

export async function addTask(telegramId:number, title:string, category:string): Promise<Task> {
  const clean = title.trim().slice(0,120) || "New task", cat = (category||"Planning").slice(0,40);
  if (db) {
    const profile = await getProfile(telegramId);
    const { data, error } = await db.from("tasks").insert({ wedding_id:profile.weddingId, title:clean, category:cat }).select("*").single();
    if (error) throw dbError(error);
    return { id:data.id, title:data.title, category:data.category, status:data.status, dueDate:data.due_date ?? undefined };
  }
  const tasks = await tasksFor(telegramId), task:Task = { id:randomUUID(), title:clean, category:cat, status:"not_started" };
  tasks.push(task); return task;
}

export async function progress(telegramId:number) { const tasks=await tasksFor(telegramId); const completed=tasks.filter(x=>x.status==="completed").length; return {completed,total:tasks.length,percent:tasks.length?Math.round(completed/tasks.length*100):0}; }

export type BudgetItem = { category:string; allocated:number; spent:number };
export async function budgetItems(telegramId:number):Promise<BudgetItem[]> {
  const profile=await getProfile(telegramId);
  const seed=()=>DEFAULT_ALLOC.map(([category,pc])=>({category,allocated:Math.round((profile.budget||0)*pc),spent:0}));
  if(!db){ if(!memoryBudget.has(telegramId)) memoryBudget.set(telegramId,seed()); return memoryBudget.get(telegramId)!; }
  const {data,error}=await db.from("budget_items").select("category,allocated,spent").eq("wedding_id",profile.weddingId);
  if(error) throw dbError(error);
  if(!data||!data.length){ const rows=seed(); const ins=await db.from("budget_items").insert(rows.map(r=>({wedding_id:profile.weddingId,...r}))); if(ins.error) throw dbError(ins.error); return rows; }
  return data.map((x:any)=>({category:x.category,allocated:Number(x.allocated),spent:Number(x.spent)}));
}
export async function setBudgetItem(telegramId:number, category:string, patch:{allocated?:number;spent?:number}):Promise<BudgetItem> {
  const profile=await getProfile(telegramId);
  if(!db){ const items=memoryBudget.get(telegramId)??[]; let it=items.find(x=>x.category===category); if(!it){it={category,allocated:0,spent:0};items.push(it);} if(patch.allocated!=null)it.allocated=patch.allocated; if(patch.spent!=null)it.spent=patch.spent; memoryBudget.set(telegramId,items); return it; }
  const fields:any={wedding_id:profile.weddingId,category}; if(patch.allocated!=null)fields.allocated=patch.allocated; if(patch.spent!=null)fields.spent=patch.spent;
  const {data,error}=await db.from("budget_items").upsert(fields,{onConflict:"wedding_id,category"}).select("category,allocated,spent").single(); if(error) throw dbError(error);
  return {category:data.category,allocated:Number(data.allocated),spent:Number(data.spent)};
}

export async function guests(telegramId:number):Promise<Guest[]> {
  if(!db) return memoryGuests.get(telegramId)??[];
  const profile=await getProfile(telegramId);
  const {data,error}=await db.from("guests").select("id,name,rsvp,pax").eq("wedding_id",profile.weddingId).order("created_at");
  if(error) throw dbError(error);
  return data.map((x:any)=>({id:x.id,name:x.name,rsvp:x.rsvp,pax:Number(x.pax)||1}));
}
export async function addGuest(telegramId:number, name:string, pax=1):Promise<Guest> {
  const clean=name.trim().slice(0,80)||"Guest", p=Math.max(1,Math.min(50,Math.round(pax)||1));
  if(!db){ const list=memoryGuests.get(telegramId)??[]; const g:Guest={id:randomUUID(),name:clean,rsvp:"pending",pax:p}; list.push(g); memoryGuests.set(telegramId,list); return g; }
  const profile=await getProfile(telegramId);
  const {data,error}=await db.from("guests").insert({wedding_id:profile.weddingId,name:clean,pax:p}).select("id,name,rsvp,pax").single();
  if(error) throw dbError(error); return {id:data.id,name:data.name,rsvp:data.rsvp,pax:Number(data.pax)||1};
}
export async function setGuestRsvp(telegramId:number, guestId:string, rsvp:Guest["rsvp"]):Promise<Guest|undefined> {
  if(!db){ const g=(memoryGuests.get(telegramId)??[]).find(x=>x.id===guestId); if(!g)return; g.rsvp=rsvp; return g; }
  const profile=await getProfile(telegramId);
  const {data,error}=await db.from("guests").update({rsvp}).eq("wedding_id",profile.weddingId).eq("id",guestId).select("id,name,rsvp,pax").maybeSingle();
  if(error) throw dbError(error); return data?{id:data.id,name:data.name,rsvp:data.rsvp,pax:Number(data.pax)||1}:undefined;
}
export async function removeGuest(telegramId:number, guestId:string):Promise<void> {
  if(!db){ memoryGuests.set(telegramId,(memoryGuests.get(telegramId)??[]).filter(x=>x.id!==guestId)); return; }
  const profile=await getProfile(telegramId);
  const {error}=await db.from("guests").delete().eq("wedding_id",profile.weddingId).eq("id",guestId); if(error) throw dbError(error);
}

export async function vendors(category?:string):Promise<Vendor[]> {
  if (!db) return category ? seedVendors.filter(x=>x.category===category) : seedVendors;
  let query=db.from("vendors").select("*").eq("active",true).order("completion_score",{ascending:false});
  if(category) query=query.eq("category",category);
  const {data,error}=await query; if(error) throw dbError(error);
  return data.map((x:any)=>({id:x.id,name:x.name,category:x.category,location:x.location,priceFrom:Number(x.price_from),completionScore:x.completion_score,description:x.description}));
}

export async function vendorState(telegramId:number) {
  const list=await vendors(),profile=await getProfile(telegramId);
  if(!db){const state=memorySaved.get(telegramId)??new Map();return list.map(v=>({...v,saved:state.has(v.id),compareSelected:state.get(v.id)===true}));}
  let rows=await db.from("saved_vendors").select("vendor_id,compare_selected").eq("wedding_id",profile.weddingId);
  if(rows.error){ // Older database without the compare_selected column: degrade gracefully so the dashboard still loads.
    const basic=await db.from("saved_vendors").select("vendor_id").eq("wedding_id",profile.weddingId);
    if(basic.error) throw dbError(rows.error);
    rows={data:(basic.data??[]).map((x:any)=>({vendor_id:x.vendor_id,compare_selected:false})),error:null} as any;
  }
  const state=new Map((rows.data??[]).map((x:any)=>[x.vendor_id,x.compare_selected]));return list.map(v=>({...v,saved:state.has(v.id),compareSelected:state.get(v.id)===true}));
}

export async function toggleSavedVendor(telegramId:number,vendorId:string) {
  const profile=await getProfile(telegramId);
  if(!db){const state=memorySaved.get(telegramId)??new Map();if(state.has(vendorId))state.delete(vendorId);else state.set(vendorId,false);memorySaved.set(telegramId,state);return state.has(vendorId);}
  const current=await db.from("saved_vendors").select("vendor_id").eq("wedding_id",profile.weddingId).eq("vendor_id",vendorId).maybeSingle();
  if(current.data){const {error}=await db.from("saved_vendors").delete().eq("wedding_id",profile.weddingId).eq("vendor_id",vendorId);if(error)throw dbError(error);return false;}
  const {error}=await db.from("saved_vendors").insert({wedding_id:profile.weddingId,vendor_id:vendorId});if(error)throw dbError(error);return true;
}

export async function toggleCompareVendor(telegramId:number,vendorId:string) {
  const profile=await getProfile(telegramId);
  if(!db){const state=memorySaved.get(telegramId)??new Map();const next=state.get(vendorId)!==true;if(next&&[...state.values()].filter(Boolean).length>=3)throw new Error("You can compare up to 3 vendors.");state.set(vendorId,next);memorySaved.set(telegramId,state);return next;}
  const selected=await db.from("saved_vendors").select("vendor_id").eq("wedding_id",profile.weddingId).eq("compare_selected",true);
  const current=await db.from("saved_vendors").select("compare_selected").eq("wedding_id",profile.weddingId).eq("vendor_id",vendorId).maybeSingle();const next=current.data?.compare_selected!==true;
  if(next&&(selected.data?.length??0)>=3)throw new Error("You can compare up to 3 vendors.");
  const {error}=await db.from("saved_vendors").upsert({wedding_id:profile.weddingId,vendor_id:vendorId,compare_selected:next},{onConflict:"wedding_id,vendor_id"});if(error)throw dbError(error);return next;
}

export async function saveChat(telegramId:number, role:"user"|"assistant", content:string) {
  const profile=await getProfile(telegramId);
  if(db) { const {error}=await db.from("chat_messages").insert({wedding_id:profile.weddingId,role,content}); if(error) throw dbError(error); return; }
  const history=messages.get(telegramId)??[]; history.push({role,content}); messages.set(telegramId,history.slice(-20));
}

export async function chatHistory(telegramId:number) {
  const profile=await getProfile(telegramId);
  if(!db) return messages.get(telegramId)??[];
  const {data,error}=await db.from("chat_messages").select("role,content").eq("wedding_id",profile.weddingId).order("created_at",{ascending:true}).limit(20);
  if(error) throw dbError(error); return data as {role:"user"|"assistant";content:string}[];
}

export async function createInvite(telegramId:number) {
  const profile=await getProfile(telegramId),code=randomUUID().replaceAll("-","").slice(0,12);
  if(db){const {error}=await db.from("collaborators").insert({wedding_id:profile.weddingId,invite_code:code});if(error)throw dbError(error);}else inviteOwners.set(code,telegramId);
  return code;
}

export async function acceptInvite(telegramId:number,code:string) {
  if(db){const {data,error}=await db.from("collaborators").update({telegram_id:telegramId,accepted_at:new Date().toISOString()}).eq("invite_code",code).is("telegram_id",null).select("wedding_id").maybeSingle();if(error)throw dbError(error);return Boolean(data);}
  const owner=inviteOwners.get(code);if(!owner)return false;collaboratorOwners.set(telegramId,owner);inviteOwners.delete(code);return true;
}

export async function allWeddings():Promise<{telegramId:number;weddingDate?:string;name?:string;partnerName?:string}[]> {
  if(!db) return [...profiles.values()].filter(p=>p.remindersEnabled).map(p=>({telegramId:p.telegramId,weddingDate:p.weddingDate,name:p.name,partnerName:p.partnerName}));
  const {data,error}=await db.from("weddings").select("owner_telegram_id,wedding_date,owner_name,partner_name,reminders_enabled");
  if(error) throw dbError(error);
  return (data??[]).filter((x:any)=>x.reminders_enabled!==false).map((x:any)=>({telegramId:Number(x.owner_telegram_id),weddingDate:x.wedding_date??undefined,name:x.owner_name??undefined,partnerName:x.partner_name??undefined}));
}

export async function dueReminders() {
  if(!db)return [] as {telegramId:number;task:Task}[];
  const today=new Date().toISOString().slice(0,10);
  const {data,error}=await db.from("tasks").select("*,weddings!inner(owner_telegram_id,reminders_enabled)").lte("due_date",today).neq("status","completed").is("reminder_sent_at",null);
  if(error)throw dbError(error);
  return (data??[]).filter((x:any)=>x.weddings.reminders_enabled).map((x:any)=>({telegramId:Number(x.assigned_telegram_id??x.weddings.owner_telegram_id),task:{id:x.id,title:x.title,category:x.category,status:x.status,dueDate:x.due_date}}));
}

export async function markReminderSent(taskId:string){if(db){const {error}=await db.from("tasks").update({reminder_sent_at:new Date().toISOString()}).eq("id",taskId);if(error)throw dbError(error);}}
