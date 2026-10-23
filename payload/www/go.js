'use strict';
// Daily-use UI shell: three bottom tabs, a connectivity icon and hash routing.
// Screens plug in through `screens` below (Activities home, Devices list,
// remotes and the layout editor each register themselves in later steps).
const $ = id => document.getElementById(id);
// state.online: null = connecting (first load / retrying), true, false.
// Falsy for null and false, so `!state.online` guards behave like app.js's.
const state = {session:null, config:null, devices:[], online:null, hold:null};
const owner = () => state.session?.role === 'owner';
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
  await api('operations',{id,action:'cancel'});throw Error('Operation timed out and was cancelled.');
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
  activity: {title:'Activity', parent:'activities', reserveNotice:true, render:renderActivityRemote},
  edit: {title:'Edit remote', parent:'activity', parentParams:params=>params.slice(0,1), render:ctx=>placeholder(ctx,'The layout editor is built in a later step.')},
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
  return `<div class="row"><a class="row-main" href="${routeHash('device',device.id)}"><span class="row-icon neutral">${icon(Object.hasOwn(DEVICE_ICONS,device.type)?DEVICE_ICONS[device.type]:'Radio')}</span><span class="row-text"><strong>${escape(device.name)}</strong><small>${escape(type)} · ${count} ${count===1?'command':'commands'}</small></span>${icon('ChevronRight')}</a></div>`;
}
function renderDevices(ctx) {
  ctx.content.innerHTML = `<div class="list">${state.devices.map(deviceRow).join('')||'<div class="placeholder"><p>No devices yet. Add one in the full settings pages.</p></div>'}</div>
    <a class="manage" href="/#devices">${icon('SlidersHorizontal')}Manage devices</a>`;
}
// [slot, label, icon, command-name aliases]. Slot, label and aliases must match
// app.js's `controls` (test_go_shell.mjs fails if they drift); only the icon
// column is this UI's own.
const CONTROLS = [
  ['power','Power','Power',['power','powertoggle','onoff']],
  ['poweron','Power on','Power',['poweron','on']],
  ['poweroff','Power off','Power',['poweroff','off']],
  ['input','Input','LogIn',['inputnext','inputup','input','source']],
  ['up','Up','ChevronUp',['directionup','up','arrowup','uparrow']],
  ['left','Left','ChevronLeft',['directionleft','left','arrowleft','leftarrow']],
  ['ok','OK','Check',['ok','select','enter']],
  ['right','Right','ChevronRight',['directionright','right','arrowright','rightarrow']],
  ['down','Down','ChevronDown',['directiondown','down','arrowdown','dnarrow','downarrow']],
  ['back','Back','Undo2',['back','return']],
  ['home','Home','House',['home','smarthome']],
  ['menu','Menu','Menu',['menu','settings','homemenu']],
  ['volumeup','Volume up','Plus',['volumeup','volup']],
  ['volumedown','Volume down','Minus',['volumedown','voldown','voldn']],
  ['mute','Mute','VolumeX',['mute']],
  ['channelup','Channel up','ChevronUp',['channelup','programup','pageup','chnext']],
  ['channeldown','Channel down','ChevronDown',['channeldown','programdown','pagedown','chprev']],
  ['rewind','Rewind','Rewind',['rewind','rew']],
  ['play','Play','Play',['play','playpause']],
  ['pause','Pause','Pause',['pause']],
  ['stop','Stop','Square',['stop']],
  ['guide','Guide','LayoutGrid',['guide','tvguide','epg']],
  ['forward','Fast forward','FastForward',['fastforward','forward']]
];
const norm = name => String(name).toLowerCase().replace(/\+/g,'up').replace(/-\s*$/,'down').replace(/[^a-z0-9]/g,'');
const controlFor = command => CONTROLS.find(c=>c[3].includes(norm(command)));
const matchCommand = (commands,aliases) => aliases.map(alias=>commands.find(c=>norm(c.name)===alias)).find(Boolean);
// Turn a stored {deviceId,command} back into the live device/command it
// refers to; null when either has since been deleted.
function resolveCell(c) {
  const device=state.devices.find(d=>d.id===c.deviceId);
  const command=device?.commands.find(cmd=>cmd.name===c.command);
  return command?{device,command}:null;
}

// The remote *view* of a screen's flat cell list. The editor stores a plain
// uniform grid; here Up/Down/Left/Right(/OK) cells are pulled out, in whatever
// order they were placed, and drawn as a cross where the first of them sat.
// Volume is left to the hardware keys, and cells whose device or command no
// longer exist are skipped.
const CROSS = ['up','left','ok','right','down'];
const HARDWARE_ONLY = ['volumeup','volumedown'];
const visibleEntries = cells => (cells||[]).map(cell=>({cell,control:controlFor(cell.command)}))
  .filter(e=>resolveCell(e.cell)&&!HARDWARE_ONLY.includes(e.control?.[0]));
