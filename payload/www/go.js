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
  // Rokus are an extra: if this one request fails the other devices still show.
  try {const network=await api('network/devices');state.devices.push(...(network.devices||[]).map(d=>({...d,transport:'roku'})));} catch {/* api() has flagged the connection */}
  // The devices decide what the lock-screen buttons press (a removed Roku, say), so the app hears again.
  announceRunning();
}

const SCREEN_HANDLERS = ['onclick','onpointerdown','onpointermove','onpointerup','onpointercancel','onpointerleave','oncontextmenu','onkeydown','onsubmit','onchange'];
const screens = {
  // render(ctx) fills ctx.content; ctx.params are the decoded route params.
  // tab: which bottom tab it belongs to (tab screens show the connectivity
  // icon and no back arrow); parent: where a drill-in screen's back arrow goes.
  activities: {title:'Activities', tab:'activities', render:renderActivities},
  devices: {title:'Devices', tab:'devices', render:renderDevices},
  setup: {title:'Setup', tab:'setup', reserveNotice:true, render:renderSetup},
  roku: {title:'Roku', parent:'setup', reserveNotice:true, render:renderRoku},
  activity: {title:'Activity', parent:'activities', reserveNotice:true, render:renderActivityRemote},
  edit: {title:'Edit remote', parent:'activity', parentParams:params=>params.slice(0,1), reserveNotice:true, render:renderEditor},
  device: {title:'Device', parent:'devices', reserveNotice:true, render:renderDeviceRemote},
};
// There is no hub-side "running" activity: like the original UI, the client
// remembers the last one it started in localStorage.
const ACTIVITY_KEY = 'harmony-activity';
const activeActivity = () => state.config?.activities?.find(a=>a.id===readLocal(ACTIVITY_KEY));
// The Android app keeps Volume − / Play / Volume + buttons on the lock screen while an
// activity runs. It cannot work out which command each one sends, so the page does:
// the same choice the hardware volume keys make. An empty string means nothing is running.
const LOCK_SCREEN_BUTTONS = [['volumedown','Volume down'],['play','Play'],['volumeup','Volume up']];
function announceRunning() {
  const activity = activeActivity();
  const buttons = activity ? LOCK_SCREEN_BUTTONS.flatMap(([slot,label])=>{
    const target = volumeTarget(activity,slot);
    return target ? [{key:slot, label, deviceId:target.device.id, command:target.command, transport:target.device.transport||'ir'}] : [];
  }) : [];
  try {window.HarmonyNative?.setRunningActivity?.(buttons.length ? JSON.stringify({id:activity.id, name:activity.name, buttons}) : '');} catch {/* no native bridge */}
}
// Remember which activity is running (or none, with '') and tell the app.
function setRunningActivity(id) {writeLocal(ACTIVITY_KEY,id);announceRunning();}
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
// Setup is a short list of links into the original pages, which keep device
// setup, IR learning, Bluetooth pairing, activity steps, backups and the rest.
const SETUP_LINKS = [
  ['#/roku','Wifi','Roku','Add a Roku TV or player on your network'],
  ['/#devices','Radio','Devices','Add devices, learn IR codes, pair Bluetooth'],
  ['/#activities','SlidersHorizontal','Activities','Create activities and edit their start and power-off steps'],
  ['/#settings','Settings','Settings','Controllers, backups, Wi-Fi, MQTT and updates'],
];
const HUB_NAME_MAX = 40;
// The Android app shows the hub's name in its toolbar; anywhere else this does nothing.
function announceHub() {
  try {window.HarmonyNative?.setHubName(state.config?.hubName||'');} catch {/* no native bridge */}
}
function hubNameForm() {
  return `<form class="hub-name"><label for="hub-name">Hub name</label>
    <div class="hub-name-row"><input id="hub-name" name="hub-name" value="${escape(state.config?.hubName||'')}" maxlength="${HUB_NAME_MAX}" placeholder="Living room" autocomplete="off" autocapitalize="words"><button class="save-button" type="submit">Save</button></div>
    <small>Shown at the top of the app. Leave blank to show the hub’s address.</small></form>`;
}
async function saveHubName(name) {
  const fresh = await api('configuration');
  fresh.hubName = name;
  await api('configuration',{revision:fresh.revision, configuration:fresh});
  state.config = await api('configuration');
  announceHub();
}
function renderSetup(ctx) {
  ctx.content.innerHTML = (owner()?hubNameForm():'')+SETUP_LINKS.map(([href,glyph,name,hint])=>`<div class="row"><a class="row-main" href="${href}"><span class="row-icon neutral">${icon(glyph)}</span><span class="row-text"><strong>${name}</strong><small>${hint}</small></span>${icon('ChevronRight')}</a></div>`).join('');
  if(!owner())return;
  ctx.content.onsubmit = async event => {
    event.preventDefault();
    const name = ctx.content.querySelector('#hub-name').value.trim();
    try {await saveHubName(name);notice(name?'Hub name saved.':'Hub name cleared.');}
    catch(error) {notice(error.message,true);}
  };
}
// ---- Roku (network devices) ----
const ROKU_MODELS = {tv:'Roku TV', player:'Roku player or box'};
const ROKU_LIMIT = 8;  // the hub enforces the same limit
// The same rule the hub applies: only addresses on the home network.
const privateAddress = host => {
  const octet = '(0|[1-9]\\d{0,2})', m = new RegExp(`^${[octet,octet,octet,octet].join('\\.')}$`).exec(host);
  if(!m)return false;
  const [a,b,c,d] = m.slice(1).map(Number);
  return [a,b,c,d].every(n=>n<=255) && (a===10 || (a===172&&b>=16&&b<=31) || (a===192&&b===168));
};
const newRokuId = () => 'roku_'+Array.from({length:4},()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('');
// Every change starts from the hub's current configuration and is one revision-checked write.
async function changeNetworkDevices(change) {
  const fresh = await api('configuration');
  fresh.networkDevices = change([...(fresh.networkDevices||[])]);
  await api('configuration',{revision:fresh.revision, configuration:fresh});
  // The write succeeded. Show it even if the refresh below fails (the next poll catches up).
  state.config = {...fresh, revision:fresh.revision+1};
  try {state.config = await api('configuration');await loadDevices();} catch {/* api() has flagged the connection */}
}
// ---- Favorite channels ----
const ROKU_CHANNELS_MAX = 12;
// A favorite becomes a command named after the channel, so it can't reuse a built-in command's name.
// Keep in step with local_roku.h (test_go_shell fails if they drift), plus the two hidden commands.
const ROKU_BUILTIN_NAMES = ['home','back','up','down','left','right','ok','menu','replay','rewind','play','fast forward','search',
  'power','power on','power off','volume up','volume down','mute','channel up','channel down','tv tuner','hdmi 1','hdmi 2','hdmi 3','hdmi 4','av','deviceinfo','listapps'];
// What the favorites sheet lists. `favorites` is the selection (id → name); `installed` is what the
// Roku reported, or null before it was asked. A channel can't be picked when its name would clash
// with a built-in command or another pick, or when the limit is reached.
function channelChoices(favorites, installed) {
  const list = installed ? installed.filter(c=>c&&typeof c.id==='string'&&typeof c.name==='string').map(c=>({...c})) : [...favorites].map(([id,name])=>({id,name}));
  if(installed)for(const [id,name] of favorites)if(!list.some(c=>c.id===id))list.push({id,name,gone:true});
  const builtin = new Set(ROKU_BUILTIN_NAMES), taken = new Set([...favorites.values()].map(name=>name.toLowerCase()));
  return list.map(c=>{
    const checked = favorites.has(c.id), lower = c.name.toLowerCase();
    let blocked = '';
    if(!checked) {
      if(builtin.has(lower))blocked = 'Name is used by a button';
      else if(taken.has(lower))blocked = 'Same name as another channel';
      else if(favorites.size>=ROKU_CHANNELS_MAX)blocked = `Up to ${ROKU_CHANNELS_MAX}`;
    }
    return {...c, checked, blocked};
  });
}
const channelRowHtml = c => `<li><label class="channel-row${c.blocked?' blocked':''}"><input type="checkbox" data-channel="${escape(c.id)}" data-name="${escape(c.name)}"${c.checked?' checked':''}${c.blocked?' disabled':''}><span>${escape(c.name)}${c.gone?' <small>(not installed)</small>':''}${c.blocked?` <small>${escape(c.blocked)}</small>`:''}</span></label></li>`;
const channelsSheetHtml = name => `<div class="sheet-handle" aria-hidden="true"></div><h2 id="sheet-title">Favorite channels</h2>
  <p class="sheet-note" data-channel-status>Choose up to ${ROKU_CHANNELS_MAX} channels to show as buttons for ${escape(name)}.</p>
  <button class="add-row" type="button" data-find-channels>${icon('RefreshCw')}Find channels on the Roku</button>
  <ul class="channel-list" data-channel-list></ul>
  <div class="sheet-actions"><button class="save-button" type="button" data-save-channels>Save</button><button type="button" class="sheet-cancel sheet-done" data-sheet-cancel>Cancel</button></div>`;
function rokuRow(device) {
  const id = escape(device.id), name = escape(device.name);
  return `<div class="row"><div class="row-main"><span class="row-icon neutral">${icon('MonitorPlay')}</span><span class="row-text"><strong>${name}</strong><small>${escape(ROKU_MODELS[device.model]||'Roku')} · ${escape(device.host)}</small></span></div>
    <button class="row-action" type="button" data-roku-channels="${id}" aria-label="Favorite channels for ${name}" title="Favorite channels">${icon('LayoutGrid')}</button>
    <button class="row-action" type="button" data-roku-test="${id}" aria-label="Test ${name}" title="Test the connection">${icon('RefreshCw')}</button>
    <button class="row-action" type="button" data-roku-remove="${id}" aria-label="Remove ${name}" title="Remove">${icon('Minus')}</button></div>`;
}
function rokuHtml() {
  const list = state.config?.networkDevices||[];
  return `<div class="list">${list.map(rokuRow).join('')||'<div class="placeholder"><p>No Roku yet. Add one below.</p></div>'}</div>
    <form class="card-form"><h2>Add a Roku</h2>
      <label for="roku-name">Name</label><input id="roku-name" name="roku-name" maxlength="64" placeholder="Living room Roku" autocomplete="off" autocapitalize="words" required>
      <label for="roku-model">Type</label><select id="roku-model" name="roku-model">${Object.entries(ROKU_MODELS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select>
      <label for="roku-host">Address</label><input id="roku-host" name="roku-host" inputmode="decimal" placeholder="192.168.1.50" autocomplete="off" required>
      <small>Find it on the Roku under Settings › Network › About, and reserve it in your router so it doesn’t change. Turn on network control on the Roku (Settings › System › Advanced system settings › Control by mobile apps).</small>
      <button class="save-button" type="submit"${list.length>=ROKU_LIMIT?' disabled':''}>Add Roku</button>${list.length>=ROKU_LIMIT?`<small>The hub holds up to ${ROKU_LIMIT} Rokus.</small>`:''}</form>`;
}
function renderRoku(ctx) {
  if(!owner())return placeholder(ctx,'Only the hub owner can add or change a Roku.');
  const draw = () => {ctx.content.innerHTML = rokuHtml();};
  draw();
  const onScreen = () => ctx.content.isConnected && parseRoute(location.hash).name==='roku';
  const say = (message, error=false) => {if(onScreen())notice(message,error);};
  // Pick which of the Roku's channels get a button of their own.
  const openChannels = device => {
    const sheet = $('sheet'), favorites = new Map((device.channels||[]).map(c=>[c.id,c.name]));
    let installed = null, busy = false;
    // An answer can arrive after the sheet was closed (or reused for something else): then there is nothing to update.
    const status = text => {const node = sheet.open && sheet.querySelector('[data-channel-status]');if(node)node.textContent = text;};
    const redraw = () => {const node = sheet.open && sheet.querySelector('[data-channel-list]');if(node)node.innerHTML = channelChoices(favorites,installed).map(channelRowHtml).join('') || '<li class="sheet-note">None chosen yet.</li>';};
    presentSheet(sheet, channelsSheetHtml(device.name), async event => {
      if(busy)return;
      if(event.target.closest('[data-find-channels]')) {
        busy = true;status('Asking the Roku…');
        try {
          const queued = await api('commands/send',{deviceId:device.id, command:'ListApps', transport:'roku', mode:'tap'});
          const apps = (await operation(queued.id,15)).result?.apps;
          // No list at all means the Roku did not answer properly, which is not the same as having no channels.
          if(!Array.isArray(apps))throw Error('The Roku did not list its channels.');
          installed = apps;
          status(`Found ${installed.length} channel${installed.length===1?'':'s'}.`);redraw();
        } catch(error) {status(error.message);}
        finally {busy = false;}
      } else if(event.target.closest('[data-save-channels]')) {
        busy = true;
        const channels = [...favorites].map(([id,name])=>({id,name}));
        try {
          await changeNetworkDevices(list=>list.map(d=>d.id===device.id?{...d,channels}:d));
          sheet.close();
          if(onScreen()){draw();say('Favorite channels saved.');}
        } catch(error) {status(error.message);}
        finally {busy = false;}
      }
    }, event => {
      const box = event.target.closest?.('[data-channel]');
      if(!box||busy)return;  // not while a save is running: what is saved is what was ticked when it started
      if(box.checked)favorites.set(box.dataset.channel,box.dataset.name);else favorites.delete(box.dataset.channel);
      redraw();
    });
    redraw();
  };
  ctx.content.onclick = async event => {
    const test = event.target.closest('[data-roku-test]'), remove = event.target.closest('[data-roku-remove]'), channels = event.target.closest('[data-roku-channels]');
    if(channels) {
      const device = (state.config?.networkDevices||[]).find(d=>d.id===channels.dataset.rokuChannels);
      if(device)openChannels(device);
    } else if(test) {
      const id = test.dataset.rokuTest;
      try {
        say('Asking the Roku…');
        const queued = await api('commands/send',{deviceId:id, command:'DeviceInfo', transport:'roku', mode:'tap'});
        const result = await operation(queued.id,15);
        say(`Connected to ${result.result?.reply||'the Roku'}.`);
      } catch(error) {say(error.message,true);}
    } else if(remove) {
      const id = remove.dataset.rokuRemove, name = (state.config?.networkDevices||[]).find(d=>d.id===id)?.name||'this Roku';
      const using = (state.config?.activities||[]).filter(a=>[...(a.steps||[]),...(a.exitSteps||[]),...(a.screen?.cells||[]),...(a.screen?.pinned||[])].some(x=>x.deviceId===id)).map(a=>a.name);
      if(!confirm(using.length?`Remove ${name}? ${using.join(', ')} still ${using.length===1?'uses':'use'} it and will stop working there until you change ${using.length===1?'it':'them'}.`:`Remove ${name}?`))return;
      try {await changeNetworkDevices(list=>list.filter(d=>d.id!==id));if(onScreen()){draw();say('Removed.');}}
      catch(error) {say(error.message,true);}
    }
  };
  ctx.content.onsubmit = async event => {
    event.preventDefault();
    const name = ctx.content.querySelector('#roku-name').value.trim(), model = ctx.content.querySelector('#roku-model').value, host = ctx.content.querySelector('#roku-host').value.trim();
    if(!name)return say('Give the Roku a name.',true);
    if(!privateAddress(host))return say('Use the Roku’s address on your home network, like 192.168.1.50.',true);
    try {
      await changeNetworkDevices(list=>[...list,{id:newRokuId(), name, kind:'roku', model, host}]);
      if(onScreen()){draw();say('Roku added. Use the refresh button to test it.');}
    } catch(error) {say(error.message,true);}
  };
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
      if(await run(button.dataset.open)){setRunningActivity(button.dataset.open);location.hash=routeHash('activity',button.dataset.open);}
    } else if(button.dataset.fix) {
      // Re-sends the activity's start steps without the usual skip-if-already-on
      // logic; the activity counts as running afterwards, and we stay on the list.
      if(await run(button.dataset.fix,{fixState:true})){setRunningActivity(button.dataset.fix);redraw();say('Device state fixed. It is still an estimate.');}
    } else if('stop' in button.dataset) {
      // "-1" is the hub's power-off request: it runs the running activity's exit steps.
      if(await run('-1')){setRunningActivity('');redraw();}
    }
  };
}
const DEVICE_ICONS = {Television:'Tv', Audio:'Speaker', 'Media Player':'MonitorPlay', Roku:'MonitorPlay'};
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
const CORNERS = ['tl','tr','bl','br'];
const CROSS_SQUARES = ['tl','up','tr','left','ok','right','bl','down','br'];   // the 3x3 block, in reading order
const HARDWARE_ONLY = ['volumeup','volumedown'];
// Icons that read as something else out of context (a bare chevron, +, -): the
// exhaustive device list names these instead.
const NAMED_IN_LIST = ['volumeup','volumedown','channelup','channeldown'];
const GRID_SLOTS = 32;  // keep in step with the server's 32-cell limit
// Buttons carry the grid slot they sit in (`slot`, 0-based). Lists saved before
// that existed fill the lowest free slots in order. Returns copies, sorted by slot.
function withSlots(list, capacity) {
  const used = new Set(), placed = [], loose = [];
  for(const c of list||[]) {
    const copy = {...c};
    if(Number.isInteger(copy.slot)&&copy.slot>=0&&copy.slot<capacity&&!used.has(copy.slot)){used.add(copy.slot);placed.push(copy);}
    else loose.push(copy);
  }
  let next = 0;
  for(const copy of loose){while(used.has(next))next++;if(next>=capacity)break;copy.slot=next;used.add(next);placed.push(copy);}
  return placed.sort((a,b)=>a.slot-b.slot);
}
// The fixed row has no gaps: its buttons sit in slots 0..n-1 in order, so the "+" at
// its right end is also where a new button goes. Sorts and renumbers `list` in place.
function packSlots(list) {
  list.sort((a,b)=>a.slot-b.slot).forEach((c,i)=>{c.slot = i;});
  return list;
}
const visibleEntries = (cells, capacity) => withSlots(cells,capacity).map(cell=>({cell,control:controlFor(cell.command),slot:cell.slot}))
  .filter(e=>resolveCell(e.cell)&&!HARDWARE_ONLY.includes(e.control?.[0]));
