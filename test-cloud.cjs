/* Run alongside the release with: node test-cloud.cjs. No external services. */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const page=fs.readFileSync(path.join(__dirname,'EMPIREON_v87_44_Map_Rendering.html'),'utf8');
const code=fs.readFileSync(path.join(__dirname,'cloud.js'),'utf8');
const version=page.match(/const CIVI_VERSION='([^']+)'/)[1];
assert(page.includes('<script>\n'+code+'\n</script>'));
assert(!page.includes('function saveToSlot(') && !page.includes('function civiDbWrite('));
assert(!page.includes('empireon-cloud-open') && !page.includes('grant_type=password'));
for (const script of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(script[1]);

class Element {
  constructor(tag) {this.tag=tag;this.children=[];this.textContent='';this.classList={add:()=>{this.hidden=true},remove:()=>{this.hidden=false}};}
  appendChild(n) {this.children.push(n); n.parent=this;return n;}
  remove() {this.parent.children=this.parent.children.filter(n=>n!==this);}
  replaceChildren() {this.children=[];}
  buttons() {return this.children.flatMap(n=>[...(n.tag==='button'?[n]:[]),...n.buttons()]);}
}
const ids=Object.fromEntries(['save-slot-list','save-load-title','save-load-modal','save-load-subtitle'].map(n=>[n,new Element('div')]));
const store=new Map(), localWrites=[], seen=[], rows=new Map(), messages=[], reports=[];
const prefix='empireon_mobilization_save_slot_';
const state={MAP_WIDTH:1,MAP_HEIGHT:1,map:[[{col:0,row:0,terrain:0,hasRoad:true,hasRiver:false,resource:null}]],units:[],cities:[],saveName:'Test',worldSeed:42,turnNumber:8,savedAt:new Date().toISOString()};
const history=[{turn:1,map:[[{terrain:0,improvement:null,road:true,oilPipeline:false}]]},{turn:2,map:null}];
let auth=0, offline=false, loaded, delayNextAuto, autoWaiting, rejectAutosave=false;
let nextManualTimeout, snapshots=0;
const browserEvents=new Map();
const timeoutError=()=>Object.assign(Error('Request elapsed'),{name:'TimeoutError'});
const context={
  window:{addEventListener:(name,f)=>browserEvents.set(name,f)}, document:{getElementById:k=>ids[k],createElement:tag=>new Element(tag),addEventListener:(name,f)=>browserEvents.set(name,f)},
  navigator:{},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>{localWrites.push(k);store.set(k,v)},removeItem:k=>store.delete(k)},
  crypto:webcrypto,AbortSignal,URL,Date,TextEncoder,TypeError,console,
  CompressionStream,DecompressionStream,Blob,Response,btoa,atob,
  setTimeout:()=>1,clearTimeout(){},gameStarted:true,civiLanguage:'en',CIVI_VERSION:version, SAVE_SLOT_COUNT:6,SAVE_PREFIX:prefix,LEGACY_SAVE_KEY:'legacy',
  makeSaveData:()=>{snapshots++; return structuredClone(state)},applySaveData:d=>{loaded=d},gameHistory:history,historyEvents:['started'],
  confirm:()=>true,playSound(){},showMsg:t=>messages.push(t),
  fetch:async(url,opts)=>{
    const u=new URL(url),body=opts.body?JSON.parse(opts.body):null,q=u.searchParams;
    seen.push({u,opts,body});
    if(offline)throw new TypeError('offline');
    const reply=(data,status=200)=>({ok:status<300,status,text:async()=>data==null?'':JSON.stringify(data)});
    if(u.pathname==='/auth/v1/signup'){auth++;assert.deepEqual(body,{data:{}});return reply({user:{id:'aa'},access_token:'jwt',refresh_token:'refresh',expires_in:3600});}
    assert.equal(opts.headers.Authorization,'Bearer jwt');
    if(u.pathname==='/rest/v1/bug_reports'){
      assert.equal(opts.method,'POST');
      assert.equal(u.search,'');
      assert.equal(opts.headers.Prefer,'return=minimal');
      reports.push(body);
      return reply(null,201);
    }
    assert.equal(u.pathname,'/rest/v1/saved_games');
    const rowid=(q.get('id')||'').replace('eq.',''),current=rows.get(rowid);
    if(opts.method==='GET'){
      if(rowid) return reply(current?[current]:[]);
      if(q.get('slot')?.startsWith('eq.')) return reply([...rows.values()].filter(r=>r.slot===Number(q.get('slot').slice(3))));
      return reply([...rows.values()].filter(r=>(q.get('slot')==='is.null')===(r.slot===null)));
    }
    const fault=body?.slot>0?nextManualTimeout:null;
    if(fault) nextManualTimeout=null;
    if(fault==='before-write') throw timeoutError();
    if(fault==='concurrent-write'){
      rows.set(rowid,{...current, revision:webcrypto.randomUUID(), turn_number:99});
      throw timeoutError();
    }
    if(opts.method==='POST'){
      if(body.slot===0 && rejectAutosave) return reply({code:'57014'},503);
      if(body.slot===0 && delayNextAuto){
        const waiting=delayNextAuto;delayNextAuto=null;
        autoWaiting();
        await waiting;
      }
      const slotrow=[...rows.values()].find(r=>r.slot===body.slot && r.slot!==null);
      if(body.id && rows.has(body.id))return reply(null,201);
      if(slotrow && !q.has('on_conflict'))return reply({code:'23505'},409);
      const id=body.id||slotrow?.id||webcrypto.randomUUID();
      rows.set(id,{...body,id,created_at:new Date().toISOString()});
      if(fault==='after-write') throw timeoutError();
      return reply(null,201);
    }
    if(!current || q.get('revision')!=='eq.'+current.revision)return reply([]);
    if(opts.method==='PATCH'){
      rows.set(rowid,{...current,...body});
      if(fault==='after-write') throw timeoutError();
    }
    if(opts.method==='DELETE')rows.delete(rowid);
    return reply([{id:rowid}]);
  }
};
(async()=>{
  vm.runInNewContext(code,context);
  const ui=context.window.empireonSaves, list=ids['save-slot-list'], modal=ids['save-load-modal'], status=ids['save-load-subtitle'];
  const wrap=page.match(/window.openSaveMenu = function\(\) \{[\s\S]*?window.closeSaveLoadMenu = function\(\) \{ window.empireonSaves.close\(\); \};/)[0];
  context.isAnimatingAction=false;context.initAudio=()=>{};
  vm.runInNewContext(wrap,context);
  assert.equal(seen.length,0);
  const buttons=t=>list.buttons().filter(b=>b.textContent===t);
  await context.window.openSaveMenu();
  assert.equal(auth,1);assert.equal(buttons('Save').length,5);
  await buttons('Save')[0].onclick();
  const entry=()=>[...rows.values()].find(r=>r.slot===1);
  assert.equal(entry().state.turnNumber,8);assert.equal(entry().state.gameHistory.length,2);assert(modal.hidden);
  assert.equal(entry().game_version,version);
  assert.deepEqual(entry().state.map,[[{terrain:0,hasRoad:true}]]);
  assert.deepEqual(entry().state.gameHistory,[{turn:1,map:[[{terrain:0,road:true}]]},{turn:2,map:null}]);
  assert.deepEqual(history[0].map,[[{terrain:0,improvement:null,road:true,oilPipeline:false}]]);
  await context.window.openSaveMenu();const firstId=entry().id;state.turnNumber=9;
  await buttons('Save')[0].onclick();assert.equal(entry().id,firstId);assert.equal(entry().state.turnNumber,9);
  await context.window.openSaveMenu();entry().revision=webcrypto.randomUUID();
  await buttons('Save')[0].onclick();assert(!modal.hidden && status.textContent.includes('changed'));
  await context.window.openLoadMenu();await buttons('Load')[0].onclick();assert.equal(loaded.turnNumber,9);
  const snapshotsAfterLoad=snapshots;
  const requestsAfterLoad=seen.length;
  assert(!browserEvents.has('visibilitychange'));
  await browserEvents.get('online')();
  assert.equal(snapshots,snapshotsAfterLoad);
  assert.equal(seen.length,requestsAfterLoad);
  assert(![...rows.values()].some(r=>r.slot===0));
  await ui.checkpoint();state.turnNumber=10;await ui.checkpoint();
  const auto=()=>[...rows.values()].filter(r=>r.slot===0);
  assert.equal(auto().length,1);assert.equal(auto()[0].turn_number,10);
  await context.window.openLoadMenu();
  assert.equal(list.children[0].children[0].children[0].textContent,'Autosave');
  assert(list.children[0].className.includes('save-slot-automatic'));
  assert.equal(list.children[1].children[0].textContent,'Manual saves');
  assert.equal(buttons('Continue').length,1);
  await buttons('Continue')[0].onclick();
  assert.equal(loaded.turnNumber,10);
  const requestsBeforeFlush=seen.length;
  await browserEvents.get('online')();
  assert.equal(seen.length,requestsBeforeFlush);
  let releaseSave;
  delayNextAuto=new Promise(resolve=>{releaseSave=resolve});
  const reachedRequest=new Promise(resolve=>{autoWaiting=resolve});
  state.turnNumber=11;
  const uploading=ui.checkpoint();
  await reachedRequest;
  state.turnNumber=12;
  void ui.checkpoint();
  context.gameStarted=false;state.turnNumber=42;
  const listing=context.window.openLoadMenu();
  assert.match(status.textContent,/Finishing autosave/);
  assert.equal(auto()[0].turn_number,10);
  releaseSave();
  await uploading;
  await listing;
  assert.equal(auto()[0].turn_number,12);
  await buttons('Continue')[0].onclick();
  assert.equal(loaded.turnNumber,12);
  context.gameStarted=true;state.turnNumber=13;
  rejectAutosave=true;
  const rejected=ui.checkpoint();
  await rejected;
  await context.window.openLoadMenu();
  assert.match(status.textContent,/latest autosave is pending/);
  assert.equal(auto()[0].turn_number,12);
  rejectAutosave=false;
  state.turnNumber=99;
  const snapshotsBeforeRetry=snapshots;
  await browserEvents.get('online')();
  assert.equal(snapshots,snapshotsBeforeRetry);
  assert.equal(auto()[0].turn_number,13);
  state.turnNumber=13;
  context.civiLanguage='he';
  await context.window.openLoadMenu();
  assert.equal(list.children[0].children[0].children[0].textContent,'שמירה אוטומטית');
  assert.equal(list.children[1].children[0].textContent,'שמירות ידניות');
  assert.equal(buttons('המשך משחק').length,1);
  context.civiLanguage='en';
  await context.window.openSaveMenu();offline=true;
  assert.equal(buttons('Continue').length,0);
  await buttons('Save')[1].onclick();assert(!modal.hidden && status.textContent.includes('Try again'));assert(![...rows.values()].some(r=>r.slot===2));
  await ui.checkpoint();assert(messages.at(-1).includes('Autosave failed'));offline=false;
  await browserEvents.get('online')();assert.equal(auth,1);
  await context.window.openSaveMenu();await buttons('✕')[0].onclick();assert(!entry());
  store.set(prefix+2,JSON.stringify(state));
  for(let i=0;i<2;i++){await context.window.openLoadMenu();await buttons('Import saves from the previous version')[0].onclick();}
  assert.equal([...rows.values()].filter(r=>r.slot===null).length,1);
  assert(store.has(prefix+2));assert(!localWrites.some(k=>k.includes('save_slot')||k==='legacy'));
  assert(localWrites.every(k=>k.startsWith('empireon.cloud.session.v1')));
  const getSlot=slot=>[...rows.values()].find(row=>row.slot===slot);
  state.turnNumber=14;
  state.saveThumbnail='data:image/jpeg;base64,preview';
  history.push({turn:14,map:null,details:'נמל ⚓ '.repeat(2500)});
  nextManualTimeout='before-write';
  await context.window.openSaveMenu();
  let requests=seen.length;
  await buttons('Save')[1].onclick();
  assert(modal.hidden);
  const attempts=seen.slice(requests).filter(action=>action.opts.method==='POST');
  assert.equal(attempts.length,2);
  assert.equal(attempts[0].opts.body,attempts[1].opts.body);
  assert(Buffer.byteLength(attempts[0].opts.body)<4096);
  const packed=getSlot(2).state;
  assert(packed.gzipBase64 && packed.saveThumbnail===state.saveThumbnail);
  assert.equal(packed.savedAt,state.savedAt);
  await context.window.openLoadMenu();
  await buttons('Load')[0].onclick();
  assert.equal(loaded.turnNumber,14);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.map)),[[{terrain:0,hasRoad:true}]]);
  assert.equal(loaded.gameHistory.at(-1).details,history.at(-1).details);
  assert.equal(loaded.saveThumbnail,state.saveThumbnail);
  await browserEvents.get('online')();
  assert.equal(getSlot(0).turn_number,13);
  await ui.checkpoint();
  assert(getSlot(0).state.gzipBase64);

  state.turnNumber=15;
  nextManualTimeout='after-write';
  await context.window.openSaveMenu();
  requests=seen.length;
  await buttons('Save')[1].onclick();
  assert(modal.hidden);
  assert.equal(seen.slice(requests).filter(action=>action.opts.method==='PATCH').length,1);
  assert.equal(getSlot(2).turn_number,15);

  nextManualTimeout='concurrent-write';
  await context.window.openSaveMenu();
  requests=seen.length;
  await buttons('Save')[1].onclick();
  assert(!modal.hidden && status.textContent.includes('changed'));
  assert.equal(seen.slice(requests).filter(action=>action.opts.method==='PATCH').length,1);
  assert.equal(getSlot(2).turn_number,99);

  context.CompressionStream=undefined;
  state.turnNumber=16;
  await context.window.openSaveMenu();
  await buttons('Save')[2].onclick();
  assert.equal(getSlot(3).state.turnNumber,16);
  assert(!getSlot(3).state.gzipBase64);
  context.CompressionStream=CompressionStream;

  let releaseAuto;
  delayNextAuto=new Promise(resolve=>{releaseAuto=resolve});
  const reachedAuto=new Promise(resolve=>{autoWaiting=resolve});
  state.turnNumber=17;
  const background=ui.checkpoint();
  await reachedAuto;
  await context.window.openSaveMenu();
  requests=seen.length;
  const manual=buttons('Save')[3].onclick();
  while(status.textContent==='Please wait…') await new Promise(resolve=>setImmediate(resolve));
  assert.match(status.textContent,/Waiting for the current autosave/);
  assert.equal(seen.length,requests);
  releaseAuto();
  await background;
  await manual;
  assert.equal(getSlot(4).turn_number,17);
  const report=context.window.empireonReports, data={steps:'Open city',expected:'City opens',diagnostics:{turn:10,screen:'world-map'}};
  offline=true;
  await assert.rejects(() => report.submit('City does not open',data), /offline/);
  assert.equal(reports.length,0);
  offline=false;
  await report.submit('City does not open',data);
  assert.deepEqual(reports,[{user_id:'aa',bug_description:'City does not open',bug_data:data,game_version:version}]);
  assert.equal(auth,1);
  console.log('PASS: all embedded scripts parse; real menu and autosave entry points, anonymous sign-in, 5 slots, reload, overwrite conflict, deletion, offline failure/retry, legacy import without duplicates; no browser game-state writes.');
  console.log('PASS: loading never creates autosaves. Queued checkpoints preserve their game state, and online recovery retries the same snapshot.');
  console.log('PASS: bug reports use the save session and insert only, with database defaults and recovery from a failed request.');
  console.log('PASS: gzip round trip with Hebrew and history, plain JSON fallback, exact retry after timeout, confirmation after lost response and serialized autosave/manual uploads.');
})().catch(e=>{console.error(e);process.exitCode=1});
