'use strict';
// Daily-use UI shell: three bottom tabs, a connectivity icon and hash routing.
// Screens plug in through `screens` below (Activities home, Devices list,
// remotes and the layout editor each register themselves in later steps).
const $ = id => document.getElementById(id);
// state.online: null = connecting (first load / retrying), true, false.
// Falsy for null and false, so `!state.online` guards behave like app.js's.
const state = {session:null, config:null, devices:[], online:null};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readLocal = (key, fallback='') => {try{return localStorage.getItem(key) || fallback;}catch{return fallback;}};
const writeLocal = (key, value) => {try{localStorage.setItem(key,value);}catch{}};
const TABS = ['activities','devices','setup'];
const CONNECTION_LABEL = {connecting:'Connecting to the hub',online:'Connected to the hub',offline:'Disconnected from the hub. Retrying.'};

// '#/activity/watch%20tv' -> {name:'activity', params:['watch tv']}; anything
// unrecognised falls back to the landing tab.
function parseRoute(hash) {
  const parts = String(hash||'').replace(/^#\/?/,'').split('/').filter(Boolean);
  try {
    const name = parts[0] && screens[parts[0]] ? parts[0] : 'activities';
    return {name, params: name===parts[0] ? parts.slice(1).map(decodeURIComponent) : []};
  } catch {return {name:'activities', params:[]};}
}
const routeHash = (name, ...params) => '#/'+[name,...params.map(encodeURIComponent)].join('/');

function notice(message, error=false) {$('notice').textContent=message;$('notice').hidden=!message;$('notice').dataset.error=String(error);}
function connection(online) {
  state.online = online;
  const name = online===null ? 'connecting' : online ? 'online' : 'offline', button = $('connection');
  button.dataset.state = name;
  button.setAttribute('aria-label',CONNECTION_LABEL[name]);button.title=CONNECTION_LABEL[name];
}
async function api(path, body) {
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch('/api/v1/'+path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,
      method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Harmony-CSRF':state.session?.csrf||''}:{},body:body?JSON.stringify(body):undefined});
    const result=await response.json();connection(true);
    if(!response.ok || result.ok===false) {if(response.status===401)state.session=null;throw Error(result.error||`Request failed (${response.status})`);}
    return result;
  } catch(error) {if(error.name==='AbortError'||error instanceof TypeError)connection(false);throw error;}
  finally {clearTimeout(timeout);}
}
async function loadDevices() {
  const inventory=await api('devices');state.devices=(inventory.devices||[]).map(d=>({...d,transport:'ir'}));
  const bluetooth=await api('bluetooth/devices');state.devices.push(...(bluetooth.devices||[]).map(d=>({...d,transport:'bluetooth'})));
}

const screens = {
  // render(ctx) fills ctx.content; ctx.params are the decoded route params.
  // tab: which bottom tab it belongs to (tab screens show the connectivity
  // icon and no back arrow); parent: where a drill-in screen's back arrow goes.
  activities: {title:'Activities', tab:'activities', render:ctx=>placeholder(ctx,'Activities are built in the next step.')},
  devices: {title:'Devices', tab:'devices', render:ctx=>placeholder(ctx,'Devices are built in a later step.')},
  setup: {title:'Setup', tab:'setup', render:ctx=>{
    ctx.content.innerHTML='<div class="placeholder"><p>Device setup, IR learning, Bluetooth pairing, backups and the rest live in the full settings pages.</p><p><a href="/#settings">Open full settings</a></p></div>';
  }},
  activity: {title:'Activity', parent:'activities', render:ctx=>placeholder(ctx,'The activity remote is built in a later step.')},
  device: {title:'Device', parent:'devices', render:ctx=>placeholder(ctx,'The device remote is built in a later step.')},
};
function placeholder(ctx, text) {ctx.content.innerHTML=`<div class="placeholder"><p>${escape(text)}</p></div>`;}

function show() {
  const {name, params} = parseRoute(location.hash), screen = screens[name], ctx = {params, content:$('content'), setTitle};
  function setTitle(text) {$('title').textContent=text;document.title=text+' · Harmony Remote';}
  $('header-actions').innerHTML='';
  setTitle(screen.title);
  $('back').hidden = !screen.parent;
  $('back').dataset.parent = screen.parent||'';
  $('connection').hidden = !!screen.parent;
  $('tabs').hidden = !!screen.parent;
  $('tabs').querySelectorAll('[data-tab]').forEach(a=>{if(a.dataset.tab===screen.tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  notice('');
  $('content').innerHTML='';
  screen.render(ctx);
  $('content').setAttribute('aria-busy','false');
  $('content').focus({preventScroll:true});window.scrollTo(0,0);
}

// This UI only handles an established, set-up session; pairing, claiming
// and first-run setup stay in the original UI at "/".
const needsFullUi = (session, config) => ['unpaired','pending'].includes(session.role) || session.buttonPending || (session.role==='owner' && config?.setupMode==='unselected');
let sessionTimer;
async function boot() {
  try {
    const session=await api('session');state.session=session;
    if(needsFullUi(session))return location.replace('/');
    state.config=await api('configuration');
    if(needsFullUi(session,state.config))return location.replace('/');
    await loadDevices();
    if(!location.hash)history.replaceState(null,'',routeHash('activities'));
    show();
  } catch(error) {
    if(state.session===null&&state.online)return location.replace('/');
    // A dead connection is already shown by the status icon, and pollSession() keeps retrying.
    if(state.online!==false)notice(error.message,true);
    $('content').setAttribute('aria-busy','false');
  }
}
async function pollSession() {
  try {
    const session=await api('session');
    if(!state.config||!state.session||session.role!==state.session.role||needsFullUi(session))await boot();
  } catch {/* api() has already flagged the connection state; keep retrying */}
  finally {clearTimeout(sessionTimer);sessionTimer=setTimeout(pollSession,15000);}
}

if(typeof document!=='undefined'&&$('content')) {
  window.addEventListener('hashchange',()=>{if(state.config)show();});
  $('back').addEventListener('click',()=>{location.hash=routeHash($('back').dataset.parent||'activities');});
  $('connection').addEventListener('click',()=>{connection(null);boot();});
  sessionTimer=setTimeout(pollSession,15000);
  boot();
}
