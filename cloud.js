/* EMPIREON 87.30: anonymous database saves. Bundled inside the standalone HTML. */
(() => {
  'use strict';
  const project = 'https://fcuijevvmjvjsaajonyb.supabase.co';
  const publicKey = 'sb_publishable_inkAdkKhgFtS9bhH4mppzw_iaRHunj-';
  const sessionKey = 'empireon.cloud.session.v1';
  const table = '/rest/v1/saved_games';
  const message = (en, he) => typeof civiLanguage !== 'undefined' && civiLanguage === 'he' ? he : en;
  const changed = () => Error(message('The slot changed. Reopen the list before trying again.', 'תא השמירה השתנה. יש לפתוח את הרשימה מחדש.'));
  let sessionRequest;
  let invalidSession = false;

  function savedIdentity() {
    return JSON.parse(localStorage.getItem(sessionKey) || 'null');
  }
  async function request(path, {method='GET', body, token, prefer}={}) {
    const headers = {apikey:publicKey};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(project + path, {method, headers, cache:'no-store',
      body:body === undefined || typeof body === 'string' ? body : JSON.stringify(body), signal:AbortSignal.timeout(30000)});
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (!response.ok) {
      const error = Error(data?.error_code || data?.code || 'HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    if (raw && data === undefined) throw Error('Invalid database response');
    return data;
  }
  function identity() {
    if (sessionRequest) return sessionRequest;
    const establish = async () => {
      const old = savedIdentity();
      if (old?.access_token && old.expires_at > Date.now()/1000 + 60) return old;
      // Refuse to create an unreachable identity if the browser blocks token storage.
      if (!old) {
        localStorage.setItem(sessionKey + '.check', '1');
        localStorage.removeItem(sessionKey + '.check');
      }
      let result;
      try {
        result = old?.refresh_token
          ? await request('/auth/v1/token?grant_type=refresh_token', {method:'POST', body:{refresh_token:old.refresh_token}})
          : await request('/auth/v1/signup', {method:'POST', body:{data:{}}});
      } catch (error) {
        if (old?.refresh_token && [400,401,403].includes(error.status)) invalidSession = true;
        throw error;
      }
      if (!result?.access_token || !result.refresh_token || !result.user?.id) throw Error('Missing identity');
      const value = {access_token:result.access_token, refresh_token:result.refresh_token,
        expires_at:result.expires_at || Math.floor(Date.now()/1000)+(result.expires_in || 3600), user:{id:result.user.id}};
      localStorage.setItem(sessionKey, JSON.stringify(value));
      invalidSession = false;
      return value;
    };
    sessionRequest = (navigator.locks ? navigator.locks.request(sessionKey, establish) : establish())
      .finally(() => { sessionRequest = undefined; });
    return sessionRequest;
  }
  async function database(query, options) {
    const body = options?.body;
    const payload = body === undefined || typeof body === 'string' ? body : JSON.stringify(body);
    const session = await identity();
    return request(table + query, {...options, body:payload, token:session.access_token});
  }
  function describe(error) {
    if (invalidSession) return message('This player session has expired.', 'פג תוקף הזיהוי של השחקן.');
    if (error.message === '23505') return changed().message;
    if (error.status || error instanceof TypeError || error.name === 'TimeoutError') {
      return message('Cannot reach cloud saves. Try again in a moment.', 'השמירות בענן אינן זמינות כרגע. אפשר לנסות שוב בעוד רגע.');
    }
    return error.message;
  }
  function snapshot() {
    const data = makeSaveData();
    data.version = 25;
    data.gameHistory = gameHistory;
    data.historyEvents = historyEvents;
    return data;
  }
  function record(state, slot) {
    return {slot, name:String(state.saveName || 'EMPIREON').slice(0,200),
      turn_number:state.turnNumber ?? 1, game_version:'87.30', schema_version:1,
      revision:crypto.randomUUID(), state};
  }
  function validate(state) {
    const width=state?.MAP_WIDTH, height=state?.MAP_HEIGHT;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 ||
        !Array.isArray(state.map) || !Array.isArray(state.units) || !Array.isArray(state.cities) ||
        !(state.map.length===width && state.map.every(col=>Array.isArray(col) && col.length===height) ||
          state.map.length===width*height && !Array.isArray(state.map[0]))) {
      throw Error(message('Invalid save file.', 'מבנה השמירה אינו תקין.'));
    }
  }
  async function listSlots() {
    const columns='id,slot,revision,name,turn_number,created_at,saved_at:state->>savedAt,thumbnail:state->>saveThumbnail';
    return database('?select='+columns+'&slot=not.is.null&order=slot.asc');
  }
  async function writeSlot(slot, previous, state) {
    const row=record(state,slot);
    if (!previous) {
      await database('', {method:'POST',body:row,prefer:'return=minimal'});
      return;
    }
    const result=await database('?id=eq.'+previous.id+'&revision=eq.'+previous.revision+'&select=id',
      {method:'PATCH',body:row,prefer:'return=representation'});
    if (!result?.length) throw changed();
  }
  async function remove(row) {
    const result=await database('?id=eq.'+row.id+'&revision=eq.'+row.revision+'&select=id',
      {method:'DELETE',prefer:'return=representation'});
    if (!result?.length) throw changed();
  }

  let autoTimer, pending=false, queued, writing=false, failureReported=false;
  function scheduleAuto() {
    if (!gameStarted) return;
    pending=true;
    if (!autoTimer && !writing) autoTimer=setTimeout(flushAuto,3000);
  }
  async function flushAuto() {
    clearTimeout(autoTimer); autoTimer=undefined;
    try {
      if (pending && gameStarted) {
        // Freeze the outgoing game before a menu, load, or new game changes its state.
        queued=JSON.stringify(record(snapshot(),0));
        pending=false;
      }
    } catch (error) {
      if (!failureReported) showMsg(message('Autosave failed. ', 'השמירה האוטומטית נכשלה. ')+describe(error));
      failureReported=true;
      autoTimer=setTimeout(flushAuto,30000);
      return;
    }
    if (writing || !queued) return;
    writing=true;
    const payload=queued; queued=undefined;
    try {
      await database('?on_conflict=user_id,slot',{method:'POST',body:payload,prefer:'resolution=merge-duplicates,return=minimal'});
      failureReported=false;
    } catch (error) {
      queued=queued || payload;
      if (!failureReported) showMsg(message('Autosave failed. ', 'השמירה האוטומטית נכשלה. ')+describe(error));
      failureReported=true;
    } finally {
      writing=false;
      if (queued || pending && gameStarted) autoTimer=setTimeout(flushAuto,failureReported?30000:queued?0:3000);
    }
  }
  window.addEventListener('online',flushAuto);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden') void flushAuto();});

  let generation=0;
  function close() {
    generation++;
    document.getElementById('save-load-modal').classList.add('hidden');
  }
  function button(parent, label, action) {
    const b=document.createElement('button');
    b.type='button'; b.className='bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-xs font-bold';
    b.textContent=label; b.onclick=action; parent.appendChild(b);
    return b;
  }
  async function menu(mode) {
    const id=++generation;
    const modal=document.getElementById('save-load-modal'), list=document.getElementById('save-slot-list');
    const status=document.getElementById('save-load-subtitle'), saving=mode==='save';
    const current=()=>generation===id;
    modal.classList.remove('hidden'); list.replaceChildren();
    document.getElementById('save-load-title').textContent=saving?message('Save game','שמירת משחק'):message('Load game','טעינת משחק');
    status.textContent=message('Loading cloud saves…','טוען את השמירות מהענן…');
    let busy=false;
    async function act(operation) {
      if (busy || !current()) return;
      busy=true;
      status.textContent=message('Please wait…','רגע אחד…');
      try { await operation(); }
      catch(error) { if(current()) status.textContent=describe(error); }
      finally { busy=false; }
    }
    async function load(row) {
      if (gameStarted && !confirm(message('Replace the open game with this save?', 'להחליף את המשחק הפתוח בשמירה הזאת?'))) {status.textContent=''; return;}
      const rows=await database('?id=eq.'+row.id+'&select=state,schema_version');
      if (!current()) return;
      if (!rows?.length || rows[0].schema_version!==1) throw changed();
      validate(rows[0].state);
      applySaveData(rows[0].state);
      scheduleAuto();
      close(); playSound('load'); showMsg(message('Game loaded.', 'המשחק נטען.'));
    }
    function addRow(slot,row) {
      const line=document.createElement('div');
      line.className='save-slot-card bg-slate-800 border border-slate-700 rounded-xl p-3 flex items-center gap-3';
      if (row?.thumbnail?.startsWith('data:image/')) {
        const img=document.createElement('img'); img.src=row.thumbnail; img.alt=''; img.className='w-20 rounded'; line.appendChild(img);
      }
      const label=document.createElement('div'); label.className='flex-1 min-w-0';
      const title=slot===null?message('Previous save','שמירה קודמת'):slot===0?message('Autosave','שמירה אוטומטית'):message('Slot ','תא ')+slot;
      label.textContent=title+(row?' · '+row.name:' · '+message('Empty','פנוי'));
      if (row) {
        const time=document.createElement('small'); time.className='block text-slate-400';
        time.textContent=new Date(row.saved_at||row.created_at).toLocaleString(); label.appendChild(time);
      }
      line.appendChild(label);
      if (saving) {
        button(line,message('Save','שמירה'),()=>act(async()=>{
          await writeSlot(slot,row,snapshot());
          if(current()) { close(); playSound('save'); showMsg(message('Saved to the cloud.', 'המשחק נשמר בענן.')); }
        }));
        if(row) button(line,'✕',()=>act(async()=>{
          if (!confirm(message('Delete this saved game?', 'למחוק את השמירה הזאת?'))) {status.textContent='';return;}
          await remove(row); if(current()) await menu(mode);
        }));
      } else if(row) button(line,message('Load','טעינה'),()=>act(()=>load(row)));
      list.appendChild(line);
    }
    async function previousPage(offset) {
      const rows=await database('?slot=is.null&select=id,revision,name,created_at,turn_number&order=created_at.desc,id.desc&limit=26&offset='+offset);
      if(!current()) return;
      for(const row of rows.slice(0,25)) addRow(null,row);
      if(rows.length>25) {
        const more=button(list,message('More saves','עוד שמירות'),()=>act(async()=>{await previousPage(offset+25);more.remove();}));
      }
    }
    try {
      const rows=await listSlots(); if(!current()) return;
      if(!saving && rows.some(r=>r.slot===0)) addRow(0,rows.find(r=>r.slot===0));
      for(let slot=1;slot<SAVE_SLOT_COUNT;slot++) addRow(slot,rows.find(r=>r.slot===slot));
      if(!saving) {
        await previousPage(0); if(!current()) return;
        const old=await legacySlots(); if(!current()) return;
        if(old.length) button(list,message('Import saves from the previous version','ייבוא שמירות מהגרסה הקודמת'),()=>act(async()=>{
          for(const {slot,state} of old) await importLegacy(slot,state);
          if(current()) await menu('load');
        }));
      }
      status.textContent=saving?message('Choose a cloud save slot.', 'בחר תא שמירה בענן.'):message('Choose a game to load.', 'בחר משחק לטעינה.');
    } catch(error) {
      if(!current()) return;
      status.textContent=describe(error);
      button(list,message('Retry','נסה שוב'),()=>menu(mode));
      if(invalidSession) button(list,message('Start a new anonymous player','יצירת שחקן אנונימי חדש'),()=>{
        if(!confirm(message('Start a separate player? Previous cloud saves stay with the old identity.', 'ליצור שחקן חדש? השמירות הקודמות שייכות לזהות הישנה.'))) return;
        localStorage.removeItem(sessionKey); invalidSession=false; menu(mode);
      });
    }
  }
  async function legacySlots() {
    const result=[];
    let db;
    try {
      if (window.indexedDB && (!indexedDB.databases || (await indexedDB.databases()).some(d=>d.name==='EMPIREON_Mobilization_Save_V8721'))) {
        db=await new Promise((resolve,reject)=>{
          const req=indexedDB.open('EMPIREON_Mobilization_Save_V8721');
          req.onupgradeneeded=()=>req.transaction.abort();
          req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
        });
      }
    } catch {}
    async function read(key) {
      if (!db?.objectStoreNames.contains('saves')) return null;
      return new Promise(resolve=>{
        const req=db.transaction('saves','readonly').objectStore('saves').get(key);
        req.onsuccess=()=>resolve(req.result); req.onerror=()=>resolve(null);
      });
    }
    try {
      for(let slot=0;slot<SAVE_SLOT_COUNT;slot++) {
        let state=await read(slot);
        if(!state) try {state=JSON.parse(localStorage.getItem(SAVE_PREFIX+slot)||(slot===0&&localStorage.getItem(LEGACY_SAVE_KEY))||'null');} catch {}
        if(!state) continue;
        if(slot===0) {
          const archive=await read('auto-history');
          if(archive?.worldSeed===state.worldSeed && archive?.turnNumber===state.turnNumber && archive?.playerCivKey===state.playerCivKey && Array.isArray(archive?.history) && archive.history.length>(state.gameHistory?.length||0)) {
            state.gameHistory=archive.history; state.historyEvents=archive.events||state.historyEvents;
          }
        }
        result.push({slot,state});
      }
    } finally { db?.close(); }
    return result;
  }
  async function importLegacy(slot,state) {
    validate(state);
    const user=(await identity()).user.id;
    const row=record(state,null);
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([user,slot,state])));
    const hex=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    row.id=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
    await database('?on_conflict=id',{method:'POST',body:row,prefer:'resolution=ignore-duplicates,return=minimal'});
  }
  window.empireonSaves={menu, close, scheduleAuto, flushAuto};
})();
