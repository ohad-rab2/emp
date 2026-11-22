/* Run alongside the release with: node test-cloud.cjs. No external services. */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const page=fs.readFileSync(path.join(__dirname,'EMPIREON_v87_30_Anonymous_DB_Saves.html'),'utf8');
const code=fs.readFileSync(path.join(__dirname,'cloud.js'),'utf8');
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
const store=new Map(), localWrites=[], seen=[], rows=new Map(), messages=[];
const prefix='empireon_mobilization_save_slot_';
const state={MAP_WIDTH:1,MAP_HEIGHT:1,map:[[{terrain:1}]],units:[],cities:[],saveName:'Test',worldSeed:42,turnNumber:8,savedAt:new Date().toISOString()};
let auth=0, offline=false, loaded;
const context={
  window:{addEventListener(){}}, document:{getElementById:k=>ids[k],createElement:tag=>new Element(tag),addEventListener(){}},
  navigator:{},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>{localWrites.push(k);store.set(k,v)},removeItem:k=>store.delete(k)},
  crypto:webcrypto,AbortSignal,URL,Date,TextEncoder,TypeError,console,
  setTimeout:()=>1,clearTimeout(){},gameStarted:true,civiLanguage:'en', SAVE_SLOT_COUNT:6,SAVE_PREFIX:prefix,LEGACY_SAVE_KEY:'legacy',
  makeSaveData:()=>structuredClone(state),applySaveData:d=>{loaded=d},gameHistory:[{turn:1}],historyEvents:['started'],
  confirm:()=>true,playSound(){},showMsg:t=>messages.push(t),
  fetch:async(url,opts)=>{
    const u=new URL(url),body=opts.body?JSON.parse(opts.body):null,q=u.searchParams;
    seen.push({u,opts,body});
    if(offline)throw new TypeError('offline');
    const reply=(data,status=200)=>({ok:status<300,status,text:async()=>data==null?'':JSON.stringify(data)});
    if(u.pathname==='/auth/v1/signup'){auth++;assert.deepEqual(body,{data:{}});return reply({user:{id:'aa'},access_token:'jwt',refresh_token:'refresh',expires_in:3600});}
    assert.equal(opts.headers.Authorization,'Bearer jwt');
    assert.equal(u.pathname,'/rest/v1/saved_games');
    const rowid=(q.get('id')||'').replace('eq.',''),current=rows.get(rowid);
    if(opts.method==='GET'){
      if(rowid) return reply(current?[current]:[]);
      return reply([...rows.values()].filter(r=>(q.get('slot')==='is.null')===(r.slot===null)));
    }
    if(opts.method==='POST'){
      const slotrow=[...rows.values()].find(r=>r.slot===body.slot && r.slot!==null);
      if(body.id && rows.has(body.id))return reply(null,201);
      if(slotrow && !q.has('on_conflict'))return reply({code:'23505'},409);
      const id=body.id||slotrow?.id||webcrypto.randomUUID();
      rows.set(id,{...body,id,created_at:new Date().toISOString()});return reply(null,201);
    }
    if(!current || q.get('revision')!=='eq.'+current.revision)return reply([]);
    if(opts.method==='PATCH')rows.set(rowid,{...current,...body});
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
  assert.equal(entry().state.turnNumber,8);assert.equal(entry().state.gameHistory.length,1);assert(modal.hidden);
  await context.window.openSaveMenu();const firstId=entry().id;state.turnNumber=9;
  await buttons('Save')[0].onclick();assert.equal(entry().id,firstId);assert.equal(entry().state.turnNumber,9);
  await context.window.openSaveMenu();entry().revision=webcrypto.randomUUID();
  await buttons('Save')[0].onclick();assert(!modal.hidden && status.textContent.includes('changed'));
  await context.window.openLoadMenu();await buttons('Load')[0].onclick();assert.equal(loaded.turnNumber,9);
  vm.runInNewContext(page.match(/function saveGame\(\) \{ window\.empireonSaves\.scheduleAuto\(\); \}/)[0]+';saveGame();saveGame()',context);
  await ui.flushAuto();state.turnNumber=10;ui.scheduleAuto();await ui.flushAuto();
  const auto=()=>[...rows.values()].filter(r=>r.slot===0);
  assert.equal(auto().length,1);assert.equal(auto()[0].turn_number,10);
  await context.window.openSaveMenu();offline=true;
  await buttons('Save')[1].onclick();assert(!modal.hidden && status.textContent.includes('Try again'));assert(![...rows.values()].some(r=>r.slot===2));
  ui.scheduleAuto();await ui.flushAuto();assert(messages.at(-1).includes('Autosave failed'));offline=false;
  await ui.flushAuto();assert.equal(auth,1);
  await context.window.openSaveMenu();await buttons('✕')[0].onclick();assert(!entry());
  store.set(prefix+2,JSON.stringify(state));
  for(let i=0;i<2;i++){await context.window.openLoadMenu();await buttons('Import saves from the previous version')[0].onclick();}
  assert.equal([...rows.values()].filter(r=>r.slot===null).length,1);
  assert(store.has(prefix+2));assert(!localWrites.some(k=>k.includes('save_slot')||k==='legacy'));
  assert(localWrites.every(k=>k.startsWith('empireon.cloud.session.v1')));
  console.log('PASS: all embedded scripts parse; real menu and autosave entry points, anonymous sign-in, 5 slots, reload, overwrite conflict, deletion, offline failure/retry, legacy import without duplicates; no browser game-state writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