function remoteBlocks(cells) {
  const entries = visibleEntries(cells);
  const pick = {};
  for(const slot of CROSS)pick[slot]=entries.find(e=>e.control?.[0]===slot);
  const crossed = ['up','down','left','right'].every(slot=>pick[slot]);
  const members = crossed ? new Set(Object.values(pick).filter(Boolean)) : new Set();
  const blocks = [];
  for(const entry of entries) {
    if(members.has(entry)){if(!blocks.some(b=>b.kind==='cross'))blocks.push({kind:'cross',pick});continue;}
    if(blocks.at(-1)?.kind!=='grid')blocks.push({kind:'grid',entries:[]});
    blocks.at(-1).entries.push(entry);
  }
  return blocks;
}
function cellButton({cell,control}, extra='') {
  const label = control?.[1] || cell.command;
  // A command with no known icon shows its own name instead of a generic glyph.
  const face = control?.[2] ? icon(control[2]) : `<span class="cell-text">${escape(cell.command)}</span>`;
  return `<button class="cell ${extra}" type="button" data-command="${escape(cell.command)}" data-device="${escape(cell.deviceId)}" aria-label="${escape(label)}" title="${escape(label)}">${face}</button>`;
}
function remoteHtml(screen) {
  const columns = screen?.columns || 4;
  const body = remoteBlocks(screen?.cells).map(block=>block.kind==='cross'
    ? `<div class="dpad">${CROSS.map(slot=>block.pick[slot]?cellButton(block.pick[slot],slot):'<span></span>').join('')}</div>`
    : `<div class="cells" data-columns="${escape(String(columns))}">${block.entries.map(e=>cellButton(e)).join('')}</div>`).join('');
  // The pinned footer is a plain row in the order it was set: no cross.
  const pinned = visibleEntries(screen?.pinned);
  return {body, pinned: pinned.length ? `<div class="cells" data-columns="${escape(String(columns))}">${pinned.map(e=>cellButton(e)).join('')}</div>` : ''};
}

// --- command sending (same tap / press-and-hold behaviour as app.js) ---
async function tap(button) {
  if(!state.online)return notice('The hub is disconnected. Check the connection before sending.',true);
  const device=state.devices.find(d=>d.id===button.dataset.device);
  try {notice('Sending...');const op=await api('commands/send',{deviceId:device.id,command:button.dataset.command,transport:device.transport,mode:'tap'});const result=await operation(op.id);notice(result.state==='completed'?'Sent to the hub.':'Command cancelled.');}
  catch(error){notice(error.message,true);}
}
function stopHold(tapOnRelease=false) {
  const hold=state.hold;if(!hold)return;
  state.hold=null;hold.stopped=true;clearTimeout(hold.timer);clearInterval(hold.renew);
  hold.button.classList.remove('is-held');hold.button.setAttribute('aria-pressed','false');
  if(hold.id)api('operations',{id:hold.id,action:'cancel'}).catch(()=>{});
  else if(tapOnRelease&&!hold.started)tap(hold.button);
}
function beginHold(button,pointerId=null) {
  stopHold(false);if(!state.online)return;
  const hold={button,pointerId,stopped:false,started:false};state.hold=hold;
  button.classList.add('is-held');button.setAttribute('aria-pressed','true');
  hold.timer=setTimeout(async()=>{
    const device=state.devices.find(d=>d.id===button.dataset.device);
    if(device.transport==='bluetooth'){stopHold(true);return;}
    hold.started=true;
    try {
      const queued=await api('commands/send',{deviceId:device.id,command:button.dataset.command,transport:'ir',mode:'hold'});hold.id=queued.id;
      if(hold.stopped){await api('operations',{id:hold.id,action:'cancel'});return;}
      notice('Sending while held...');
      hold.renew=setInterval(()=>api('operations',{id:hold.id,action:'keepalive'}).catch(error=>{stopHold(false);notice(error.message,true);}),250);
      await operation(hold.id);if(state.hold===hold)stopHold(false);notice('Transmission stopped.');
    }catch(error){if(state.hold===hold)stopHold(false);notice(error.message,true);}
  },300);
}
function bindCommands(root) {
  root.querySelectorAll('[data-command]').forEach(button=>{
    let suppressUntil=0;
    button.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();suppressUntil=Date.now()+800;button.setPointerCapture?.(event.pointerId);beginHold(button,event.pointerId);});
    button.addEventListener('pointerup',event=>{suppressUntil=Date.now()+800;if(state.hold?.button===button&&state.hold.pointerId===event.pointerId)stopHold(true);});
    button.addEventListener('pointermove',event=>{if(state.hold?.button!==button)return;const b=button.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)stopHold(false);});
    ['pointercancel','lostpointercapture'].forEach(name=>button.addEventListener(name,()=>{if(state.hold?.button===button)stopHold(false);}));
    button.addEventListener('keydown',event=>{if(![' ','Enter'].includes(event.key))return;event.preventDefault();if(event.repeat)return;suppressUntil=Date.now()+800;beginHold(button);});
    button.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)){suppressUntil=Date.now()+800;event.preventDefault();if(state.hold?.button===button)stopHold(true);}});
    button.addEventListener('blur',()=>{if(state.hold?.button===button)stopHold(false);});
    button.addEventListener('click',event=>{event.preventDefault();if(Date.now()>suppressUntil)tap(button);});
    button.addEventListener('contextmenu',event=>event.preventDefault());
  });
}
['blur','pagehide'].forEach(name=>window.addEventListener(name,()=>stopHold(false)));
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopHold(false);});
// --- end command sending ---