// The cross (when all four arrows exist) comes first. Every other button keeps
// its place in the grid, so gaps left on purpose stay gaps; the squares the
// cross's own buttons occupied are not gaps, so they are closed up.
// The editor draws the same split, so what it shows is what the remote shows.
// A complete cross is a 3x3 block: the five cross buttons plus up to four
// corner buttons (cells marked `corner`, which keep a grid slot of their own so
// they return to the grid if the cross breaks up). A square with no button
// reserves the highest unused slot (`spare`, where the editor adds one), at the
// far end of the grid so it never swallows a gap left on purpose.
function crossSplit(entries, occupied) {
  const pick = {};
  for(const key of CROSS)pick[key]=entries.find(e=>e.control?.[0]===key);
  const crossed = ['up','down','left','right'].every(key=>pick[key]);
  const members = crossed ? new Set(Object.values(pick).filter(Boolean)) : new Set();
  const corner = {};
  if(crossed)for(const key of CORNERS){const e=entries.find(x=>!members.has(x)&&x.cell.corner===key);if(e){corner[key]=e;members.add(e);}}
  const vacated = [...members].map(e=>e.slot), spare = {};
  if(crossed){
    const taken = new Set(occupied);
    for(const key of ['ok',...CORNERS]){
      if(pick[key]||corner[key])continue;
      const slot = Array.from({length:GRID_SLOTS},(_,n)=>GRID_SLOTS-1-n).find(n=>!taken.has(n));
      if(slot!==undefined){spare[key]=slot;taken.add(slot);vacated.push(slot);}
    }
  }
  const rest = entries.filter(e=>!members.has(e)).map(e=>({...e, slot:e.slot-vacated.filter(v=>v<e.slot).length}));
  return {crossed, pick, corner, spare, vacated, rest};
}
// `crossRow` is how many grid rows sit above the cross (0: at the top).
const crossRowOf = screen => Number.isInteger(screen?.crossRow)&&screen.crossRow>0 ? Math.min(screen.crossRow,GRID_SLOTS) : 0;
function remoteBlocks(cells, crossRow=0, columns=4) {
  const {crossed, pick, corner, rest} = crossSplit(visibleEntries(cells, GRID_SLOTS), new Set(withSlots(cells,GRID_SLOTS).map(c=>c.slot)));
  const above = rest.filter(e=>Math.floor(e.slot/columns)<crossRow), below = rest.filter(e=>Math.floor(e.slot/columns)>=crossRow);
  const grid = entries => entries.length?[{kind:'grid',entries}]:[];
  return crossed ? [...grid(above), {kind:'cross',pick,corner}, ...grid(below)] : grid(rest);
}
function cellButton({cell,control}, extra='', customFace='') {
  const label = control?.[1] || cell.command;
  // A command with no known icon shows its own name instead of a generic glyph.
  const face = customFace || (control?.[2] ? icon(control[2]) : `<span class="cell-text">${escape(cell.command)}</span>`);
  return `<button class="cell ${extra}" type="button" data-command="${escape(cell.command)}" data-device="${escape(cell.deviceId)}" aria-label="${escape(label)}" title="${escape(label)}">${face}</button>`;
}
const crossHtml = (pick, corner={}) => `<div class="dpad">${CROSS_SQUARES.map(key=>{const e=pick[key]||corner[key];return e?cellButton(e,key):'<span></span>';}).join('')}</div>`;
// Rows of `columns` slots; a row with no buttons is dropped, gaps inside one stay.
function gridHtml(entries, columns) {
  const rows = new Map();
  for(const e of entries){const row=Math.floor(e.slot/columns);if(!rows.has(row))rows.set(row,[]);rows.get(row).push(e);}
  const cells = [...rows.keys()].sort((a,b)=>a-b).flatMap(row=>Array.from({length:columns},(_,col)=>{
    const e = rows.get(row).find(x=>x.slot===row*columns+col);return e?cellButton(e):'<span></span>';}));
  return `<div class="cells" data-columns="${escape(String(columns))}">${cells.join('')}</div>`;
}
// The fixed row: its buttons share the whole width, whether there are four or one.
function pinnedRowHtml(entries) {
  return `<div class="cells pinned-row">${[...entries].sort((a,b)=>a.slot-b.slot).map(e=>cellButton(e)).join('')}</div>`;
}
function remoteHtml(screen) {
  const columns = screen?.columns || 4;
  const body = remoteBlocks(screen?.cells,crossRowOf(screen),columns).map(block=>block.kind==='cross'?crossHtml(block.pick,block.corner):gridHtml(block.entries,columns)).join('');
  // The pinned footer is one row in the order set (no cross), the buttons filling its width.
  const pinned = visibleEntries(screen?.pinned, columns);
  return {body, pinned: pinned.length ? pinnedRowHtml(pinned) : ''};
}

