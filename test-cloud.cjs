const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = __dirname;
const code = fs.readFileSync(path.join(root, 'cloud.js'), 'utf8');

class Element {
  constructor(tag) {
    this.tag = tag;
    this.style = {};
    this.children = [];
    this.hidden = false;
    this.value = this.textContent = '';
  }
  append(node) { this.children.push(node); }
  setAttribute() {}
  replaceChildren() { this.children = []; }
  querySelectorAll(tag) {
    return this.children.flatMap(n => [...(n.tag === tag ? [n] : []), ...n.querySelectorAll(tag)]);
  }
  showModal() { this.open = true; }
  close() { this.open = false; this.onclose?.(); }
}

const STORAGE = 'empireon.cloud.session.v1', LEGACY = 'empireon.cloud.config.v1';
const fixture = {MAP_WIDTH:1, MAP_HEIGHT:1, map:[[{col:0,row:0}]], units:[], cities:[], turnNumber:3, saveName:'Example'};
const account = {access_token:'token', refresh_token:'refresh', expires_in:3600, user:{email:'player@example.test'}};

function mount(storage = new Map()) {
  const body = new Element('body'), calls = [];
  const server = {offline:false, localOK:true, invalidRefresh:false};
  const context = {
    document: {body, createElement:tag => new Element(tag)},
    localStorage: {getItem:key=>storage.get(key), setItem:(key,val)=>storage.set(key,val), removeItem:key=>storage.delete(key)},
    URL, AbortSignal, Date, JSON, console, gameStarted:true,
    makeSaveData:()=>structuredClone(fixture), saveToSlot:()=>server.localOK, applySaveData:d=>server.loaded=d,
    showMsg:()=>{}, confirm:()=>true,
    fetch: async (url, options) => {
      calls.push({url, options});
      if (server.offline) throw Error('offline');
      let data, status=200;
      if (url.includes('grant_type=refresh_token') && server.invalidRefresh) status=400;
      else if (url.includes('/token')) data=account;
      else if (url.includes('/logout')) data=null;
      else if (url.includes('/signup')) data={user:{email:'player@example.test'}};
      else if (options.method==='POST') { server.saved=JSON.parse(options.body); data=null; }
      else if (url.includes('select=state')) data=[{state:server.saved.state,schema_version:1}];
      else data=server.saved ? [{id:'123',name:'Example',created_at:new Date().toISOString()}] : [];
      return {ok:status===200, status, text:async()=>JSON.stringify(data)};
    }
  };
  vm.runInNewContext(code,context);
  const [dialog, launch] = body.children;
  const [, , status, fields, actions, list] = dialog.children;
  const button = label => actions.children.find(n=>n.textContent===label);
  const visible = () => actions.children.filter(n=>!n.hidden).map(n=>n.textContent);
  return {dialog, launch, status, fields, actions, list, button, visible, server, calls, context};
}

(async () => {
  const gameFile = fs.readFileSync(path.join(root,'EMPIREON_v87_29_Cloud_Saves.html'),'utf8');
  assert(gameFile.includes('<script>\n'+code+'\n</script>'), 'Standalone game and cloud.js must match');
  const storage = new Map([[LEGACY, JSON.stringify({url:'https://example.invalid',key:'old'})],
                           [STORAGE, JSON.stringify(account)]]);
  const ui=mount(storage);
  assert.equal(ui.calls.length,0);
  assert(!ui.dialog.open && !storage.has(STORAGE) && !storage.has(LEGACY));
  await ui.launch.onclick();
  assert(ui.dialog.open && !ui.fields.hidden);
  assert.deepEqual(ui.visible(),['הרשמה','התחברות']);
  assert.deepEqual(ui.fields.children.map(n=>n.children[0].type),['email','password']);
  const [email,password]=ui.fields.querySelectorAll('input');
  email.value='player@example.test'; password.value='password';
  await ui.button('הרשמה').onclick();
  assert(ui.status.textContent.includes('בדואר') && !ui.fields.hidden);
  password.value='password';
  await ui.button('התחברות').onclick();
  assert.equal(ui.status.textContent,'אין שמירות בענן עדיין');
  assert(ui.fields.hidden && !ui.list.hidden && password.value==='');
  assert.deepEqual(ui.visible(),['התנתקות','רענון הרשימה','שמירת המשחק בענן']);
  assert(ui.calls.every(c=>new URL(c.url).origin==='https://fcuijevvmjvjsaajonyb.supabase.co'));
  await ui.button('שמירת המשחק בענן').onclick();
  assert.equal(ui.server.saved.state.turnNumber,3);
  assert.equal(ui.server.saved.schema_version,1);
  assert.equal(ui.calls.at(-1).options.headers.Authorization,'Bearer token');
  await ui.list.children[0].children[1].onclick();
  assert.equal(ui.server.loaded.turnNumber,3);
  const before=ui.calls.length;
  ui.server.localOK=false; await ui.button('שמירת המשחק בענן').onclick();
  assert.equal(ui.calls.length,before);
  assert(ui.status.textContent.includes('המקומית נכשלה'));
  ui.server.localOK=true; ui.server.offline=true;
  await ui.button('שמירת המשחק בענן').onclick();
  assert.equal(ui.status.textContent,'offline');

  storage.set(LEGACY,JSON.stringify({url:'https://fcuijevvmjvjsaajonyb.supabase.co',key:'previous-public-key'}));
  const returning=mount(storage);
  returning.context.gameStarted=false;
  assert.equal(returning.calls.length,0);
  await returning.launch.onclick();
  assert(returning.fields.hidden && !returning.list.hidden && returning.button('שמירת המשחק בענן').hidden);
  assert.equal(returning.calls.length,1);
  assert(!returning.calls[0].url.includes('/auth/'));
  await returning.button('התנתקות').onclick();
  assert(!storage.has(STORAGE) && !returning.fields.hidden && returning.list.hidden);

  storage.set(STORAGE, JSON.stringify({...account,expires_at:0}));
  const expired=mount(storage);
  expired.server.invalidRefresh=true;
  await expired.launch.onclick();
  assert(!storage.has(STORAGE) && !expired.fields.hidden && expired.status.textContent.includes('התחבר שוב'));
  console.log('PASS: no player setup, silent local startup, account reuse, expired and foreign sessions, sign-in, sign-up, logout, save/load and standalone parity.');
})().catch(error => { console.error(error); process.exitCode=1; });
