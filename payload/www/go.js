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
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const icon = name => `<svg aria-hidden="true"><use href="/icons.svg#icon-${escape(name)}"></use></svg>`;
const CONNECTION_LABEL = {connecting:'Connecting to the hub',online:'Connected to the hub',offline:'Disconnected from the hub. Retrying.'};

// '#/activity/watch%20tv' -> {name:'activity', params:['watch tv']}; anything
// unrecognised falls back to the landing tab.
function parseRoute(hash) {
  const parts = String(hash||'').replace(/^#\/?/,'').split('/').filter(Boolean);
  try {
    const name = Object.hasOwn(screens, parts[0]) ? parts[0] : 'activities';
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
    if(!response.ok || result.ok===false) {throw Object.assign(Error(result.error||`Request failed (${response.status})`),{status:response.status});}
    return result;
  } catch(error) {if(error.name==='AbortError'||error instanceof TypeError)connection(false);throw error;}
  finally {clearTimeout(timeout);}
}
// Same polling contract as app.js's operation(): resolves with the finished
// operation, throws if the hub reports it failed.
async function operation(id, seconds=45) {
  const deadline=Date.now()+seconds*1000;
  while(Date.now()<deadline) {
    const op=await api('operations?id='+encodeURIComponent(id));
    if(['failed','cancelled','completed'].includes(op.state)) {
      if(op.state==='failed')throw Error(op.result?.error||'The hub could not complete this.');
      return op;
    }
    await sleep(80);
  }
  throw Error('The hub did not finish in time.');
}
async function loadDevices() {
  const inventory=await api('devices');state.devices=(inventory.devices||[]).map(d=>({...d,transport:'ir'}));
  const bluetooth=await api('bluetooth/devices');state.devices.push(...(bluetooth.devices||[]).map(d=>({...d,transport:'bluetooth'})));
}

const screens = {
  // render(ctx) fills ctx.content; ctx.params are the decoded route params.
  // tab: which bottom tab it belongs to (tab screens show the connectivity
  // icon and no back arrow); parent: where a drill-in screen's back arrow goes.
  activities: {title:'Activities', tab:'activities', render:renderActivities},
  devices: {title:'Devices', tab:'devices', render:renderDevices},
  setup: {title:'Setup', tab:'setup', render:ctx=>{
    ctx.content.innerHTML='<div class="placeholder"><p>Device setup, IR learning, Bluetooth pairing, backups and the rest live in the full settings pages.</p><p><a href="/#settings">Open full settings</a></p></div>';
  }},
  activity: {title:'Activity', parent:'activities', render:ctx=>placeholder(ctx,'The activity remote is built in a later step.')},
  device: {title:'Device', parent:'devices', render:ctx=>placeholder(ctx,'The device remote is built in a later step.')},
};
// There is no hub-side "running" activity: like the original UI, the client
// remembers the last one it started in localStorage.
const ACTIVITY_KEY = 'harmony-activity';
const activeActivity = () => state.config?.activities?.find(a=>a.id===readLocal(ACTIVITY_KEY));
const activityDevices = activity => [...new Set((activity.steps||[]).map(s=>s.deviceId).filter(Boolean))]
  .map(id=>state.devices.find(d=>d.id===id)?.name).filter(Boolean);
let activityOperation = null;  // {id, activityId} while a start/stop is in flight

function activityRow(activity) {
  const running = activeActivity()?.id===activity.id, id = escape(activity.id), name = escape(activity.name);
  const subtitle = running ? '<span class="running"><span class="dot" aria-hidden="true"></span>Running</span>' : `<small>${escape(activityDevices(activity).join(' · ')||'No devices')}</small>`;
  return `<div class="row" data-running="${running}">
    <button class="row-main" type="button" data-open="${id}"><span class="row-icon">${icon('Play')}</span><span class="row-text"><strong>${name}</strong>${subtitle}</span>${running?'':icon('ChevronRight')}</button>
    <button class="row-action" type="button" data-fix="${id}" aria-label="Fix device state for ${name}" title="Fix device state">${icon('RefreshCw')}</button>
    ${running?`<button class="row-action stop" type="button" data-stop aria-label="Stop ${name}" title="Stop">${icon('Square')}</button>`:''}
  </div>`;
}
function renderActivities(ctx) {
  const activities = state.config.activities||[];
  ctx.content.innerHTML = `${activityOperation?'<div class="busy" role="status"><span>Working…</span><button type="button" data-cancel>Cancel</button></div>':''}
    <div class="list">${activities.map(activityRow).join('')||'<div class="placeholder"><p>No activities yet. Create one in the full settings pages.</p></div>'}</div>
    <a class="manage" href="/#activities">${icon('SlidersHorizontal')}Manage activities</a>`;
  // Starting an activity takes seconds and the user may have navigated away
  // by the time it finishes: only touch the screen while it is still showing.
  const onScreen = () => ctx.content.isConnected && parseRoute(location.hash).name==='activities';
  const redraw = () => {if(onScreen())renderActivities(ctx);};
  const say = (message, error=false) => {if(onScreen())notice(message,error);};
  async function run(activityId, {fixState=false}={}) {
    if(activityOperation)return;
    if(!state.online)return say('The hub is disconnected. Check the connection before starting an activity.',true);
    try {
      const op=await api('activities/run',{activityId,fixState});activityOperation={id:op.id,activityId};redraw();say('');
      const result=await operation(op.id,180);
      if(result.state==='completed')return true;
      say('Cancelled. Device state is unknown.',true);
    } catch(error) {say(error.message,true);}
    finally {activityOperation=null;redraw();}
  }
  ctx.content.onclick = async event => {
    const button = event.target.closest('button');if(!button)return;
    if('cancel' in button.dataset){if(activityOperation)await api('operations',{id:activityOperation.id,action:'cancel'}).catch(error=>say(error.message,true));return;}
    if(activityOperation)return;
    if(button.dataset.open){
      if(activeActivity()?.id===button.dataset.open){location.hash=routeHash('activity',button.dataset.open);return;}
      if(await run(button.dataset.open)){writeLocal(ACTIVITY_KEY,button.dataset.open);location.hash=routeHash('activity',button.dataset.open);}
    } else if(button.dataset.fix) {
      // Re-sends the activity's start steps without the usual skip-if-already-on
      // logic; the activity counts as running afterwards, and we stay on the list.
      if(await run(button.dataset.fix,{fixState:true})){writeLocal(ACTIVITY_KEY,button.dataset.fix);redraw();say('Device state fixed. It is still an estimate.');}
    } else if('stop' in button.dataset) {
      // "-1" is the hub's power-off request: it runs the running activity's exit steps.
      if(await run('-1')){writeLocal(ACTIVITY_KEY,'');redraw();}
    }
  };
}
const DEVICE_ICONS = {Television:'Tv', Audio:'Speaker', 'Media Player':'MonitorPlay'};
function deviceRow(device) {
  const count = (device.commands||[]).length, type = device.type || (device.transport==='bluetooth' ? 'Bluetooth' : 'IR');
  return `<div class="row"><a class="row-main" href="${routeHash('device',device.id)}"><span class="row-icon neutral">${icon(DEVICE_ICONS[device.type]||'Radio')}</span><span class="row-text"><strong>${escape(device.name)}</strong><small>${escape(type)} · ${count} ${count===1?'command':'commands'}</small></span>${icon('ChevronRight')}</a></div>`;
}
function renderDevices(ctx) {
  ctx.content.innerHTML = `<div class="list">${state.devices.map(deviceRow).join('')||'<div class="placeholder"><p>No devices yet. Add one in the full settings pages.</p></div>'}</div>
    <a class="manage" href="/#devices">${icon('SlidersHorizontal')}Manage devices</a>`;
}
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
    if(error.status===401)return location.replace('/');
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