// A device remote shows every command the device has, exactly once: the usual
// controls first (power, cross, back/input/mute), everything else in "All commands".
function deviceRemoteHtml(device) {
  const entry = name => ({cell:{deviceId:device.id,command:name},control:controlFor(name)});
  const slot = key => {const cmd=matchCommand(device.commands||[],CONTROLS.find(c=>c[0]===key)[3]);return cmd&&entry(cmd.name);};
  const shown = new Set(), use = e => {if(e)shown.add(e.cell.command);return e;};
  const on = slot('poweron')||slot('power'), off = slot('poweroff');
  const power = [on&&[on,on.control[0]==='power'?'Power':'On'], off&&[off,'Off']].filter(Boolean);
  let html = power.length ? `<div class="cells power" data-columns="${power.length}">${power.map(([e,text])=>cellButton(use(e),'',`${icon('Power')}<span class="cell-label">${text}</span>`)).join('')}</div>` : '';
  const pick = Object.fromEntries(CROSS.map(key=>[key,slot(key)]));
  if(['up','down','left','right'].every(key=>pick[key])) html += crossHtml(Object.fromEntries(Object.entries(pick).map(([key,e])=>[key,use(e)])));
  const row = ['back','input','mute'].map(slot).filter(Boolean);
  if(row.length) html += `<div class="cells" data-columns="3">${row.map(e=>cellButton(use(e))).join('')}</div>`;
  const rest = (device.commands||[]).filter(c=>!shown.has(c.name));
  if(rest.length) html += `<div class="section-label">All commands</div><div class="cells all" data-columns="4">${rest.map(c=>{const e=entry(c.name);return cellButton(e,'',NAMED_IN_LIST.includes(e.control?.[0])?`<span class="cell-text">${escape(e.control[1])}</span>`:'');}).join('')}</div>`;
  return html;
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
    if(device.transport!=='ir'){stopHold(true);return;}  // only IR has a held transmission
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
    const device=state.devices.find(d=>d.id===id), command=device&&matchCommand(device.commands||[],aliases);
    if(command)return {device, command:command.name};
  }
  return null;
}
window.harmonyHardwareVolume = function(direction) {
  if(!state.online||!state.config||!state.devices.length||hardwareVolumeBusy)return;
  const slot=direction==='up'?'volumeup':'volumedown', route=parseRoute(location.hash);
  // On a device remote the keys drive that device, if it has a volume command;
  // otherwise (or elsewhere) they drive the running activity.
  const device=route.name==='device'&&state.devices.find(d=>d.id===route.params[0]);
  const target=(device&&volumeTarget({steps:[{deviceId:device.id}]},slot))||(activeActivity()&&volumeTarget(activeActivity(),slot));
  if(!target)return;
  hardwareVolumeBusy=true;
  api('commands/send',{deviceId:target.device.id,command:target.command,transport:target.device.transport||'ir',mode:'tap'})
    .then(op=>operation(op.id))
    .catch(error=>notice(error.message,true))
    .finally(()=>{hardwareVolumeBusy=false;});
};

