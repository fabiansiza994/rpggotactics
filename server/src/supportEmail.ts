import type { Env } from './db';
export interface SupportEmailMessage { from: string; to: string; subject: string; text: string }
export interface SupportEmailBinding { send(message: SupportEmailMessage): Promise<{messageId: string}> }
const RETRYABLE = new Set(['E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED']);
const PERMANENT = new Set(['E_SENDER_NOT_VERIFIED','E_RECIPIENT_NOT_ALLOWED','E_RECIPIENT_SUPPRESSED','E_SENDER_DOMAIN_NOT_AVAILABLE','E_VALIDATION_ERROR','E_FIELD_MISSING']);
const LEASE_MS=120000;
const labels:Record<string,string>={STORE:'Tienda',PAYMENT:'Pagos',REFUND:'Reembolsos',PRIVACY:'Privacidad',ACCOUNT:'Cuenta',BATTLE:'Combate',PROGRESS:'Progreso',PVP:'PvP',CARDS:'Cartas',UI:'Interfaz',OTHER:'Otro'};
/** Never put user-authored text, email, description or transaction references in a notification. */
export function safeSupportMessage(row:{report_id:string;category:string;public_reason:string|null;created_at:number},from:string,to:string):SupportEmailMessage {
 const kind=row.public_reason?.split(':',1)[0] ?? row.category;
 const category=labels[kind] ?? labels[row.category] ?? 'Otro';
 const reason=kind==='PRIVACY'?'Solicitud de privacidad':kind==='REFUND'?'Solicitud de reembolso':kind==='PAYMENT'?'Incidencia de pago':'Nueva solicitud para revisión';
 return {from,to,subject:`[RPG GO Tactics] Nuevo ticket de soporte — ${category}`,text:[
  `Ticket: ${row.report_id}`,`Categoría: ${category}`,`Motivo (clasificación segura): ${reason}`,`Recibido: ${new Date(row.created_at).toISOString()}`,'Estado inicial: OPEN',
  'Consultar detalle con acceso administrativo a Cloudflare D1, tabla tactics_bug_reports, filtrando por el identificador de ticket. No existe un panel web público.',
  'El correo no incluye el contacto, la descripción ni datos de pago del solicitante. Primera atención: máximo dos días hábiles. Esta notificación no es una respuesta al jugador.',
 ].join('\n')};
}
function configured(env:Env){return env.SUPPORT_EMAIL_ENABLED==='1' && env.SUPPORT_EMAIL_PROVIDER==='CLOUDFLARE' && !!env.SUPPORT_EMAIL && /^[^\s@<>]+@rpg-go-tactics\.com$/.test(env.SUPPORT_EMAIL_FROM??'') && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(env.SUPPORT_EMAIL_TO??'');}
/** Bounded native sending. Accepted != delivered to inbox. Ambiguous outcomes never auto-retry. */
export async function dispatchSupportEmail(env:Env,now=Date.now(),reportId?:string):Promise<void>{
 if(!configured(env))return;
 // A worker interruption after sending cannot be safely retried without provider idempotency.
 await env.DB.prepare("UPDATE tactics_support_notifications SET status='UNCERTAIN',last_error='LEASE_EXPIRED',updated_at=? WHERE status='SENDING' AND claimed_at < ?").bind(now,now-LEASE_MS).run();
 const due=await env.DB.prepare(`SELECT report_id FROM tactics_support_notifications WHERE status IN ('PENDING','RETRY') AND attempts<3 AND next_attempt_at<=? ${reportId?'AND report_id=?':''} ORDER BY created_at LIMIT 10`).bind(now,...(reportId?[reportId]:[])).all<{report_id:string}>();
 for(const row of due.results){
  const claim=crypto.randomUUID();
  await env.DB.prepare("UPDATE tactics_support_notifications SET status='SENDING',claim_id=?,claimed_at=?,attempts=attempts+1,updated_at=? WHERE report_id=? AND status IN ('PENDING','RETRY') AND attempts<3 AND next_attempt_at<=?").bind(claim,now,now,row.report_id,now).run();
  const claimed=await env.DB.prepare('SELECT attempts FROM tactics_support_notifications WHERE report_id=? AND claim_id=? AND status=\'SENDING\'').bind(row.report_id,claim).first<{attempts:number}>();
  if(!claimed)continue;
  const ticket=await env.DB.prepare('SELECT report_id,category,public_reason,created_at FROM tactics_bug_reports WHERE report_id=?').bind(row.report_id).first<{report_id:string;category:string;public_reason:string|null;created_at:number}>();
  if(!ticket)continue;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let result:{messageId:string};
  try {
   result=await Promise.race([env.SUPPORT_EMAIL!.send(safeSupportMessage(ticket,env.SUPPORT_EMAIL_FROM!,env.SUPPORT_EMAIL_TO!)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('timeout'),{code:'TIMEOUT'})),5000);})]);
  }catch(error){
   const code=typeof error==='object' && error!==null && 'code' in error ? String(error.code) : 'UNKNOWN';
   const retry=RETRYABLE.has(code) && claimed.attempts<3;
   const status=retry?'RETRY':RETRYABLE.has(code)||PERMANENT.has(code)?'FAILED':'UNCERTAIN';
   await env.DB.prepare('UPDATE tactics_support_notifications SET status=?,last_error=?,next_attempt_at=?,updated_at=? WHERE report_id=? AND claim_id=?').bind(status,RETRYABLE.has(code)||PERMANENT.has(code)||code==='TIMEOUT'?code:'UNKNOWN',now+Math.min(3600000,60000*2**claimed.attempts),now,row.report_id,claim).run();
   continue;
  }finally{if(timer)clearTimeout(timer);}
  // If this write fails, leave SENDING; lease expiry becomes UNCERTAIN rather than duplicate mail.
  await env.DB.prepare("UPDATE tactics_support_notifications SET status='ACCEPTED',provider_message_id=?,accepted_at=?,last_error=NULL,updated_at=? WHERE report_id=? AND claim_id=?").bind(result.messageId.slice(0,200),now,now,row.report_id,claim).run();
 }
}
export function scheduleSupportEmail(env:Env,reportId:string,now:number,waitUntil?:(task:Promise<unknown>)=>void):Promise<void>{
 if(!configured(env))return Promise.resolve();
 const task=dispatchSupportEmail(env,now,reportId).catch(()=>{console.error('SUPPORT_EMAIL_DISPATCH_FAILED');});
 if(waitUntil){waitUntil(task);return Promise.resolve();}return task;
}