// Android wrapper hook (MainActivity.onKeyDown): the volume keys act on the
// running activity. A volume cell on its screen wins (first one whose device
// and command still exist, as in app.js); the new editor can't place volume,
// so otherwise fall back to the first start-step device with a volume command.
let hardwareVolumeBusy = false;
function volumeTarget(activity, slot) {
  const aliases = CONTROLS.find(c=>c[0]===slot)[3];
  const fromScreen = (activity.screen?.cells||[]).filter(c=>aliases.includes(norm(c.command)))
    .map(c=>resolveCell(c)).find(Boolean);
  if(fromScreen)return {device:fromScreen.device, command:fromScreen.command.name};
  for(const id of new Set((activity.steps||[]).map(s=>s.deviceId).filter(Boolean))) {
    const device=state.devices.find(d=>d.id===id), command=device&&matchCommand(device.commands,aliases);
    if(command)return {device, command:command.name};
  }
  return null;
}
window.harmonyHardwareVolume = function(direction) {
  if(!state.online||!state.config||!state.devices.length||hardwareVolumeBusy)return;
  const activity=activeActivity();if(!activity)return;
  const target=volumeTarget(activity,direction==='up'?'volumeup':'volumedown');if(!target)return;
  hardwareVolumeBusy=true;
  api('commands/send',{deviceId:target.device.id,command:target.command,transport:target.device.transport||'ir',mode:'tap'})
    .then(op=>operation(op.id))
    .catch(error=>notice(error.message,true))
    .finally(()=>{hardwareVolumeBusy=false;});
};

function renderActivityRemote(ctx) {
  const activity=(state.config.activities||[]).find(a=>a.id===ctx.params[0]);
  if(!activity){ctx.setTitle('Activity');return placeholder(ctx,'This activity no longer exists.');}
  ctx.setTitle(activity.name);
  if(owner())ctx.actions.innerHTML=`<a class="header-action" href="${routeHash('edit',activity.id)}" aria-label="Edit remote layout" title="Edit remote layout">${icon('Pencil')}</a>`;
  const {body,pinned}=remoteHtml(activity.screen);
  ctx.content.innerHTML=`<div class="remote">${body||'<div class="placeholder"><p>No buttons on this remote yet.</p></div>'}</div>${pinned?`<div class="pinned"><div class="pinned-label">Always visible</div>${pinned}</div>`:''}`;
  bindCommands(ctx.content);
}
function placeholder(ctx, text) {ctx.content.innerHTML=`<div class="placeholder"><p>${escape(text)}</p></div>`;}

function show() {
  const {name, params} = parseRoute(location.hash), screen = screens[name], ctx = {params, content:$('content'), actions:$('header-actions'), setTitle};
  stopHold(false);
  function setTitle(text) {$('title').textContent=text;document.title=text+' · Harmony Remote';}
  $('header-actions').innerHTML='';
  setTitle(screen.title);
  $('back').hidden = !screen.parent;
  $('back').dataset.parent = screen.parent||'';
  $('back').dataset.href = screen.parent ? routeHash(screen.parent,...(screen.parentParams?.(params)||[])) : '';
  document.body.dataset.reserveNotice = String(!!screen.reserveNotice);
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
  $('back').addEventListener('click',()=>{location.hash=$('back').dataset.href||routeHash('activities');});
  $('connection').addEventListener('click',()=>{connection(null);boot();});
  sessionTimer=setTimeout(pollSession,15000);
  boot();
}