function bindKeyboard(ctx, device) {
  ctx.content.querySelector?.('[data-keyboard]')?.addEventListener('click',()=>openKeyboard(device));
}
function renderDeviceRemote(ctx) {
  const device=state.devices.find(d=>d.id===ctx.params[0]);
  if(!device){ctx.setTitle('Device');return placeholder(ctx,'This device no longer exists.');}
  ctx.setTitle(device.name);
  const html=deviceRemoteHtml(device);
  const typing=keyboardButton(device);
  ctx.content.innerHTML=`<div class="remote">${html||'<div class="placeholder"><p>This device has no commands yet.</p></div>'}</div>${typing?`<div class="pinned">${typing}</div>`:''}`;
  bindCommands(ctx.content);bindKeyboard(ctx,device);
}
function renderActivityRemote(ctx) {
  const activity=(state.config.activities||[]).find(a=>a.id===ctx.params[0]);
  if(!activity){ctx.setTitle('Activity');return placeholder(ctx,'This activity no longer exists.');}
  ctx.setTitle(activity.name);
  if(owner())ctx.actions.innerHTML=`<a class="header-action" href="${routeHash('edit',activity.id)}" aria-label="Edit remote layout" title="Edit remote layout">${icon('Pencil')}</a>`;
  const keyboardDevice = state.devices.find(d=>d.id===activity.keyboard?.deviceId), typing = keyboardButton(keyboardDevice);
  const {body,pinned}=remoteHtml(activity.screen);
  ctx.content.innerHTML=`<div class="remote">${body||'<div class="placeholder"><p>No buttons on this remote yet.</p></div>'}</div>${pinned||typing?`<div class="pinned">${typing}${pinned}</div>`:''}`;
  bindCommands(ctx.content);bindKeyboard(ctx,keyboardDevice);
}
// ---- Keyboard: type on a device from the phone ----
const TYPE_CHUNK = 64;  // the hub accepts this many characters per request
// What to send so a device that holds `sent` ends up with `next`: Backspaces for
// what changed, then the new text. Works the same for typing, deleting and a
// keyboard's autocorrect replacing a word.
function typingPlan(sent, next) {
  const a = Array.from(sent), b = Array.from(next);
  let k = 0;
  while(k<a.length&&k<b.length&&a[k]===b[k])k++;
  return '\b'.repeat(a.length-k)+b.slice(k).join('');
}
// One typing session. Changes are sent in order, one request at a time; whatever
// is typed while a request is running goes out together in the next one.
function createTyper(deviceId, onReset=()=>{}) {
  let sent = '', pending = [], busy = false;
  async function flush() {
    if(busy)return;
    busy = true;
    try {
      while(pending.length) {
        const text = pending.splice(0,TYPE_CHUNK).join('');
        try {const queued=await api('commands/type',{deviceId,text});await operation(queued.id,15);}
        catch(error) {
          // What reached the device is unknown now, so start over rather than type relative to a guess.
          pending = [];sent = '';onReset();
          notice(`${error.message} The box was cleared; check what reached the device.`,true);
        }
      }
    } finally {busy = false;}
  }
  const send = text => {if(text){pending.push(...Array.from(text));flush();}};
  return {
    change(value) {send(typingPlan(sent,value));sent = value;},
    enter() {send('\n');sent = '';},
  };
}
function openKeyboard(device) {
  const sheet = $('sheet');
  presentSheet(sheet, `<div class="sheet-handle" aria-hidden="true"></div><h2 id="sheet-title">Type on ${escape(device.name)}</h2>
    <input id="keyboard-input" class="keyboard-input" type="text" enterkeyhint="send" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Text to type on ${escape(device.name)}">
    <p class="sheet-note">Open a text field on the device first. Letters go as you type them, and Enter presses Enter.</p>
    <button type="button" class="sheet-cancel sheet-done" data-sheet-cancel>Done</button>`);
  const input = sheet.querySelector('#keyboard-input'), typer = createTyper(device.id,()=>{input.value = '';});
  const enter = event => {event.preventDefault();typer.enter();input.value = '';};
  input.oninput = () => typer.change(input.value);
  input.onkeydown = event => {if(event.key==='Enter')enter(event);};
  // Some soft keyboards report their Enter key only as a line-break edit.
  input.onbeforeinput = event => {if(event.inputType==='insertLineBreak')enter(event);};
  // The Android app asks the page before it acts on the hardware Back key.
  window.harmonyHandleBack = () => {if(sheet.open){sheet.close();return true;}return false;};
  input.focus();
}
// The remote's Keyboard button, shown above the fixed row when this device (or the
// activity's keyboard device) can type. Empty when it can't. bindKeyboard() wires it
// up once the markup is on the page.
function keyboardButton(device) {
  if(!device?.keyboard)return '';
  return `<button type="button" class="keyboard-button" data-keyboard aria-label="Type on ${escape(device.name)}">${icon('Keyboard')}Keyboard</button>`;
}
// ---- Edit remote layout (activities only) ----
// The editor works on a local draft of activity.screen: `cells` (the scrolling
// grid) and `pinned` (the footer, at most `columns` buttons). Each button has a
// fixed `slot`; empty slots are only drawn, so removing a button leaves a hole and
// adding goes into the slot that was tapped. Edits change the draft only, which
// lives while the editor is open; Save is the one write to the hub.
const MAX_CELLS = GRID_SLOTS;
const screenOf = activity => {
  activity.screen ||= {columns:4, cells:[]};
  activity.screen.cells ||= [];
  activity.screen.pinned ||= [];
  return activity.screen;
};
const zoneList = (activity, zone) => screenOf(activity)[zone];
const zoneCapacity = (activity, zone) => zone==='pinned' ? (screenOf(activity).columns||4) : MAX_CELLS;
const isPlaced = (activity, deviceId, command) => ['cells','pinned'].some(zone=>zoneList(activity,zone).some(c=>c.deviceId===deviceId&&c.command===command));
// Commands of the devices this activity starts, minus ones already on the remote
// and the volume pair (the hardware keys handle those).
function availableCommands(activity) {
  const ids = [...new Set((activity.steps||[]).map(s=>s.deviceId).filter(Boolean))];
  return ids.flatMap(id=>{
    const device = state.devices.find(d=>d.id===id);
    return (device?.commands||[])
      .filter(c=>!HARDWARE_ONLY.includes(controlFor(c.name)?.[0]) && !isPlaced(activity,device.id,c.name))
      .map(c=>({device, command:c.name, control:controlFor(c.name)}));
  });
}
function addButton(activity, zone, slot, deviceId, command, corner) {
  const list = zoneList(activity, zone);
  if(!(Number.isInteger(slot)&&slot>=0&&slot<zoneCapacity(activity,zone))||list.some(c=>c.slot===slot)||isPlaced(activity,deviceId,command))return false;
  list.push({deviceId, command, slot, ...(CORNERS.includes(corner)?{corner}:{})});
  list.sort((a,b)=>a.slot-b.slot);return true;
}
// Removing leaves the slot empty; nothing else moves. The exception: taking OK
// or a corner button out of a complete cross leaves its square empty but still
// part of the cross, so the slots after it close up and the grid below looks
// exactly as it did.
function removeButton(activity, zone, slot) {
  const list = zoneList(activity, zone), at = list.findIndex(c=>c.slot===slot);
  if(at<0)return false;
  let closeUp = false;
  if(zone==='cells'){
    const all = list.map(cell=>({cell,control:controlFor(cell.command),slot:cell.slot}));
    const {crossed, pick, corner} = crossSplit(all, new Set(all.map(e=>e.slot)));
    closeUp = crossed && [pick.ok,...Object.values(corner)].some(e=>e?.cell===list[at]);
  }
  list.splice(at,1);
  if(closeUp)for(const c of list)if(c.slot>slot)c.slot--;
  if(zone==='pinned')packSlots(list);
  return true;
}
// "Add arrow pad": puts the whole cross on the remote in one tap. Arrows already
// in the grid stay; the missing ones (and OK, when a device has it) come from the
// activity's devices (or the bottom row) and take the highest free slots, which leaves the grid as it
// was because a cross member's slot never shows as a grid square.
// An arrow on the bottom row can't be offered again, so the pad takes it from there.
function pinnedArrow(activity, key) {
  const cell = zoneList(activity,'pinned').find(c=>controlFor(c.command)?.[0]===key);
  return cell && {device:{id:cell.deviceId}, command:cell.command, control:controlFor(cell.command), pinnedSlot:cell.slot};
}
function arrowPadPlan(activity) {
  const list = zoneList(activity,'cells'), offered = availableCommands(activity);
  const has = key => list.some(c=>controlFor(c.command)?.[0]===key);
  if(['up','down','left','right'].every(has))return {add:[], reason:'', crossed:true};
  const add = [];
  for(const key of CROSS){
    if(has(key))continue;
    const found = offered.find(o=>o.control?.[0]===key) || pinnedArrow(activity,key);
    if(found)add.push(found);
    else if(key!=='ok')return {add:[], reason:'This activity’s devices don’t have all four arrow keys.'};
  }
  if(list.length+add.length>MAX_CELLS)return {add:[], reason:'There isn’t room for the arrow pad. Remove a few buttons first.'};
  return {add, reason:''};
}
function addArrowPad(activity) {
  const {add} = arrowPadPlan(activity), list = zoneList(activity,'cells');
  const free = Array.from({length:MAX_CELLS},(_,n)=>MAX_CELLS-1-n).filter(n=>!list.some(c=>c.slot===n));
  if(!add.length||free.length<add.length)return false;
  let allAdded = true;
  add.forEach((o,i)=>{
    if(o.pinnedSlot!==undefined) {
      // Look it up now: taking an earlier one out of the fixed row has already shifted the rest.
      const held = zoneList(activity,'pinned').find(c=>c.deviceId===o.device.id&&c.command===o.command);
      if(held)removeButton(activity,'pinned',held.slot);
    }
    allAdded = addButton(activity,'cells',free[i],o.device.id,o.command) && allAdded;
  });
  return allAdded;
}
// How many slots to draw: out to a full row beyond the last used slot (so there
// is always somewhere to add), plus any "Add row" rows. `extent` is the highest
// used slot + 1.
function editorSlots(zone, extent, columns, extraRows=0, capacity=MAX_CELLS) {
  if(zone==='pinned')return columns;
  const total = Math.ceil((extent+1)/columns)*columns + extraRows*columns;
  return Math.min(total, capacity);
}

