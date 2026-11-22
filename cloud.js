/* EMPIREON cloud saves: no external SDK required. */
(() => {
'use strict';
const CONFIG='empireon.cloud.config.v1', SESSION='empireon.cloud.session.v1';
const read=k=>{try{return JSON.parse(localStorage.getItem(k)||'null')}catch{return null}};
const DEFAULT_CONFIG={url:'https://fcuijevvmjvjsaajonyb.supabase.co',key:'sb_publishable_inkAdkKhgFtS9bhH4mppzw_iaRHunj-'};
let config=read(CONFIG)||DEFAULT_CONFIG, session=read(SESSION), busy=false;
const el=(tag,text,parent)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(parent)parent.append(n);return n};
const panel=el('dialog');panel.id='empireon-cloud';panel.dir='rtl';
panel.style.cssText='background:#102d35;color:#fff;border:1px solid #bdab72;border-radius:16px;padding:24px;width:min(540px,94vw);max-height:90vh;overflow:auto;z-index:999999;font:15px system-ui';
document.body.append(panel);
const title=el('h2','EMPIREON — שמירות בענן',panel);
const close=el('button','סגירה',panel);close.onclick=()=>panel.close();
const status=el('p','',panel);status.setAttribute('role','status');
const fields=el('div','',panel);
function input(label,type='text',value='') {const l=el('label',label,fields);l.style.display='block';const i=el('input','',l);i.type=type;i.value=value;i.style.cssText='display:block;width:100%;padding:8px;margin:6px 0 12px;color:#111;background:#fff';return i;}
const url=input('כתובת פרויקט Supabase','url',config.url||'');
const key=input('מפתח ציבורי Publishable / anon','text',config.key||'');
const email=input('דואר אלקטרוני','email');const password=input('סיסמה','password');password.autocomplete='current-password';
const actions=el('div','',panel), list=el('div','',panel);
function button(text,fn){const b=el('button',text,actions);b.style.cssText='padding:8px;margin:5px;border:1px solid #9b9;border-radius:6px';b.onclick=()=>run(fn);return b;}
async function run(fn){if(busy)return;busy=true;actions.querySelectorAll('button').forEach(b=>b.disabled=true);try{status.textContent='מבצע…';await fn()}catch(e){status.textContent=e.message||'הפעולה נכשלה'}finally{busy=false;actions.querySelectorAll('button').forEach(b=>b.disabled=false)}}
function configure(){const u=new URL(url.value.trim());if(u.protocol!=='https:'||u.pathname!=='/'||u.username||u.password||u.search||u.hash)throw Error('נדרשת כתובת HTTPS בסיסית של הפרויקט');const k=key.value.trim();if(!k)throw Error('חסר מפתח ציבורי');if(k.startsWith('sb_secret_'))throw Error('יש להזין מפתח ציבורי בלבד');if(k.split('.').length===3){try{if(JSON.parse(atob(k.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='service_role')throw Error('מפתח ניהולי אסור בדפדפן')}catch(e){if(e.message.includes('ניהולי'))throw e}}
if(config.url!==u.origin||config.key!==k){session=null;localStorage.removeItem(SESSION)}config={url:u.origin,key:k};localStorage.setItem(CONFIG,JSON.stringify(config));}
async function request(path,{method='GET',body,token=false}={}){if(!config.url||!config.key)throw Error('יש לשמור תחילה הגדרות חיבור');if(token)await refresh();const headers={apikey:config.key,'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+session.access_token;const r=await fetch(config.url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});let data=null;const raw=await r.text();try{data=raw?JSON.parse(raw):null}catch{}if(!r.ok)throw Error(data?.msg||data?.message||data?.error_description||`שגיאת שרת ${r.status}`);return data;}
function remember(s){session={...s,expires_at:Math.floor(Date.now()/1000)+(s.expires_in||3600)};localStorage.setItem(SESSION,JSON.stringify(session));}
async function refresh(){if(!session?.refresh_token)throw Error('יש להתחבר לחשבון');if(session.expires_at>Date.now()/1000+60)return;const s=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});remember(s)}
button('שמירת הגדרות',async()=>{configure();status.textContent='ההגדרות נשמרו'});
button('הרשמה',async()=>{configure();const s=await request('/auth/v1/signup',{method:'POST',body:{email:email.value.trim(),password:password.value}});password.value='';if(s?.access_token){remember(s);await listing()}else status.textContent='בדוק בדואר האלקטרוני אם נדרש אישור הרשמה'});
button('התחברות',async()=>{configure();const s=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:email.value.trim(),password:password.value}});remember(s);password.value='';await listing()});
button('התנתקות',async()=>{try{if(session)await request('/auth/v1/logout',{method:'POST',token:true})}finally{session=null;localStorage.removeItem(SESSION);list.replaceChildren();status.textContent='החשבון נותק מהמכשיר'}});
button('רשימת שמירות',listing);
button('שמירת המשחק בענן',async()=>{
if(typeof gameStarted==='undefined'||!gameStarted)throw Error('יש להתחיל או לטעון משחק לפני שמירה');
await refresh();const data=makeSaveData();data.cloudSchemaVersion=1;
// Always create a snapshot: another computer cannot silently overwrite it.
const row={name:data.saveName||'EMPIREON',game_version:'87.29',schema_version:1,turn_number:data.turnNumber||1,state:data};
// Local checkpoint must succeed before any network write.
if(!saveToSlot(0,true))throw Error('השמירה המקומית נכשלה; פנה מקום או ייצא קובץ לפני שמירה בענן');
await request('/rest/v1/saved_games',{method:'POST',body:row,token:true});await listing();status.textContent='המשחק נשמר במחשב ובענן';
});
async function listing(){const rows=await request('/rest/v1/saved_games?select=id,name,turn_number,created_at&order=created_at.desc&limit=100',{token:true});list.replaceChildren();for(const row of rows){const line=el('div','',list);line.style.cssText='padding:12px;border-bottom:1px solid #577';el('span',`${row.name} — ${new Date(row.created_at).toLocaleString()}`,line);const b=el('button','טעינה',line);b.style.margin='8px';b.onclick=()=>run(async()=>{if(typeof gameStarted!=='undefined'&&gameStarted&&!confirm('לטעון את השמירה ולהחליף את המשחק הפתוח?'))return;const rows=await request('/rest/v1/saved_games?id=eq.'+encodeURIComponent(row.id)+'&select=state,schema_version',{token:true});const r=rows?.[0];if(!r||r.schema_version!==1)throw Error('גרסת השמירה אינה נתמכת');validate(r.state);if(typeof gameStarted!=='undefined'&&gameStarted&&!saveToSlot(0,true))throw Error('גיבוי המשחק הפתוח נכשל; הטעינה בוטלה');applySaveData(r.state);panel.close();showMsg('המשחק נטען מהענן');});}status.textContent=rows.length?`${rows.length} שמירות בחשבון`:'אין שמירות בענן עדיין'}
function validate(d){if(!d||!Number.isInteger(d.MAP_WIDTH)||!Number.isInteger(d.MAP_HEIGHT)||d.MAP_WIDTH<1||d.MAP_HEIGHT<1||!Array.isArray(d.map)||d.map.length!==d.MAP_WIDTH||!d.map.every(c=>Array.isArray(c)&&c.length===d.MAP_HEIGHT)||!Array.isArray(d.units)||!Array.isArray(d.cities))throw Error('מבנה שמירה לא תקין');}
const launch=el('button','☁ שמירות בענן',document.body);launch.id='empireon-cloud-open';launch.style.cssText='position:fixed;bottom:12px;left:12px;z-index:99999;background:#173d45;color:#fff;border:1px solid #baa66b;border-radius:8px;padding:10px;cursor:pointer';launch.onclick=()=>{panel.showModal();status.textContent=session?.user?.email?'מחובר: '+session.user.email:'התחבר כדי לשמור ולטעון בענן'};
})();