// ---- Draft and save ----
// Compared as strings to tell whether a layout changed.
const layoutShape = screen => {const s=cloneScreen(screen);return JSON.stringify([s.columns,s.crossRow,s.cells,s.pinned,s.keyboard]);};
// What the editor compares: the layout plus the keyboard device, which lives on the activity itself.
const editedShape = activity => layoutShape({...activity.screen, keyboard:activity.keyboard?.deviceId||''});
const cloneScreen = screen => {const columns=screen?.columns||4;return {columns, crossRow:crossRowOf(screen), cells:withSlots(screen?.cells,MAX_CELLS), pinned:packSlots(withSlots(screen?.pinned,columns)), keyboard:screen?.keyboard||''};};
// The editor always starts from the hub's current layout. `base` is that
// layout: Save later compares the hub against it, not against whatever it is
// by then, to notice someone else's change.
function startDraft(activity) {
  const draft = cloneScreen({...activity.screen, keyboard:activity.keyboard?.deviceId||''});
  return {draft, base:layoutShape(draft)};
}
// The single write to the hub. It works from the hub's *current* configuration
// (this tab's copy may be hours old), refuses to silently overwrite a layout
// someone else changed since the draft began, and replaces only this
// activity's layout.
async function submitLayout(id, draft, base, confirmReplace) {
  const fresh = await api('configuration');
  const activity = (fresh.activities||[]).find(a=>a.id===id);
  if(!activity)throw Error('This activity no longer exists on the hub.');
  if(editedShape(activity)!==base&&!confirmReplace())return false;
  activity.screen = {...(activity.screen||{}), columns:draft.columns, crossRow:draft.crossRow, cells:draft.cells, pinned:draft.pinned};
  if(draft.keyboard)activity.keyboard = {deviceId:draft.keyboard};else delete activity.keyboard;
  await api('configuration',{revision:fresh.revision, configuration:fresh});
  state.config = await api('configuration');
  return true;
}

function editCellHtml(entry, zone, slot, extra='') {
  if(!entry)return `<button class="cell empty${extra?' '+extra:''}" type="button" data-zone="${zone}" data-slot="${slot}"${CORNERS.includes(extra)?` data-corner="${extra}"`:''} aria-label="Empty slot. Tap to add a button."><svg aria-hidden="true"><use href="/icons.svg#icon-Plus"></use></svg></button>`;
  const control = controlFor(entry.command), live = resolveCell(entry);
  const label = control?.[1] || entry.command;
  const face = control?.[2] ? icon(control[2]) : `<span class="cell-text">${escape(entry.command)}</span>`;
  const note = live ? '' : ' (its device or command no longer exists)';
  return `<button class="cell${extra?' '+extra:''}${live?'':' missing'}" type="button" data-zone="${zone}" data-slot="${slot}" aria-label="${escape(label)}${note}. Press and hold to remove." title="${escape(label)}${note}">${face}</button>`;
}
// The scrolling grid is drawn like the remote: the cross (when all four arrows
// are on the remote) first, then the other buttons with the cross's own squares
// closed up. Squares are numbered by display position; each carries its real slot.
function editGridHtml(activity, ui) {
  const columns = screenOf(activity).columns||4;
  const all = withSlots(zoneList(activity,'cells'),MAX_CELLS).map(cell=>({cell,control:controlFor(cell.command),slot:cell.slot}));
  const {crossed, pick, corner, spare, vacated, rest} = crossSplit(all, new Set(all.map(e=>e.slot)));
  const free = Array.from({length:MAX_CELLS},(_,slot)=>slot).filter(slot=>!vacated.includes(slot));
  const extent = rest.reduce((most,e)=>Math.max(most,e.slot+1),0);
  const slots = editorSlots('cells', extent, columns, ui.extraRows, free.length);
  const squares = Array.from({length:slots},(_,at)=>{const e=rest.find(x=>x.slot===at);return e?editCellHtml(e.cell,'cells',e.cell.slot):editCellHtml(null,'cells',free[at]);});
  const rows = Array.from({length:Math.ceil(squares.length/columns)},(_,row)=>squares.slice(row*columns,(row+1)*columns));
  const crossCell = key => {const e=pick[key]||corner[key];return e?editCellHtml(e.cell,'cells',e.cell.slot,key):spare[key]!==undefined?editCellHtml(null,'cells',spare[key],key):'<span></span>';};
  const at = Math.min(crossRowOf(activity.screen),rows.length);
  // Items top to bottom: grid rows, the cross at its row, and (while choosing a
  // spot) a bar before each row and after the last. Neighbouring rows share one grid.
  const items = [];
  for(let row=0;row<=rows.length;row++){
    if(ui.placing&&!(crossed&&row===at))items.push({bar:row});
    if(crossed&&row===at)items.push({cross:true});
    if(row<rows.length)items.push({row:rows[row]});
  }
  const out = [];let run = [];
  const flush = () => {if(run.length)out.push(`<div class="cells edit-grid" data-columns="${escape(String(columns))}">${run.join('')}</div>`);run=[];};
  for(const item of items){
    if(item.row){run.push(...item.row);continue;}
    flush();
    out.push(item.cross?`<div class="dpad">${CROSS_SQUARES.map(crossCell).join('')}</div>`:`<button class="place-bar" type="button" data-place-row="${item.bar}">Place arrow pad here</button>`);
  }
  flush();
  return out.join('');
}
// The editor's fixed row matches the remote: the buttons share the width, plus one
// "+" square for the next free slot while there is room.
function editPinnedHtml(activity) {
  const list = zoneList(activity,'pinned'), columns = screenOf(activity).columns||4;
  const cells = [...list].sort((a,b)=>a.slot-b.slot).map(c=>editCellHtml(c,'pinned',c.slot));
  if(list.length<columns)cells.push(editCellHtml(null,'pinned',list.length));
  return `<div class="cells pinned-row edit-grid">${cells.join('')}</div>`;
}
// The device whose keyboard this remote's Keyboard button types into.
const keyboardDevices = () => state.devices.filter(d=>d.keyboard);
function keyboardSettingHtml(selected) {
  const devices = keyboardDevices(), missing = selected && !devices.some(d=>d.id===selected);
  return `<div class="keyboard-setting"><label for="keyboard-device">Keyboard</label>
    <select id="keyboard-device" data-keyboard-device${devices.length||selected?'':' disabled'}><option value="">None</option>${devices.map(d=>`<option value="${escape(d.id)}"${d.id===selected?' selected':''}>${escape(d.name)}</option>`).join('')}${missing?`<option value="${escape(selected)}" selected>Missing device</option>`:''}</select>
    <small>${devices.length||selected?'Adds a Keyboard button to this remote that types on this device.':'A device that can type, such as a Roku, has to be added first (Setup › Roku).'}</small></div>`;
}
// What used to be a paragraph above the grid, which pushed the buttons down.
function editorHelpHtml() {
  return `<div class="sheet-handle" aria-hidden="true"></div><h2 id="sheet-title">Editing your remote</h2>
    <ul class="help-list">
      <li>Tap an empty square to add a button.</li>
      <li>Press and hold a button to remove it.</li>
      <li>Add arrow pad puts the arrow keys in a cross; Move arrow pad changes where it sits.</li>
      <li>Add row makes room for more buttons.</li>
      <li>The bottom row stays on screen while you use the remote.</li>
      <li>Nothing changes until you tap Save.</li>
    </ul>
    <button type="button" class="sheet-cancel sheet-done" data-sheet-cancel>Done</button>`;
}
function editorHtml(model, ui) {
  const full = zoneList(model,'cells').length>=MAX_CELLS, pad = arrowPadPlan(model);
  return `${ui.placing?'<p class="edit-hint">Tap where the arrow pad should go.</p>':''}
    ${editGridHtml(model,ui)}
    ${ui.placing?'<button class="add-row" type="button" data-place-cancel>Cancel</button>'
      :pad.crossed?`<button class="add-row" type="button" data-move-pad>${icon('Plus')}Move arrow pad</button>`
      :`<button class="add-row" type="button" data-add-pad ${pad.add.length?'':'disabled'}>${icon('Plus')}Add arrow pad</button>${pad.reason?`<p class="edit-hint">${pad.reason}</p>`:''}`}
    ${full?'<p class="edit-hint">The remote has reached its button limit.</p>':'<button class="add-row" type="button" data-add-row>'+icon('Plus')+'Add row</button>'}
    ${keyboardSettingHtml(model.screen.keyboard)}
    <div class="pinned"><p class="pinned-caption">Fixed bottom row</p>${editPinnedHtml(model)}</div>`;
}

const LONG_PRESS_MS = 350, MOVE_SLOP = 10;
let sheetPushed = false;  // the open add sheet owns one history entry, so Back closes just the sheet
// Shows `html` in the shared bottom sheet. The open sheet owns one history entry, so
// the Back gesture closes just the sheet. Callers deal with their own Back hook.
// Tapping the backdrop or a [data-sheet-cancel] button closes it; `onClick` sees the other taps.
function presentSheet(sheet, html, onClick, onChange=null) {
  sheet.innerHTML = html;
  sheet.onchange = onChange;
  sheet.onclick = event => {
    if(event.target===sheet||event.target.closest('[data-sheet-cancel]'))return sheet.close();
    return onClick?.(event);
  };
  sheet.showModal();
  history.pushState({sheet:true},'');sheetPushed = true;
  sheet.onclose = () => {if(sheetPushed){sheetPushed = false;history.back();}};
  window.onpopstate = () => {if(sheet.open){sheetPushed = false;sheet.close();}};
}
let leaveGuard = null;  // asked before the back arrow leaves a screen; false keeps you there
function renderEditor(ctx) {
  const id = ctx.params[0];
  const activity = () => (state.config.activities||[]).find(a=>a.id===id);
  const first = activity();
  if(!first){ctx.setTitle('Edit remote');return placeholder(ctx,'This activity no longer exists.');}
  ctx.setTitle('Edit remote');
  if(!owner())return placeholder(ctx,'Only the hub owner can change remote layouts.');
  let {draft, base} = startDraft(first);
  const ui = {extraRows:0, dirty:false, saving:false, placing:false}, sheet = $('sheet');
  // The helpers below take an activity-shaped object; the draft stands in for its screen.
  const model = () => ({id, steps:activity()?.steps||first.steps||[], screen:draft});
  const here = () => ctx.content.isConnected && parseRoute(location.hash).name==='edit' && parseRoute(location.hash).params[0]===id;
  const draw = focus => {
    if(!here())return;
    ui.dirty = layoutShape(draft)!==base;
    ctx.actions.innerHTML = `<button type="button" class="header-action" data-help aria-label="How editing works" title="How editing works" ${ui.saving?'disabled':''}>${icon('CircleHelp')}</button><button type="button" class="cancel-button" data-cancel ${ui.saving?'disabled':''}>Cancel</button><button type="button" class="save-button" data-save ${ui.dirty&&!ui.saving?'':'disabled'}>${ui.saving?'Saving…':'Save'}</button>`;
    ctx.content.innerHTML = `<div class="editor">${editorHtml(model(),ui)}</div>`;
    if(focus)ctx.content.querySelector(`[data-zone="${focus.zone}"][data-slot="${focus.slot}"]`)?.focus();
  };
  // A new edit makes any earlier "Saved." message untrue.
  const changed = focus => {notice('');draw(focus);};
  const LEAVE_MESSAGE = 'Leave without saving? Your changes will be lost.';
  leaveGuard = () => layoutShape(draft)===base || confirm(LEAVE_MESSAGE);
  // The Android app asks the page before it acts on the hardware Back key: true
  // means the page dealt with it (closed the add sheet, or the user chose to stay).
  window.harmonyHandleBack = () => {
    if(sheet.open){sheet.close();return true;}
    return layoutShape(draft)!==base && !confirm(LEAVE_MESSAGE);
  };
  const save = async () => {
    if(ui.saving||layoutShape(draft)===base)return;
    ui.saving = true;draw();
    try {
      const saved = await submitLayout(id,draft,base,()=>confirm('This remote was changed on another device since you started editing. Replace it with your version?'));
      if(saved){base=layoutShape(draft);notice('Saved.');if(id===activeActivity()?.id)announceRunning();}
    } catch(error) {notice(`Not saved: ${error.message}`,true);}
    finally {ui.saving=false;draw();}
  };
  // Cancel drops the draft and returns to the remote.
  const cancel = () => {
    if(ui.saving)return;
    if(layoutShape(draft)!==base&&!confirm('Discard your unsaved changes?'))return;
    notice('');location.hash = routeHash('activity',id);
  };
  const openSheet = (zone, slot, corner) => {
    const options = availableCommands(model());
    presentSheet(sheet, `<div class="sheet-handle" aria-hidden="true"></div><h2 id="sheet-title">Add a button</h2>
      ${options.length?`<ul class="sheet-list">${options.map((o,i)=>`<li><button type="button" data-pick="${i}"><span class="sheet-icon">${o.control?.[2]?icon(o.control[2]):''}</span>${escape(o.device.name)}: ${escape(o.command)}</button></li>`).join('')}</ul>`
        :`<p>${(model().steps).some(s=>s.deviceId)?'Every command from this activity’s devices is already on the remote.':'This activity has no devices yet. Add one to its start actions under Manage activities.'}</p>`}
      <button type="button" class="sheet-cancel" data-sheet-cancel>Cancel</button>`,
    event => {
      const pick = event.target.closest('[data-pick]');if(!pick)return;
      const o = options[+pick.dataset.pick];sheet.close();
      if(addButton(model(),zone,slot,o.device.id,o.command,corner))changed({zone,slot});
    });
  };
  const openHelp = () => presentSheet(sheet, editorHelpHtml());
  // Removing leaves an empty slot where the finger was: ignore the click that
  // the finger lifting would otherwise send to it.
  let suppressClickUntil = 0;
  const remove = (button, how) => {
    if(!here())return;
    const zone = button.dataset.zone, slot = +button.dataset.slot;
    if(removeButton(model(),zone,slot)){
      if(how==='hold'){navigator.vibrate?.(20);suppressClickUntil=Date.now()+700;}
      changed({zone,slot});
    }
  };
  // Press-and-hold, shorter than Android's own ~400 ms long-press so our haptic is the first one felt.
  let press = null;
  const cancelPress = () => {if(press){clearTimeout(press.timer);press=null;}};
  ctx.content.onpointerdown = event => {
    const button = event.target.closest('[data-zone]');if(!button||event.button!==0||button.classList.contains('empty'))return;
    cancelPress();
    // Chrome sends pointercancel as soon as a pan starts, even for a few pixels of finger
    // drift, so a cancel alone doesn't end the press; only an actual scroll does.
    const scrollY = window.scrollY;
    press = {button, x:event.clientX, y:event.clientY, timer:setTimeout(()=>{const b=press.button;press=null;if(window.scrollY===scrollY)remove(b,'hold');},LONG_PRESS_MS)};
  };
  ctx.content.onpointermove = event => {if(press&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>MOVE_SLOP)cancelPress();};
  ['onpointerup','onpointerleave'].forEach(name=>{ctx.content[name]=cancelPress;});
  ctx.content.oncontextmenu = event => event.preventDefault();
  // Keyboard has no long-press: Delete/Backspace removes the focused button. An
  // empty slot opens the add sheet from its normal click (Enter/Space included).
  ctx.content.onkeydown = event => {
    const button = event.target.closest?.('[data-zone]');
    if(!button||button.classList.contains('empty')||!['Delete','Backspace'].includes(event.key))return;
    event.preventDefault();remove(button,'key');
  };
  ctx.content.onclick = event => {
    const slotButton = event.target.closest('[data-zone]');
    if(slotButton?.classList.contains('empty')){
      if(Date.now()>=suppressClickUntil&&here())openSheet(slotButton.dataset.zone,+slotButton.dataset.slot,slotButton.dataset.corner);
    } else if(event.target.closest('[data-add-pad]')){ui.placing='add';draw();}
    else if(event.target.closest('[data-move-pad]')){ui.placing='move';draw();}
    else if(event.target.closest('[data-place-cancel]')){ui.placing=false;draw();}
    else if(event.target.closest('[data-place-row]')){
      const row = +event.target.closest('[data-place-row]').dataset.placeRow;
      if(ui.placing==='add'&&!addArrowPad(model())){ui.placing=false;draw();return;}
      draft.crossRow = row;ui.placing = false;changed();
    }
    else if(event.target.closest('[data-add-row]')){ui.extraRows++;draw();}
  };
  ctx.content.onchange = event => {
    if(event.target.closest?.('[data-keyboard-device]')){draft.keyboard = event.target.value;changed();}
  };
  ctx.actions.onclick = event => {if(event.target.closest('[data-save]'))save();else if(event.target.closest('[data-cancel]'))cancel();else if(event.target.closest('[data-help]'))openHelp();};
  draw();
}
function placeholder(ctx, text) {ctx.content.innerHTML=`<div class="placeholder"><p>${escape(text)}</p></div>`;}

function show() {
  const {name, params} = parseRoute(location.hash), screen = screens[name], ctx = {params, content:$('content'), actions:$('header-actions'), setTitle};
  stopHold(false);
  for(const handler of SCREEN_HANDLERS)ctx.content[handler]=null;
  ctx.actions.onclick=null;leaveGuard=null;
  window.onpopstate=null;window.harmonyHandleBack=null;sheetPushed=false;
  if($('sheet')){$('sheet').onclose=null;if($('sheet').open)$('sheet').close();}
  function setTitle(text) {$('title').textContent=text;document.title=text+' · Harmony Remote';}
  $('header-actions').innerHTML='';
  setTitle(screen.title);
  $('back').hidden = !screen.parent;
  $('back').dataset.parent = screen.parent||'';
  $('back').dataset.href = screen.parent ? routeHash(screen.parent,...(screen.parentParams?.(params)||[])) : '';
  document.body.dataset.reserveNotice = String(!!screen.reserveNotice);
  document.body.dataset.screen = name;
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
    announceHub();
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
  $('back').addEventListener('click',()=>{if(leaveGuard&&!leaveGuard())return;location.hash=$('back').dataset.href||routeHash('activities');});
  $('connection').addEventListener('click',()=>{connection(null);boot();});
  sessionTimer=setTimeout(pollSession,15000);
  boot();
}
