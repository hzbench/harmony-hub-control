'use strict';
const $ = id => document.getElementById(id);
const state = {session:null, config:null, devices:[], view:'remote', hold:null, online:false, editor:null, draft:null};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="/icons.svg#icon-${escape(name)}"></use></svg>`;
const owner = () => state.session?.role === 'owner';
const readLocal = (key, fallback='') => {try{return localStorage.getItem(key) || fallback;}catch{return fallback;}};
const writeLocal = (key, value) => {try{localStorage.setItem(key,value);}catch{}};
document.documentElement.dataset.theme = readLocal('harmony-theme','system');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
function notice(message, error=false) { $('notice').textContent=message; $('notice').hidden=!message; $('notice').dataset.error=String(error); }
function connection(online) {state.online=online;$('connection').textContent=online?'Connected':'Disconnected';$('connection').dataset.state=online?'online':'offline';if(!online)stopHold(false);}
async function api(path, body) {
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),path==='commands/learn'?25000:12000);
  try {
    const response=await fetch('/api/v1/'+path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,
      method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Harmony-CSRF':state.session?.csrf||''}:{},body:body?JSON.stringify(body):undefined});
    const result=await response.json(); connection(true);
    if(!response.ok || result.ok===false) {if(response.status===401){state.session=null;stopHold(false);}throw Error(result.error||`Request failed (${response.status})`);}
    return result;
  } catch(error) {if(error.name==='AbortError'||error instanceof TypeError)connection(false);throw error;}
  finally {clearTimeout(timeout);}
}
function mount(html) {stopHold(false);notice('');$('content').innerHTML=html;$('content').setAttribute('aria-busy','false');$('main').focus({preventScroll:true});}
async function busy(button, label, task) {
  if(button.disabled)return;
  const text=button.textContent;button.disabled=true;button.textContent=label;
  try {await task();}catch(error){if(button.isConnected)notice(error.message,true);}
  finally {if(button.isConnected){button.disabled=false;button.textContent=text;}}
}
function field(label,name,value='',type='text',extra='') {return `<label for="${name}">${escape(label)}</label><input id="${name}" name="${name}" type="${type}" value="${escape(value)}" ${extra}>`;}
function deviceOptions(selected='') {return state.devices.map(d=>`<option value="${escape(d.id)}" ${d.id===selected?'selected':''}>${escape(d.name)}</option>`).join('');}
function commandOptions(deviceId,selected='') {const d=state.devices.find(d=>d.id===deviceId);return `<option value="">Choose command</option>`+(d?.commands||[]).map(c=>`<option value="${escape(c.name)}" ${c.name===selected?'selected':''}>${escape(c.name)}</option>`).join('');}
function deviceTypeOptions(selected='Television') {
  const types=['Television','Audio','Media Player','Other'];
  if(!types.includes(selected))types.unshift(selected);
  return types.map(type=>`<option ${type===selected?'selected':''}>${escape(type)}</option>`).join('');
}
const norm = name => String(name).toLowerCase().replace(/\+/g,'up').replace(/-\s*$/,'down').replace(/[^a-z0-9]/g,'');
const controls = [
  ['power','Power','Power',['power','powertoggle','onoff']],['poweron','Power on','Power',['poweron','on']],['poweroff','Power off','Power',['poweroff','off']],
  ['input','Input','LogIn',['inputnext','inputup','input','source']],['up','Up','ChevronUp',['directionup','up','arrowup','uparrow']],['left','Left','ChevronLeft',['directionleft','left','arrowleft','leftarrow']],
  ['ok','OK',null,['ok','select','enter']],['right','Right','ChevronRight',['directionright','right','arrowright','rightarrow']],['down','Down','ChevronDown',['directiondown','down','arrowdown','dnarrow','downarrow']],
  ['back','Back','Undo2',['back','return']],['home','Home','House',['home','smarthome']],['menu','Menu','Menu',['menu','settings','homemenu']],
  ['volumeup','Volume up','Plus',['volumeup','volup']],['volumedown','Volume down','Minus',['volumedown','voldown','voldn']],['mute','Mute','VolumeX',['mute']],
  ['channelup','Channel up','ChevronUp',['channelup','programup','pageup','chnext']],['channeldown','Channel down','ChevronDown',['channeldown','programdown','pagedown','chprev']],
  ['rewind','Rewind','Rewind',['rewind','rew']],['play','Play','Play',['play','playpause']],['pause','Pause','Pause',['pause']],['stop','Stop','Square',['stop']],['guide','Guide','LayoutGrid',['guide','tvguide','epg']],['forward','Fast forward','FastForward',['fastforward','forward']]
];
// Named so a caller that already has a command name in hand (rather than
// a device's command list to search, like matchCommand() below) doesn't
// have to re-derive this same norm()-against-aliases comparison inline.
const aliasMatches = (name,aliases) => aliases.includes(norm(name));
function matchCommand(commands,aliases) {return aliases.map(alias=>commands.find(c=>norm(c.name)===alias)).find(Boolean);}
function defaultLayout(commands) {
  return controls.map(([slot,label,,aliases])=>{const command=matchCommand(commands,aliases)?.name;
    if(slot==='play'&&norm(command)==='playpause')label='Play / pause';
    if(slot==='input'&&['inputup','inputnext'].includes(norm(command)))label='Next input';
    return {slot,label,command};}).filter(b=>b.command);
}
function activeDevice() {return state.devices.find(d=>d.id===readLocal('harmony-device'))||state.devices[0];}
function activeActivity() {return state.config?.activities?.find(a=>a.id===readLocal('harmony-activity'));}
// Shared by remoteButton() and window.harmonyHardwareVolume() so both
// agree on what a device's slot resolves to, including a saved custom
// layout suppressing a slot the owner removed (previously only
// remoteButton enforced this — the hardware-key path could fire a
// command for a button the owner had explicitly hidden).
function resolveSlotCommand(device,key,aliases) {
  const custom=state.config?.layouts?.[device.id]?.find(c=>c.slot===key);
  const layout=state.config?.layouts?.[device.id];
  const command=custom?device.commands.find(c=>c.name===custom.command):layout?null:matchCommand(device.commands,aliases);
  return {command,custom};
}
// Shared by cellButton() (render) and window.harmonyHardwareVolume()'s
// activity branch, which both need to turn a screen cell's stored
// {deviceId,command} back into the live device/command it refers to -
// and silently skip a cell whose device or command no longer exists
// (e.g. the device was deleted) rather than acting on a stale reference.
function resolveCell(c) {
  const device=state.devices.find(d=>d.id===c.deviceId);
  const command=device?.commands.find(cmd=>cmd.name===c.command);
  return command?{device,command}:null;
}
// Shared by the device-layout editor and the activity-screen editor's
// move-up/move-down buttons, which were previously two copies of the
// same swap-and-redraw logic over different arrays.
function bindReorder(root,selector,datasetKey,array,draw) {
  root.querySelectorAll(selector).forEach(e=>e.onclick=()=>{const i=+e.dataset[datasetKey],j=i+(+e.dataset.direction);[array[i],array[j]]=[array[j],array[i]];draw();});
}
function remoteButton(slot,device) {
  const [key,label,image,aliases]=controls.find(c=>c[0]===slot);
  const face=text=>image?icon(image)+(['power','poweron','poweroff','input'].includes(key)?`<span class="label">${escape(text===label?({poweron:'On',poweroff:'Off'}[key]||label):text)}</span>`:''):escape(text);
  const {command,custom}=resolveSlotCommand(device,key,aliases);
  if(!command) return '';
  return `<button class="${escape(key)}" data-command="${escape(command.name)}" data-device="${escape(device.id)}" aria-label="${escape(custom?.label||label)}" title="${escape(custom?.label||label)}">${face(custom?.label||label)}</button>`;
}
// Shared by renderRemote() and renderActivityScreen() — both render the
// same #selected-device dropdown and must react to it identically.
function bindSelectedDeviceChange() {
  $('selected-device').addEventListener('change',e=>{if(e.target.value.startsWith('activity:'))writeLocal('harmony-activity',e.target.value.slice(9));else{writeLocal('harmony-activity','');writeLocal('harmony-device',e.target.value);}renderRemote();});
}
function renderRemote() {
  const activity=activeActivity();
  if(activity)return renderActivityScreen(activity);
  const device=activeDevice();
  if(!device){mount(`<div class="empty"><h2>No devices yet</h2>${owner()?'<button data-action="add-device" class="primary">Add a device</button>':'<p>The owner has not added any devices.</p>'}</div>`);return;}
  writeLocal('harmony-device',device.id);
  const btn=slot=>remoteButton(slot,device);
  mount(`<div class="remote"><label for="selected-device">Device</label><select id="selected-device"><optgroup label="Devices">${deviceOptions(device.id)}</optgroup>${state.config.activities.length?'<optgroup label="Activities">'+state.config.activities.map(a=>`<option value="activity:${escape(a.id)}">${escape(a.name)}</option>`).join('')+'</optgroup>':''}</select>
    <div class="remote-top">${btn('poweron')||btn('power')}${btn('poweroff')}${btn('input')}</div>
    <div class="dpad">${['up','left','ok','right','down'].map(btn).join('')}</div>
    <div class="remote-group">${['back','home','menu','mute'].map(btn).join('')}</div>
    <div class="remote-pairs"><div>${btn('volumeup')||btn('volumedown')?'<small>Volume</small>':''}${btn('volumeup')}${btn('volumedown')}</div><div>${btn('channelup')||btn('channeldown')?'<small>Channel</small>':''}${btn('channelup')}${btn('channeldown')}</div></div>
    <div class="playback">${['rewind','play','pause','stop','forward'].map(btn).join('')}</div>
    <div class="remote-footer"><button data-action="drawer">${icon('List')}<span class="label">All commands</span></button>${owner()?'<button data-action="layout" class="icon-button" aria-label="Edit remote buttons" title="Edit remote buttons">'+icon('SlidersHorizontal')+'</button>':''}</div></div>`);
  bindSelectedDeviceChange();
  bindCommands($('content'));
}
function renderActivityScreen(activity) {
  // Known gap: activities saved under the pre-existing per-slot `buttons`
  // assignment system have no `screen` field and are not migrated here —
  // this just falls back to an empty screen, so their old button layout
  // (and hardware-volume routing, which also only reads `screen.cells`)
  // silently disappears after upgrading. No real activities exist on an
  // unrooted hub yet, so this is deferred rather than fixed now; revisit
  // before this ships to a hub that has `buttons`-based activities saved.
  const screen=activity.screen||{columns:2,cells:[]};
  const cellButton=c=>{
    if(!resolveCell(c))return '';
    return `<button class="screen-cell${c.wide?' wide':''}" data-command="${escape(c.command)}" data-device="${escape(c.deviceId)}" aria-label="${escape(c.label||c.command)}" title="${escape(c.label||c.command)}">${escape(c.label||c.command)}</button>`;
  };
  const cells=(screen.cells||[]).map(cellButton).join('');
  mount(`<div class="remote"><label for="selected-device">Activity</label><select id="selected-device">${state.devices.length?'<optgroup label="Devices">'+deviceOptions('')+'</optgroup>':''}<optgroup label="Activities">${state.config.activities.map(a=>`<option value="activity:${escape(a.id)}" ${a.id===activity.id?'selected':''}>${escape(a.name)}</option>`).join('')}</optgroup></select>
    ${cells?`<div class="screen-grid" data-columns="${escape(String(screen.columns||2))}">${cells}</div>`:`<div class="empty"><p>No buttons on this activity's screen yet.</p></div>`}
    <div class="remote-footer"><button data-action="drawer">${icon('List')}<span class="label">All commands</span></button>${owner()?'<button data-action="edit-activity" data-id="'+escape(activity.id)+'" class="icon-button" aria-label="Edit remote buttons" title="Edit remote buttons">'+icon('SlidersHorizontal')+'</button>':''}</div></div>`);
  bindSelectedDeviceChange();
  bindCommands($('content'));
}
async function operation(id, seconds=45) {
  const deadline=Date.now()+seconds*1000;
  while(Date.now()<deadline) {
    const op=await api('operations?id='+encodeURIComponent(id));
    if(['failed','cancelled','completed'].includes(op.state)) {
      if(op.state==='failed')throw Error(op.result?.error||'The hub could not send this command.');
      return op;
    }
    await sleep(80);
  }
  await api('operations',{id,action:'cancel'});throw Error('Operation timed out and was cancelled.');
}
async function tap(button) {
  if(!state.online)return notice('The hub is disconnected. Check the connection before sending.',true);
  const device=state.devices.find(d=>d.id===button.dataset.device);
  try {notice('Sending...');const op=await api('commands/send',{deviceId:device.id,command:button.dataset.command,transport:device.transport,mode:'tap'});const result=await operation(op.id);notice(result.state==='completed'?'Sent to the hub.':'Command cancelled.');}
  catch(error){notice(error.message,true);}
}
// Hardware volume-key support for the Android WebView wrapper (foreground
// only - see that app's MainActivity.onKeyDown). Resolves the current
// device/activity's volumeup/volumedown slot the same way remoteButton()
// does (via the shared resolveSlotCommand), then sends through the same
// path tap() uses.
let hardwareVolumeBusy = false;
window.harmonyHardwareVolume = function(direction) {
  if (!state.online || !state.config || !state.devices.length || hardwareVolumeBusy) return;
  const slot = direction === 'up' ? 'volumeup' : 'volumedown';
  const [key,,,aliases] = controls.find(c => c[0] === slot);
  const activity = activeActivity();
  let deviceId, command;
  if (activity) {
    // Same `buttons`-migration gap as renderActivityScreen() above. Also
    // skips a cell whose device/command no longer exist (e.g. the device
    // was deleted) instead of silently sending to a stale deviceId, same
    // as cellButton()'s render-time check; keeps looking at the next
    // alias-matching cell rather than giving up on the first stale one.
    // Known, accepted limitation: if an activity's screen has volume
    // cells for two different devices (e.g. a TV and a soundbar both
    // have one), this always picks whichever appears first in `cells` -
    // there's no UI for the owner to say which one the hardware key
    // should control.
    const resolved = (activity.screen?.cells||[])
      .filter(c => aliasMatches(c.command,aliases))
      .map(c => ({deviceId: c.deviceId, resolved: resolveCell(c)}))
      .find(r => r.resolved);
    if (!resolved) return;
    deviceId = resolved.deviceId; command = resolved.resolved.command.name;
  } else {
    const device = activeDevice();
    if (!device) return;
    const {command: resolved} = resolveSlotCommand(device, key, aliases);
    if (!resolved) return;
    deviceId = device.id; command = resolved.name;
  }
  const device = state.devices.find(d => d.id === deviceId);
  hardwareVolumeBusy = true;
  api('commands/send', {deviceId, command, transport: device?.transport || 'ir', mode: 'tap'})
    .then(op => operation(op.id))
    .catch(error => notice(error.message, true))
    .finally(() => { hardwareVolumeBusy = false; });
};
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
    if(device.transport!=='ir'){stopHold(true);return;}
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
function drawer() {
  const activity=activeActivity();
  if(activity){const draw=()=>{stopHold(false);$('extra-commands').innerHTML=(activity.screen?.cells||[]).filter(b=>(b.label||b.command).toLowerCase().includes($('command-search').value.toLowerCase())).map(b=>`<button data-device="${escape(b.deviceId)}" data-command="${escape(b.command)}">${escape(b.label||b.command)}</button>`).join('')||'<p class="no-results">No matching commands.</p>';bindCommands($('extra-commands'));};$('command-search').value='';$('command-search').oninput=draw;draw();$('drawer').showModal();$('command-search').focus();return;}
  const device=activeDevice();if(!device)return;
  const priority=(state.config.layouts[device.id]||[]).map(c=>c.command);
  const ordered=[...device.commands].sort((a,b)=>{const ai=priority.indexOf(a.name),bi=priority.indexOf(b.name);return (ai<0?1000:ai)-(bi<0?1000:bi);});
  const draw=()=>{stopHold(false);$('extra-commands').innerHTML=ordered.filter(c=>c.name.toLowerCase().includes($('command-search').value.toLowerCase())).map(c=>`<button data-device="${escape(device.id)}" data-command="${escape(c.name)}">${escape(c.name)}</button>`).join('')||'<p class="no-results">No matching commands.</p>';bindCommands($('extra-commands'));};
  $('command-search').value='';$('command-search').oninput=draw;draw();$('drawer').showModal();$('command-search').focus();
}
$('close-drawer').addEventListener('click',()=>{stopHold(false);$('drawer').close();});
$('drawer').addEventListener('close',()=>stopHold(false));
function renderDevices() {
  mount(`<div class="toolbar">${owner()?'<button data-action="add-device" class="primary">'+icon('Plus')+' Add device</button>':''}</div><div class="list">${state.devices.map(d=>`<div class="list-row"><div class="text"><strong>${escape(d.name)}</strong>${d.name===`${d.manufacturer} ${d.model}`?'':`<small>${d.transport==='roku'?(d.model==='tv'?'Roku TV':'Roku player'):escape(d.manufacturer||'Bluetooth')+' '+escape(d.model||d.type||'')}</small>`}<small>${d.commands.length} commands${d.transport==='ir'?' - '+escape(deviceTestStatus(d)):''}</small></div><div class="row-actions"><button data-action="open-device" data-id="${escape(d.id)}" title="Open ${escape(d.name)} remote">${icon('Radio')}</button>${owner()?'<button data-action="'+(d.transport==='roku'?'edit-roku':'edit-device')+'" data-id="'+escape(d.id)+'" title="Edit '+escape(d.name)+'">'+icon('SlidersHorizontal')+'</button>':''}</div></div>`).join('')||'<p>No saved devices.</p>'}</div>${owner()&&state.devices.some(d=>d.transport==='roku')?'<p>Rokus are managed under <a href="/go/#/roku">Setup › Roku</a>.</p>':''}`);
}
function deviceTestStatus(device) {
  if(!device.commands.length)return 'No commands yet';
  const record=state.config.deviceSetup?.[device.id];
  return record?.status==='responded'?`${record.testedCommand} confirmed`:record?.status==='no-response'?'Test did not respond':'Not tested here';
}
async function mutate(path,body) {const result=await api(path,{...body,revision:state.config.revision});state.config=await api('configuration');return result;}
async function saveConfig(configuration) {await mutate('configuration',{configuration});}
// A Roku is found and added on the network, in the daily UI's Roku screen (which also renames, tests and removes them).
const ROKU_SCREEN='/go/#/roku';
function renderDeviceEditor(device=null) {
  state.editor=device;state.draft=null;  // this is the Bluetooth form or an existing device, never the infrared setup
  mount(`<div class="editor"><h2>${device?'Edit device':'Add device'}</h2><form id="device-form">${field('Name','device-name',device?.name||'','text','required maxlength="100"')}
    ${!device?'<label for="transport">Control type</label><select id="transport"><option value="ir">Infrared</option><option value="bluetooth">Bluetooth keyboard / supported HID profile</option><option value="roku">Roku (on your network)</option></select>':''}
    <div id="ir-fields" ${device?.transport==='bluetooth'?'hidden':''}><div class="fields"><div>${field('Brand','manufacturer',device?.manufacturer||'','text','required')}</div><div>${field('Model','model',device?.model||'','text','required')}</div></div><label for="device-type">Device type</label><select id="device-type">${deviceTypeOptions(device?.type||'Television')}</select></div>
    <div id="bt-fields" ${device?.transport!=='bluetooth'?'hidden':''}><label for="bt-type">Profile</label><select id="bt-type"><option value="btkeyboard">Bluetooth keyboard</option><option value="fire">Fire TV</option><option value="btkeyboard-nexus">Nexus keyboard</option><option value="ps3">PlayStation 3</option><option value="wii">Nintendo Wii</option></select>${field('Paired address','bt-address',device?.bdaddr||'','text','pattern="[0-9A-Fa-f:]{17}"')}<div class="toolbar"><button type="button" data-action="bt-pair">Start pairing</button><button type="button" data-action="bt-status">Check pairing</button><button type="button" data-action="bt-stop">Finish pairing</button></div><pre id="bt-result" hidden></pre></div>
    <div class="toolbar"><button class="primary" type="submit">${device?'Save device':'Create device'}</button><button type="button" data-action="devices">Cancel</button>${device?'<button type="button" data-action="delete-device" class="danger">Delete device</button>':''}</div></form>
    ${device?'<section class="section"><h2>Commands</h2><div class="toolbar">'+(device.transport==='bluetooth'?'<button data-action="bt-command">Add key command</button>':'<button data-action="import-profile">Import profile</button><button data-action="learn">Learn a command</button><button data-action="search-profile">Find profile</button>')+'<button data-action="layout">Assign buttons</button></div><div class="list">'+device.commands.map(c=>'<div class="list-row"><span>'+escape(c.name)+'</span><button data-device="'+escape(device.id)+'" data-command="'+escape(c.name)+'" title="Send '+escape(c.name)+'">'+icon('Play')+'</button></div>').join('')+'</div></section>':''}</div>`);
  if(device){$('bt-type').value=device.type||'btkeyboard';if(device.transport==='ir')$('device-type').value=device.type||'Television';}
  if(!device){
    // Infrared devices start from a profile (renderProfileChoice); this form is the Bluetooth path.
    $('transport').value='bluetooth';$('ir-fields').hidden=true;$('bt-fields').hidden=false;
    $('manufacturer').required=false;$('model').required=false;
    $('device-form').querySelector('[type=submit]').textContent='Save Bluetooth device';
    $('transport').onchange=()=>{if($('transport').value==='ir')renderProfileChoice();else if($('transport').value==='roku')location.assign(ROKU_SCREEN);};
  }
  if(device?.transport==='bluetooth'){$('manufacturer').required=false;$('model').required=false;}
  $('device-form').onsubmit=async event=>{
    event.preventDefault();await busy(event.submitter,'Saving...',async()=>{
      const transport=device?.transport||$('transport').value;
      const result=await mutate('devices',{action:device?'update':'create',deviceId:device?.id||'',name:$('device-name').value,
        transport,manufacturer:$('manufacturer').value,model:$('model').value,type:transport==='bluetooth'?$('bt-type').value:$('device-type').value,bdaddr:$('bt-address').value});
      await loadDevices();const saved=state.devices.find(d=>d.id===(result.deviceId||device?.id))||state.devices.find(d=>d.name===$('device-name').value);
      if(saved){writeLocal('harmony-device',saved.id);renderDeviceEditor(saved);}else renderDevices();notice('Device saved.');
    });
  };bindCommands($('content'));
  if(device?.transport==='ir'){
    const status=document.createElement('div');status.className='section';
    status.innerHTML=`<p>${escape(deviceTestStatus(device))}</p>${state.config.deviceSetup?.[device.id]?.source?`<p class="profile-source">${escape(state.config.deviceSetup[device.id].source)}</p>`:''}<button data-action="test-device" ${device.commands.length?'':'disabled'}>Test a command</button>`;
    $('device-form').after(status);
  }
}
function renderLayout() {
  const device=state.editor||activeDevice();if(!device)return;
  let rows=structuredClone(state.config.layouts[device.id]||[]);
  if(!state.config.layouts[device.id])rows=defaultLayout(device.commands);
  const draw=()=>{
    mount(`<div class="editor"><h2>Remote buttons</h2><form id="layout-form">${rows.map((r,i)=>`<div class="button-assignment"><select aria-label="Remote control" data-slot="${i}">${controls.map(([slot,label])=>`<option value="${slot}" ${slot===r.slot?'selected':''}>${label}</option>`).join('')}</select><div class="reorder"><input aria-label="Button label" data-label="${i}" value="${escape(r.label)}" maxlength="64"><select aria-label="Command" data-layout-command="${i}">${commandOptions(device.id,r.command)}</select><button type="button" data-move="${i}" data-direction="-1" class="icon-button" title="Move up" ${!i?'disabled':''}>${icon('ChevronUp')}</button><button type="button" data-move="${i}" data-direction="1" class="icon-button" title="Move down" ${i===rows.length-1?'disabled':''}>${icon('ChevronDown')}</button></div><button type="button" data-remove-button="${i}" class="icon-button" title="Remove assignment">${icon('Minus')}</button></div>`).join('')}<div class="toolbar"><button type="button" id="add-assignment">${icon('Plus')} Assign a button</button><button class="primary">Save buttons</button><button type="button" data-action="remote">Cancel</button></div></form></div>`);
    $('content').querySelectorAll('[data-slot]').forEach(e=>e.onchange=()=>rows[+e.dataset.slot].slot=e.value);
    $('content').querySelectorAll('[data-remove-button]').forEach(e=>e.onclick=()=>{rows.splice(+e.dataset.removeButton,1);draw();});
    $('add-assignment').onclick=()=>{const control=controls.find(c=>!rows.some(r=>r.slot===c[0]));if(!control)return notice('Every remote control has an assignment.',true);rows.push({slot:control[0],label:control[1],command:''});draw();};
    $('content').querySelectorAll('[data-label]').forEach(e=>e.oninput=()=>rows[+e.dataset.label].label=e.value);
    $('content').querySelectorAll('[data-layout-command]').forEach(e=>e.onchange=()=>rows[+e.dataset.layoutCommand].command=e.value);
    bindReorder($('content'),'[data-move]','move',rows,draw);
    $('layout-form').onsubmit=async e=>{e.preventDefault();await busy(e.submitter,'Saving...',async()=>{const config=structuredClone(state.config);config.layouts[device.id]=rows.filter(r=>r.command);await saveConfig(config);writeLocal('harmony-device',device.id);writeLocal('harmony-activity','');show('remote');notice('Remote buttons saved.');});};
  };draw();
}
// The steps the user sees. Learning replaces choosing commands from a profile, so it has one fewer.
const SETUP_FLOWS={profile:['Profile','Details','Commands','Review'],learn:['Learn','Details','Review']};
function setupProgress(name) {
  const steps=SETUP_FLOWS[state.draft?.flow==='learn'?'learn':'profile'],current=name==='Learn'||name==='Profile'?0:steps.indexOf(name);
  return `<ol class="setup-progress" aria-label="Device setup">${steps.map((label,i)=>`<li ${i===current?'aria-current="step"':''}>${i+1}. ${label}</li>`).join('')}</ol>`;
}
function returnToDevice() {state.draft?renderProfileChoice():renderDeviceEditor(state.editor);}
// A draft that holds something worth a "discard?" prompt (opening the add flow alone does not).
const draftStarted=()=>!!(state.draft&&(state.draft.commands?.length||state.draft.pending||state.draft.manufacturer||state.draft.model||state.draft.nameInput));
function startDeviceSetup() {state.draft={};state.editor=null;state.retry=null;profileSearch={};renderProfileChoice();}
function renderProfileChoice() {
  const draft=state.draft||={};state.editor=null;draft.flow='profile';
  mount(`<div class="editor">${setupProgress('Profile')}<h2>Add device</h2><label for="transport">Control type</label><select id="transport"><option value="ir">Infrared</option><option value="bluetooth">Bluetooth keyboard / supported HID profile</option><option value="roku">Roku (on your network)</option></select><p>Start from a profile or a remote. You will check the device details next.</p><div class="choice-list"><button class="primary" data-action="search-profile">${icon('Search')} Find a profile</button><button data-action="import-profile">${icon('Archive')} Import a profile file</button><button id="draft-learn">Learn from a remote</button></div>${draft.commands?.length?'<button id="resume-review">Review selected commands</button>':''}<div class="toolbar"><button data-action="devices">Cancel setup</button></div></div>`);
  $('transport').onchange=()=>{if($('transport').value==='bluetooth')renderDeviceEditor();else if($('transport').value==='roku')location.assign(ROKU_SCREEN);};
  $('draft-learn').onclick=()=>renderDraftLearn();
  if($('resume-review'))$('resume-review').onclick=()=>renderSetupReview();
}
// A profile (found or imported) is chosen: show the details it implies, then pick its commands.
// Without a draft this is an existing device getting more commands, so go straight to them.
function chooseProfile(text,path,source,back,meta=null) {
  const draft=state.draft;
  if(!draft)return importProfile(text,path,source,back);
  // After "Try another profile" the details the user already entered stay; otherwise a new profile fills them in.
  if(draft.profilePath!==path)Object.assign(draft,draft.detailsLocked?{profilePath:path}:{profilePath:path,nameInput:'',nameHint:meta?'':path.split('/').pop().replace(/\.[^.]+$/,''),
    manufacturer:meta?.brand||'',model:meta?.model||'',type:meta?.deviceType||profileSearch.type||'',typeKnown:!!meta?.deviceType});
  draft.flow='profile';draft.pending={text,path,source,back};
  renderDraftDetails();
}
function renderDraftDetails() {
  const draft=state.draft,learn=draft.flow==='learn';
  mount(`<div class="editor">${setupProgress('Details')}<h2>Device details</h2>${draft.profilePath&&!learn?`<p class="profile-source">${escape(profileTitle(draft.profilePath))}</p>`:''}<form id="details-form">${field('Name (optional)','device-name',draft.nameInput||'','text',`maxlength="100" placeholder="${escape(draft.nameHint||'Brand and model')}"`)}<div class="fields"><div>${field('Brand','manufacturer',draft.manufacturer||'','text','required')}</div><div>${field('Model','model',draft.model||'','text','required')}</div></div><label for="device-type">Device type</label><select id="device-type">${deviceTypeOptions(draft.type||'Television')}</select>${draft.profilePath&&!learn&&!draft.typeKnown?'<small>This profile does not say what kind of device it is. Check the type.</small>':''}<div class="toolbar"><button class="primary" type="submit">Continue</button><button type="button" id="details-back">Back</button><button type="button" data-action="devices">Cancel setup</button></div></form></div>`);
  window.scrollTo(0,0);
  const keep=()=>{const manufacturer=$('manufacturer').value.trim(),model=$('model').value.trim(),nameInput=$('device-name').value.trim();
    Object.assign(draft,{nameInput,name:nameInput||`${manufacturer} ${model}`,manufacturer,model,type:$('device-type').value});};
  $('details-back').onclick=()=>{keep();learn?renderDraftLearn():draft.pending.back();};
  $('details-form').onsubmit=async event=>{event.preventDefault();keep();
    if(learn){draft.reviewBack=renderDraftDetails;renderSetupReview();return;}
    const {text,path,source}=draft.pending;
    await busy(event.submitter,'Loading...',()=>importProfile(text,path,source,renderDraftDetails));
  };
}
function profilePayload(rows) {return rows.map(r=>`${String(r.name).replace(/[|"\r\n\\]/g,' ').slice(0,96).trim()}|${r.raw?'raw|'+r.raw:r.keycode}`).join('\n');}
async function importProfile(text,path='profile.json',source='custom',back=returnToDevice,selection=null) {
  if(text.length>2*1024*1024)throw Error('Profile is too large.');
  const rows=window.harmonyParseProfile(text,source,path),supported=rows.filter(r=>r.keycode||r.raw);
  if(!supported.length)throw Error('No supported commands found in this file.');
  const device=state.editor,basics=new Set(defaultLayout(supported).map(b=>b.command));
  supported.sort((a,b)=>Number(basics.has(b.name))-Number(basics.has(a.name)));
  const selected=new Set(selection??supported.flatMap((r,i)=>supported.length<=40||basics.has(r.name)?[i]:[]));
  mount(`<div class="editor">${state.draft?setupProgress('Commands'):''}<h2>Choose commands</h2><p class="profile-source">${escape(profileTitle(path))}</p><small>${supported.length} available${rows.length>supported.length?`; ${rows.length-supported.length} unsupported, excluded`:''}</small><form id="profile-form">${field('Filter commands','profile-filter','','search')}<div class="toolbar selection-tools"><button type="button" data-select="basic">Basic controls</button><button type="button" data-select="all">Select all</button><button type="button" data-select="none">Clear</button></div><div id="profile-commands" class="command-selection">${supported.map((r,i)=>`<label class="check-label"><input type="checkbox" name="command" value="${i}" ${selected.has(i)?'checked':''}>${escape(r.name)}</label>`).join('')}</div><div class="toolbar setup-actions"><p id="selection-count" role="status"></p><button class="primary" id="accept-profile">${state.draft?'Review remote':'Save selected commands'}</button><button type="button" id="profile-back">Back</button></div></form></div>`);
  window.scrollTo(0,0);
  const update=()=>{$('selection-count').textContent=`${selected.size} commands selected`;$('accept-profile').disabled=!selected.size;};
  $('profile-commands').onchange=e=>{e.target.checked?selected.add(+e.target.value):selected.delete(+e.target.value);update();};
  $('profile-filter').oninput=e=>{$('profile-commands').querySelectorAll('label').forEach((row,i)=>row.hidden=!supported[i].name.toLowerCase().includes(e.target.value.toLowerCase()));};
  $('content').querySelectorAll('[data-select]').forEach(button=>button.onclick=()=>{
    selected.clear();supported.forEach((r,i)=>{if(button.dataset.select==='all'||button.dataset.select==='basic'&&basics.has(r.name))selected.add(i);});
    $('profile-commands').querySelectorAll('input').forEach(input=>input.checked=selected.has(+input.value));update();
  });
  $('profile-back').onclick=back;update();
  $('profile-form').onsubmit=async event=>{event.preventDefault();await busy(event.submitter,'Saving...',async()=>{
    const commands=supported.filter((r,i)=>selected.has(i));
    if(state.draft){
      const layout=selection?state.draft.layout.filter(b=>commands.some(c=>c.name===b.command)):defaultLayout(commands);
      Object.assign(state.draft,{commands,source:path,layout,reviewBack:()=>importProfile(text,path,source,back,[...selected])});renderSetupReview();return;
    }
    await mutate('commands/import',{deviceId:device.id,payload:profilePayload(commands)});await loadDevices();state.editor=state.devices.find(d=>d.id===device.id);renderDeviceEditor(state.editor);notice('Commands saved locally.');
  });};
}
function renderImport() {
  mount(`<div class="editor">${state.draft?setupProgress('Profile'):''}<h2>Import a profile</h2><label for="profile-file">Profile file (up to 2 MB)</label><input id="profile-file" type="file" accept=".json,.ir,.csv,.conf,.xml,.txt,.girr"><small>Flipper IR, Pronto, LIRC, GIRR, CSV or JSON</small><div class="toolbar"><button id="import-back">Back</button></div></div>`);
  $('import-back').onclick=returnToDevice;
  $('profile-file').onchange=async event=>{const input=event.target;try{const file=input.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('Profile exceeds the 2 MB import limit.');const text=await file.text();if(input.isConnected)await chooseProfile(text,file.name,'custom',renderImport);}catch(error){if(input.isConnected)notice(error.message,true);}};
}
const profileNorm=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
function profileTitle(path) {return path.split('/').pop().replace(/\.ir$/i,'').replace(/_/g,' ');}
// The community index (Flipper-IRDB) is a git tree. Hand-curated profiles are Category/Brand/Model.ir (a few have
// an extra level). _Converted_/Format/Letter/Brand[/Kind]/File.ir holds ~7,000 converted ones with no category;
// the CSV ones name a kind of device in the folder before the file.
const PROFILE_TYPES=['Television','Audio','Media Player','Other'];
const TYPE_BY_CATEGORY={TVs:'Television',Projectors:'Television',Monitors:'Television',Touchscreen_Displays:'Television',Digital_Signs:'Television',
  Audio_and_Video_Receivers:'Audio',SoundBars:'Audio',Speakers:'Audio',CD_Players:'Audio',MiniDisc:'Audio',Car_Multimedia:'Audio',
  'Blu-Ray':'Media Player',DVD_Players:'Media Player',Streaming_Devices:'Media Player',Cable_Boxes:'Media Player',VCR:'Media Player',Laserdisc:'Media Player',Consoles:'Media Player',TV_Tuner:'Media Player','DVB-T':'Media Player'};
const KIND_WORDS=[['Media Player',['dvd','vcr','bluray','blu','cable','catv','satellite','sat','stb','dvr','tivo','player','streaming','console','settop']],
  ['Television',['tv','tvs','hdtv','television','projector','monitor','display']],['Audio',['audio','receiver','amplifier','amp','stereo','tuner','cd','speaker','soundbar']]];
function profileMeta(path) {
  const p=path.split('/'),converted=p[0]==='_Converted_';
  let brand='',kind='';
  if(converted){brand=p[3]||'';kind=p.length>5?p[4]:'';}
  else if(p[0]==='Car_Multimedia'&&p.length>3)brand=p[2];
  else if(p.length>2)brand=p[1];
  brand=brand.replace(/_/g,' ');
  const title=profileTitle(path),bn=profileNorm(brand);
  let model=title;
  if(bn&&profileNorm(title).startsWith(bn)){let seen='',n=0;while(n<title.length&&seen.length<bn.length){seen+=profileNorm(title[n]);n++;}model=title.slice(n).replace(/^[\s_:-]+/,'')||title;}
  if(kind&&!/^unknown/i.test(kind))model=`${kind.replace(/_/g,' ')} ${model}`;
  if(bn&&profileNorm(model)===bn)model='';   // the brand's generic profile has no model of its own
  // A converted profile has no category. Its device-kind folder (CSV ones) or else its file name may say what it is.
  const typeOfWords = text => {const words=text.toLowerCase().split(/[^a-z0-9]+/);return KIND_WORDS.find(([,list])=>list.some(w=>words.includes(w)))?.[0]||'';};
  const deviceType=converted?(typeOfWords(kind)||typeOfWords(title)):TYPE_BY_CATEGORY[p[0]]||'Other';
  return {brand,model,deviceType,curated:!converted};
}
function findProfiles(tree,{type='',brand='',model=''}) {
  const b=profileNorm(brand),m=profileNorm(model),tokens=model.split(/\s+/).map(profileNorm).filter(Boolean);
  if(!type&&!b&&!tokens.length)return [];
  return tree.filter(f=>f.type==='blob'&&f.path.endsWith('.ir')).map(f=>({...f,...profileMeta(f.path)}))
    // A chosen type keeps profiles of that type, and also those that do not say (listed after the ones that do).
    .filter(f=>(!type||f.deviceType===type||!f.deviceType)&&(!b||profileNorm(f.brand).includes(b))&&tokens.every(t=>profileNorm(f.path).includes(t)))
    .map(f=>({...f,brandExact:!!b&&profileNorm(f.brand)===b,exact:!!m&&profileNorm(f.model)===m,typed:!type||f.deviceType===type}))
    .sort((a,c)=>Number(c.typed)-Number(a.typed)||Number(c.brandExact)-Number(a.brandExact)||Number(c.exact)-Number(a.exact)||Number(c.curated)-Number(a.curated)||a.path.localeCompare(c.path));
}
// The model isn't in the index, but the brand often is: rank that brand's profiles by how likely they are to
// match, so a near miss is still a short list. This is a guess from the names, which is why the user tests.
function similarProfiles(tree,filters) {
  const m=profileNorm(filters.model),b=profileNorm(filters.brand),generation=(filters.model.match(/[-_ ]?([a-z])\d*$/i)||[])[1]?.toLowerCase();
  const prefix=(a,c)=>{let n=0;while(n<a.length&&a[n]===c[n])n++;return n;};
  const files=findProfiles(tree,{type:filters.type,brand:filters.brand}).map(f=>{
    const name=profileNorm(f.model),generic=!name||name===b||/generic|universal/i.test(f.model);
    const sameGeneration=!!generation&&new RegExp(`[-_ ]${generation}\\d*$`,'i').test(f.model);
    return {...f,generic,sameGeneration,score:(generic?6:0)+(sameGeneration?4:0)+prefix(m,name)+(f.curated?1:0)};
  });
  return files.sort((a,c)=>c.score-a.score||a.path.localeCompare(c.path));
}
const profileLabel=f=>`${`${f.brand} ${f.model||'generic profile'}`.trim()}${f.deviceType?` (${f.deviceType})`:''}`;
let profileIndex,profileSearch={};
async function loadProfileIndex() {
  if(profileIndex)return profileIndex;
  const response=await fetch('https://api.github.com/repos/Lucaslhm/Flipper-IRDB/git/trees/main?recursive=1',{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Community search is unavailable. Go back to import a profile file.');
  const index=await response.json();if(index.truncated)throw Error('Community index is incomplete. Import a profile file instead.');
  return profileIndex=index.tree||[];
}
function renderSearch(again=false) {
  const device=state.draft?null:state.editor;
  // Changing an existing device's commands starts from that device; a new one starts from what was last searched.
  if(device&&!Object.keys(profileSearch).length)profileSearch={type:device.type||'',brand:device.manufacturer||'',model:device.model||''};
  const filters=profileSearch;
  mount(`<div class="editor">${state.draft?setupProgress('Profile'):''}<h2>Find a profile</h2><form id="search-form"><label for="profile-type">Device type</label><select id="profile-type"><option value="">Any type</option>${PROFILE_TYPES.map(t=>`<option ${t===filters.type?'selected':''}>${t}</option>`).join('')}</select><div class="suggest">${field('Brand','profile-brand',filters.brand||'','search','autocomplete="off"')}<div id="brand-suggestions" class="suggestions" role="listbox" aria-label="Matching brands" hidden></div></div>${field('Model or keywords','profile-model',filters.model||'','search')}<small>Fill in any of these. Many community profiles do not say what type of device they are. With a type chosen, those are listed after the ones that match.</small><div class="toolbar"><button class="primary">Search</button><button type="button" id="search-back">Back</button></div></form><div id="profile-results" class="list"></div></div>`);
  $('search-back').onclick=returnToDevice;
  const results=$('profile-results'),form=$('search-form');
  // Brand suggestions come from the index; fetching it early is a convenience, and a failure shows up on Search.
  // (A native <datalist> is drawn by the browser and loses its background in the app's dark theme, so this is a plain list.)
  let brands=[];
  loadProfileIndex().then(tree=>{const seen=new Map();for(const f of tree)if(f.type==='blob'&&f.path.endsWith('.ir')){const {brand}=profileMeta(f.path);if(brand&&!seen.has(profileNorm(brand)))seen.set(profileNorm(brand),brand);}
    brands=[...seen.values()].sort((a,b)=>a.localeCompare(b));suggest();}).catch(()=>{});
  const box=$('brand-suggestions'),brandInput=$('profile-brand');
  const suggest=()=>{
    const typed=profileNorm(brandInput.value),matches=!typed?[]:[...brands.filter(b=>profileNorm(b).startsWith(typed)),...brands.filter(b=>!profileNorm(b).startsWith(typed)&&profileNorm(b).includes(typed))].filter(b=>profileNorm(b)!==typed).slice(0,8);
    box.innerHTML=matches.map(b=>`<button type="button" role="option" data-brand="${escape(b)}">${escape(b)}</button>`).join('');box.hidden=!matches.length;
  };
  brandInput.oninput=suggest;
  box.onclick=event=>{const b=event.target.closest('[data-brand]');if(!b)return;brandInput.value=b.dataset.brand;box.hidden=true;$('profile-model').focus();};
  form.onsubmit=async event=>{event.preventDefault();
    profileSearch={type:$('profile-type').value,brand:$('profile-brand').value.trim(),model:$('profile-model').value.trim()};
    if(!profileSearch.type&&!profileSearch.brand&&!profileSearch.model)return notice('Enter a brand, a model or a device type.',true);
    await busy(event.submitter||form.querySelector('button.primary'),'Searching...',async()=>{
    results.textContent='';
    const tree=await loadProfileIndex();
    if(!results.isConnected)return;
    $('brand-suggestions').hidden=true;
    let files=findProfiles(tree,profileSearch),closest=false;
    // A model that is not in the index: show what the brand (and type) does have, closest first.
    if(!files.length&&profileSearch.model&&(profileSearch.brand||profileSearch.type)){files=similarProfiles(tree,profileSearch);closest=files.length>0;}
    // Profiles already tried on this device that did not respond go to the end, marked.
    const tried=new Set(state.retry?.tried||[]);
    files=[...files.filter(f=>!tried.has(f.path)),...files.filter(f=>tried.has(f.path))];
    let limit=20;
    const draw=()=>{
      const why=f=>tried.has(f.path)?'Already tried: no response':closest?(f.generic?'Generic profile for this brand':f.sameGeneration?'Same generation as '+escape(profileSearch.model):'Other model from this brand'):f.exact?'Model name matches':'Other model / generic profile';
      results.innerHTML=`<p>${closest?`No profile for ${escape(profileSearch.model)}. These are the closest ${escape(profileSearch.brand||'')} profiles, best guess first. Try one and test it.`:files.length?`${files.length} ${files.length===1?'profile':'profiles'}. Compatibility needs a device test.`:profileSearch.model&&!profileSearch.brand&&!profileSearch.type?'No matching profile. Add the brand to see that brand’s profiles.':'No matching profile.'}</p>${files.slice(0,limit).map((f,i)=>`<div class="list-row"><div class="text"><strong>${escape(profileLabel(f))}</strong><small>${why(f)}</small><small>${escape(f.path.split('/').slice(0,-1).join(' / ').replace(/_/g,' '))}</small></div><button data-profile="${i}" aria-label="Choose ${escape(profileLabel(f))}">Choose</button></div>`).join('')}${files.length>limit?`<div class="toolbar"><button id="more-profiles">Show more (${files.length-limit} remaining)</button></div>`:''}`;
      if($('more-profiles'))$('more-profiles').onclick=()=>{limit+=20;draw();};
      results.querySelectorAll('[data-profile]').forEach(button=>button.onclick=()=>busy(button,'Loading...',async()=>{
        const file=files[+button.dataset.profile],path=file.path;
        const response=await fetch('https://raw.githubusercontent.com/Lucaslhm/Flipper-IRDB/main/'+path.split('/').map(encodeURIComponent).join('/'),{signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw Error('Profile download failed. Choose another profile or import a file.');
        const text=await response.text();// A stand-in for a model that isn't indexed: the details are the user's TV, not the profile's.
        if(results.isConnected)await chooseProfile(text,path,'flipper',()=>renderSearch(true),closest?{...file,model:profileSearch.model}:file);
      }));
    };draw();
  });};
  // Coming back from a later step: show the same results again.
  if(again&&profileIndex&&(filters.type||filters.brand||filters.model))form.requestSubmit();
}
function renderDraftLearn() {
  const draft=state.draft;
  draft.flow='learn';
  mount(`<div class="editor">${setupProgress('Learn')}<h2>Learn a command</h2><form id="draft-learn-form">${field('Command name','draft-command','','text','required maxlength="96"')}<div class="toolbar"><button class="primary">Capture signal</button><button type="button" id="learn-back">Back</button></div></form><div id="learned-commands" class="list"></div><button id="review-learned" ${draft.commands?.length?'':'disabled'}>Continue</button></div>`);
  const draw=()=>{$('learned-commands').textContent=(draft.commands||[]).map(c=>c.name).join(', ');$('review-learned').disabled=!draft.commands?.length;};draw();
  $('learn-back').onclick=returnToDevice;$('review-learned').onclick=()=>renderDraftDetails();
  $('draft-learn-form').onsubmit=async event=>{event.preventDefault();const name=$('draft-command').value.trim(),form=event.target;
    if(draft.commands?.some(c=>c.name===name))return notice('That command name is already in this profile.',true);
    await busy(event.submitter,'Listening...',async()=>{const result=await api('commands/learn',{});if(!form.isConnected)return;
      if(!result.raw)throw Error('No replayable signal captured. Try again.');
      draft.commands||=[];draft.commands.push({name,raw:result.raw});draft.source=draft.source&&draft.source!=='Learned from remote'?'Imported profile and learned commands':'Learned from remote';draft.layout=defaultLayout(draft.commands);draft.reviewBack=renderDraftLearn;draw();notice('Command captured.');
    });
  };
}
function renderSetupReview() {
  const draft=state.draft;
  const assigned=new Set(draft.layout.map(b=>b.slot));
  const row=([slot,label,image])=>`<label class="review-control" for="review-${slot}"><span>${image?icon(image):''}${label}</span><select id="review-${slot}" data-review="${slot}"><option value="">Not on remote</option>${draft.commands.map(c=>`<option value="${escape(c.name)}" ${draft.layout.some(b=>b.slot===slot&&b.command===c.name)?'selected':''}>${escape(c.name)}</option>`).join('')}</select></label>`;
  mount(`<div class="editor">${setupProgress('Review')}<h2>Review ${escape(draft.name)}</h2><p>${draft.commands.length} commands - not tested</p><small class="profile-source">${escape(profileTitle(draft.source||''))}</small><form id="setup-review"><div class="review-controls">${controls.filter(c=>assigned.has(c[0])).map(row).join('')}</div><details><summary>More remote buttons</summary><div class="review-controls">${controls.filter(c=>!assigned.has(c[0])).map(row).join('')}</div></details><div class="toolbar"><button class="primary" name="finish" value="test">Save and test</button><button name="finish" value="later">Save without testing</button><button type="button" id="setup-review-back">Back</button></div></form></div>`);
  window.scrollTo(0,0);$('setup-review-back').onclick=draft.reviewBack||returnToDevice;
  $('content').querySelectorAll('[data-review]').forEach(input=>input.onchange=()=>{
    draft.layout=draft.layout.filter(b=>b.slot!==input.dataset.review);
    if(input.value)draft.layout.push({slot:input.dataset.review,label:controls.find(c=>c[0]===input.dataset.review)[1],command:input.value});
  });
  $('setup-review').onsubmit=async event=>{event.preventDefault();const form=event.target,finish=event.submitter.value;
    // Lock both save buttons: a second click must not create a second device.
    if(form.dataset.saving)return;form.dataset.saving='true';
    form.querySelectorAll('button').forEach(b=>b.disabled=true);notice('Saving device...');
    let saved=false;
    try {
      const payload={action:'create-profile',transport:'ir',name:draft.name,manufacturer:draft.manufacturer,model:draft.model,type:draft.type,payload:profilePayload(draft.commands),layout:draft.layout,source:draft.source||''};
      if(new TextEncoder().encode(JSON.stringify(payload)).length>500000)throw Error('Selected commands exceed the hub request limit. Choose fewer commands.');
      // Keep the create result even if refreshing the inventory fails.
      const result=await api('devices',{...payload,revision:state.config.revision});saved=true;state.draft=null;
      // If the test finds no response, "Try another profile" needs the details entered and the profiles already tried.
      state.retry=draft.flow==='profile'?{deviceId:result.deviceId,tried:[...(state.retry?.tried||[]),draft.profilePath].filter(Boolean),
        details:{nameInput:draft.nameInput||'',name:draft.name,manufacturer:draft.manufacturer,model:draft.model,type:draft.type,typeKnown:draft.typeKnown}}:null;
      writeLocal('harmony-device',result.deviceId);writeLocal('harmony-activity','');
      state.config=await api('configuration');await loadDevices();
      const device=state.devices.find(d=>d.id===result.deviceId);
      if(finish==='test')renderDeviceTest(device);else{show('remote');notice('Device saved. No commands were sent.');}
    }catch(error){
      notice(saved?'Device saved, but the view could not refresh. Reconnect to open it.':error.message,true);
      if(!saved&&form.isConnected){delete form.dataset.saving;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
    }
  };
}
function renderDeviceTest(device) {
  if(!device)return;
  state.editor=device;
  const preferred=matchCommand(device.commands,['volumedown','voldown','voldn']);
  mount(`<div class="editor"><h2>Test ${escape(device.name)}</h2><p>${escape(deviceTestStatus(device))}</p><label for="test-command">Command</label><select id="test-command"><option value="">Choose a command</option>${device.commands.map(c=>`<option ${c.name===preferred?.name?'selected':''}>${escape(c.name)}</option>`).join('')}</select><div class="toolbar"><button id="send-test" class="primary">Send once</button></div><div id="test-response" hidden><p>Did the device respond?</p><div class="toolbar"><button id="test-yes">Yes</button><button id="test-no">No</button></div></div><div class="toolbar"><button data-action="open-device" data-id="${escape(device.id)}">Open remote</button><button data-action="edit-device" data-id="${escape(device.id)}">Back to device</button></div></div>`);
  const select=$('test-command'),response=$('test-response');let sent='';
  $('send-test').disabled=!select.value;select.onchange=()=>{sent='';response.hidden=true;$('send-test').disabled=!select.value;};
  $('send-test').onclick=event=>busy(event.currentTarget,'Sending...',async()=>{
    response.hidden=true;sent='';const command=select.value;select.disabled=true;
    try{const op=await api('commands/send',{deviceId:device.id,command,transport:'ir',mode:'tap'});const result=await operation(op.id);
      if(!response.isConnected)return;if(result.state!=='completed')throw Error('Command was cancelled.');
      sent=command;response.hidden=false;notice('Sent to the hub.');
    }finally{select.disabled=false;}
  });
  for(const [id,status] of [['test-yes','responded'],['test-no','no-response']])$(id).onclick=event=>busy(event.currentTarget,'Saving...',async()=>{
    if(!sent)return;const command=sent;sent='';
    try{const config=structuredClone(state.config);config.deviceSetup||={};config.deviceSetup[device.id]={...config.deviceSetup[device.id],status,testedCommand:command};await saveConfig(config);
      if(status==='responded')state.retry=null;
      if(status==='no-response'&&retryAvailable(device)){renderTestFailed(device);return;}
      renderDeviceEditor(device);notice(status==='responded'?`${command} confirmed. Other commands are not yet tested.`:'No response recorded. Check the profile and try again.');}
    catch(error){sent=command;throw error;}
  });
}
// A device just made in the wizard can be swapped for another profile, but only while nothing uses it.
function deviceInUse(id) {
  return (state.config.activities||[]).some(a=>[...(a.steps||[]),...(a.exitSteps||[])].some(step=>step.deviceId===id)
    ||[...(a.screen?.cells||[]),...(a.screen?.pinned||[])].some(cell=>cell.deviceId===id));
}
const retryAvailable = device => state.retry?.deviceId===device.id&&!deviceInUse(device.id);
function renderTestFailed(device) {
  mount(`<div class="editor"><h2>No response from ${escape(device.name)}</h2><p>The profile may not match this device. Try another one: this device is removed, and the details you entered are kept.</p><div class="toolbar"><button class="primary" id="try-another">Try another profile</button><button id="keep-device">Keep this device</button></div></div>`);
  $('try-another').onclick=event=>busy(event.currentTarget,'Removing...',()=>tryAnotherProfile(device));
  $('keep-device').onclick=()=>{renderDeviceEditor(device);notice('No response recorded. Check the profile and try again.');};
}
async function tryAnotherProfile(device) {
  const retry=state.retry;
  if(!retry||retry.deviceId!==device.id)throw Error('This device was not just created, so it cannot be swapped here.');
  if(deviceInUse(device.id))throw Error('An activity uses this device. Remove it there first, or keep it.');
  await mutate('devices',{action:'delete',deviceId:device.id,transport:device.transport||'ir'});
  await loadDevices();
  state.retry={...retry,deviceId:null};
  state.editor=null;state.draft={flow:'profile',...retry.details,detailsLocked:true};
  renderSearch(true);
  notice('Removed. Choose another profile; your details are kept.');
}
function updateLearnSave() {
  const mode=$('learn-mode').value;
  $('save-learned').disabled=!$('learn-name').value.trim()||!(mode==='raw'?$('learn-raw').value.trim():$('learn-code').value.trim())||(mode==='keycode'&&!$('learn-protocol').value.trim());
}
function renderLearn() {
  const device=state.editor||activeDevice();if(!device)return;
  mount(`<div class="editor"><h2>Learn a command</h2><form id="learn-form">${field('Command name','learn-name','','text','required maxlength="96"')}<div class="toolbar"><button type="button" data-action="capture" class="primary">Capture signal</button></div><p id="capture-result">Waiting for a signal.</p><details><summary>Advanced</summary><label for="learn-mode">Format</label><select id="learn-mode"><option value="raw">Raw timing</option><option value="keycode">Harmony code</option><option value="nec">NEC</option></select>${field('Protocol','learn-protocol','2')}${field('Code','learn-code')}<label for="learn-raw">Captured data</label><textarea id="learn-raw"></textarea></details><div class="toolbar"><button id="save-learned" disabled>Save command</button><button type="button" data-action="devices">Cancel</button></div></form></div>`);
  $('learn-form').oninput=updateLearnSave;$('learn-mode').onchange=updateLearnSave;
  $('learn-form').onsubmit=async event=>{event.preventDefault();try{await mutate('commands/save',{deviceId:device.id,name:$('learn-name').value,mode:$('learn-mode').value,protocol:$('learn-protocol').value,nec:$('learn-mode').value==='nec'?$('learn-code').value:'',keycode:$('learn-mode').value==='keycode'?$('learn-code').value:'',raw:$('learn-raw').value});await loadDevices();state.editor=state.devices.find(d=>d.id===device.id);renderDeviceEditor(state.editor);notice('Command saved.');}catch(error){notice(error.message,true);}};
}
function renderBluetoothCommand() {
  const device=state.editor;
  const keys=['up','down','left','right','enter','escape','backspace','home','space','tab','menu','pageup','pagedown'];
  mount(`<div class="editor"><h2>Add key command</h2><form id="key-form">${field('Command name','key-name','','text','required maxlength="96"')}<label for="key-choice">Key</label><select id="key-choice">${keys.map(k=>`<option>${k}</option>`).join('')}</select><div class="toolbar"><button class="primary">Save command</button><button type="button" data-action="devices">Cancel</button></div></form></div>`);
  $('key-form').onsubmit=async e=>{e.preventDefault();try{await mutate('commands/save',{transport:'bluetooth',deviceId:device.id,name:$('key-name').value,script:'KEY '+$('key-choice').value,delayMs:35});await loadDevices();renderDeviceEditor(state.devices.find(d=>d.id===device.id));notice('Key saved.');}catch(error){notice(error.message,true);}};
}
function renderActivities() {
  mount(`<div class="toolbar">${owner()?'<button data-action="new-activity" class="primary">'+icon('Plus')+' Add activity</button>':''}</div><div class="list">${state.config.activities.map(a=>`<div class="list-row"><div class="text"><strong>${escape(a.name)}</strong></div><div class="row-actions">${owner()?'<button data-action="edit-activity" data-id="'+escape(a.id)+'" title="Edit activity">'+icon('SlidersHorizontal')+'</button>':''}</div></div>`).join('')||'<p>No local activities.</p>'}</div>${owner()?'<details><summary>Imported native activities</summary><button data-action="native-activities">Show original configuration</button><pre id="native-activities" hidden></pre></details>':''}`);
}
function activityStep(step,group,index) {
  const ref=`${group}:${index}`,id=`${group}-${index}`;
  return `<div class="activity-step"><div class="step-row"><div><label for="${id}-device">Device</label><select id="${id}-device" data-step="${ref}" data-key="deviceId"><option value="">Delay only</option>${deviceOptions(step.deviceId)}</select></div><div><label for="${id}-delay">${step.deviceId?'Delay after (ms)':'Delay (ms)'}</label><input id="${id}-delay" type="number" min="0" max="30000" step="100" data-step="${ref}" data-key="delayMs" value="${step.delayMs||0}"></div><button type="button" data-remove="${ref}" class="icon-button" title="Remove action">${icon('Minus')}</button></div>${step.deviceId?`<div class="fields"><div><label for="${id}-command">Command</label><select id="${id}-command" data-step="${ref}" data-key="command">${commandOptions(step.deviceId,step.command)}</select></div><div><label for="${id}-role">Action type</label><select id="${id}-role" data-step="${ref}" data-key="role"><option value="command">Command</option><option value="power-on" ${step.role==='power-on'?'selected':''}>Discrete power on</option><option value="power-off" ${step.role==='power-off'?'selected':''}>Power off</option><option value="input" ${step.role==='input'?'selected':''}>Input</option></select></div></div>`:''}</div>`;
}
function renderActivityEditor(activity=null) {
  const value=structuredClone(activity||{id:'activity-'+Date.now().toString(36),name:'',steps:[],exitSteps:[]});
  const draw=()=>{
    mount(`<div class="editor"><h2>${activity?'Edit activity':'Add activity'}</h2>${activity?`<section class="section"><h3>Remote layout</h3><p><a href="/go/#/edit/${encodeURIComponent(value.id)}">Edit this activity’s remote layout</a></p></section>`:''}<form id="activity-form">${field('Name','activity-name',value.name,'text','required maxlength="64"')}${['steps','exitSteps'].map(group=>`<section class="section"><h3>${group==='steps'?'Start actions':'Power-off actions'}</h3>${value[group].map((step,i)=>activityStep(step,group,i)).join('')}<button type="button" data-add-step="${group}">${icon('Plus')} Add action</button></section>`).join('')}<div class="toolbar"><button class="primary">Save activity</button><button type="button" data-action="activities">Cancel</button>${activity?'<button type="button" data-action="delete-activity" data-id="'+escape(activity.id)+'" class="danger">Delete activity</button>':''}</div></form></div>`);
    $('activity-name').oninput=e=>value.name=e.target.value;
    $('content').querySelectorAll('[data-step]').forEach(e=>e.onchange=()=>{const [group,index]=e.dataset.step.split(':'),step=value[group][+index];step[e.dataset.key]=e.dataset.key==='delayMs'?Number(e.value):e.value;if(e.dataset.key==='deviceId'){step.command='';step.transport=state.devices.find(d=>d.id===e.value)?.transport||'ir';step.kind=e.value?'command':'delay';draw();}});
    $('content').querySelectorAll('[data-remove]').forEach(e=>e.onclick=()=>{const [group,index]=e.dataset.remove.split(':');value[group].splice(+index,1);draw();});
    $('content').querySelectorAll('[data-add-step]').forEach(e=>e.onclick=()=>{if(value[e.dataset.addStep].length>=32)return notice('Activity has reached the action limit.',true);value[e.dataset.addStep].push({kind:'delay',deviceId:'',command:'',transport:'ir',delayMs:500,role:'command'});draw();});
    $('activity-form').onsubmit=async e=>{e.preventDefault();try{const config=structuredClone(state.config),i=config.activities.findIndex(a=>a.id===value.id);if(i>=0)config.activities[i]=value;else config.activities.push(value);await saveConfig(config);show('activities');notice('Activity saved.');}catch(error){notice(error.message,true);}};
  };draw();
}
function renderMqttStatus(mqtt) {
  const element=$('mqtt-status');if(!element)return;
  const labels={connected:'MQTT connected',connecting:'Connecting to MQTT...',waiting_for_hub:'Waiting for the hub service...',disconnected:'MQTT disconnected',disabled:'MQTT disabled'};
  element.textContent=mqtt.enabled?(labels[mqtt.status?.state]||'MQTT is starting...'):'MQTT disabled';
  if(mqtt.enabled&&mqtt.status?.error)element.textContent+=': '+mqtt.status.error;
}
async function renderSettings() {
  mount(`<div class="section"><h2>Appearance</h2><label for="theme">Theme</label><select id="theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
    ${owner()?'<section class="section"><h2>Controllers</h2><div id="controllers">Loading paired controllers...</div></section><section class="section"><h2>Backups</h2><div class="toolbar"><button data-action="export-portable">Export setup</button><button data-action="export-full">Sensitive hub backup</button></div><label for="restore-file">Restore setup</label><input id="restore-file" type="file" accept=".json"></section><section class="section"><h2>Home Assistant</h2><form id="mqtt-form"><label class="check-label"><input id="mqtt-enabled" type="checkbox">Enable MQTT</label>'+field('Broker','mqtt-host')+field('Port','mqtt-port','1883','number','min="1" max="65535"')+field('Username','mqtt-user')+field('Password','mqtt-password','','password')+'<div class="toolbar"><button class="primary">Save integration</button></div></form></section><section class="section"><h2>Recovery</h2><p>USB recovery remains available through the desktop tool. A stock factory reset can remove this installation.</p><div class="toolbar"><button data-action="reboot">Reboot hub</button></div></section><details><summary>Advanced</summary><section class="section"><h2>Network</h2><form id="wifi-form">'+field('Wi-Fi name','wifi-ssid')+field('Wi-Fi password','wifi-password','','password')+'<div class="toolbar"><button class="primary">Change Wi-Fi</button><button type="button" data-action="confirm-wifi">Confirm new connection</button></div></form></section><p class="warning">This connection uses local HTTP. Pairing does not encrypt traffic. Do not expose this hub to the internet.</p><p>Fresh setup is experimental until the separate blank-hub recovery test passes.</p></details>':'<p>Only the owner can change settings, pair controllers or export backups.</p>'}`);
  $('mqtt-form')?.insertAdjacentHTML('beforebegin','<p id="mqtt-status" role="status">Checking MQTT connection...</p>');
  $('theme').value=readLocal('harmony-theme','system');$('theme').onchange=e=>{document.documentElement.dataset.theme=e.target.value;writeLocal('harmony-theme',e.target.value);};
  if(!owner()){$('content').insertAdjacentHTML('beforeend','<div class="toolbar"><button class="primary" data-action="full-access">Get full access with Pair button</button></div>');return;}
  $('restore-file').onchange=async()=>{try{const file=$('restore-file').files[0];if(!file)return;if(file.size>500000)throw Error('Backup exceeds the browser restore limit. Use the desktop installer.');const backup=JSON.parse(await file.text());if(!confirm('Replace the local setup with this backup? Existing native activities are restored only from the supplied backup.'))return;await mutate('backups/restore',{backup});await loadDevices();notice('Setup restored.');}catch(error){notice(error.message,true);}};
  $('mqtt-form').onsubmit=async e=>{e.preventDefault();try{const mqtt=await api('integrations/mqtt',{enabled:$('mqtt-enabled').checked,host:$('mqtt-host').value,port:Number($('mqtt-port').value),username:$('mqtt-user').value,password:$('mqtt-password').value});renderMqttStatus(mqtt);notice('MQTT settings saved.');}catch(error){notice(error.message,true);}};
  $('wifi-form').onsubmit=async e=>{e.preventDefault();try{await api('network/wifi',{ssid:$('wifi-ssid').value,password:$('wifi-password').value});notice('Trying the new network. Reconnect and confirm it within 90 seconds, or the hub will restore the old network.');}catch(error){notice(error.message,true);}};
  try{const mqtt=await api('integrations/mqtt');if(state.view!=='settings')return;renderMqttStatus(mqtt);$('mqtt-enabled').checked=!!mqtt.enabled;$('mqtt-host').value=mqtt.broker?.host||'';$('mqtt-port').value=mqtt.broker?.port||1883;$('mqtt-user').value=mqtt.broker?.username||'';}catch(error){notice(error.message,true);}
  try{const controllers=await api('controllers');if(state.view!=='settings')return;$('controllers').innerHTML=controllers.map(c=>`<div class="list-row"><div class="text"><strong>${escape(c.name)}</strong><small>${escape(c.role)}</small></div>${c.id===state.session.id?'':`<button data-action="${c.role==='pending'?'approve':'revoke'}" data-id="${escape(c.id)}">${c.role==='pending'?'Approve':'Revoke'}</button>`}</div>`).join('');}catch(error){notice(error.message,true);}
}
async function loadDevices() {
  const inventory=await api('devices');state.devices=(inventory.devices||[]).map(d=>({...d,transport:'ir'}));
  const bluetooth=await api('bluetooth/devices');state.devices.push(...(bluetooth.devices||[]).map(d=>({...d,transport:'bluetooth'})));
  const network=await api('network/devices');state.devices.push(...(network.devices||[]).map(d=>({...d,transport:'roku'})));
}
function show(view) {
  if(draftStarted()&&!confirm('Discard this unsaved device setup?'))return;
  stopHold(false);state.editor=null;state.draft=null;state.view=['remote','devices','activities','settings'].includes(view)?view:'remote';
  if(location.hash!=='#'+state.view)history.replaceState(null,'','#'+state.view);
  $('title').textContent={remote:'Remote',devices:'Devices',activities:'Activities',settings:'Settings'}[state.view];
  ({remote:renderRemote,devices:renderDevices,activities:renderActivities,settings:renderSettings})[state.view]();
  $('main').dataset.view=state.view;
  $('main').focus({preventScroll:true});window.scrollTo(0,0);
}
async function onboarding() {
  mount('<div class="editor"><h2>Your local setup</h2><div class="choice-list"><button data-mode="keep" class="primary">Keep existing setup</button><button data-mode="restore">Restore backup</button><button disabled>Start fresh: blank-hub verification pending</button></div><p>Existing handheld configurations stay intact. Unsupported native activities remain available as their original configuration.</p></div>');
  $('content').querySelectorAll('[data-mode]').forEach(button=>button.onclick=async()=>{try{await mutate('setup',{mode:button.dataset.mode});show(button.dataset.mode==='restore'?'settings':'remote');}catch(error){notice(error.message,true);}});
}
let sessionTimer;
async function boot() {
  try {
    const session=await api('session');state.session=session;
    clearTimeout(sessionTimer);sessionTimer=setTimeout(pollSession,session.role==='pending'||session.buttonPending?1500:15000);
    if(['unpaired','pending'].includes(session.role)||session.buttonPending) {
      state.config=null;$('navigation').hidden=true;$('title').textContent='Harmony Hub';
      if(session.role==='pending'||session.buttonPending){
        mount(`<div class="pairing"><h2>${session.buttonPending?'Press the hub\'s Pair button':'Waiting for approval'}</h2><p>${session.buttonPending?'Briefly press and release Pair on the back of the hub to grant this browser full access. This request expires after 90 seconds.':'Ask the owner to approve this browser in Settings, or cancel and try the Pair button again.'}</p><div class="toolbar"><button data-action="refresh">Check approval</button><button data-action="cancel-pair">Cancel</button></div></div>`);return;
      }
      mount(`<div class="pairing"><h2>${session.claimed?'Pair this browser':'Claim your hub'}</h2><form id="pair-form">${field('Browser name','controller-name',readLocal('harmony-controller-name'),'text','required maxlength="64" autocomplete="nickname"')}${session.buttonAvailable?'<div class="toolbar"><button class="primary" name="pair-method" value="button">Pair with hub button</button></div>':''}<details ${session.buttonAvailable?'':'open'}><summary>${session.claimed?'Ask the owner instead':'Use installer code instead'}</summary>${session.claimed?'':field('Single-use installer code','claim-code','','text','autocomplete="off"')}<div class="toolbar"><button name="pair-method" value="fallback">${session.claimed?'Request owner approval':'Claim ownership'}</button></div></details></form></div>`);
      $('pair-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter?.value==='button',name=$('controller-name').value.trim();writeLocal('harmony-controller-name',name);try{notice('');state.session=await api('controllers/'+(button||session.claimed?'request':'claim'),{name,button,code:$('claim-code')?.value||''});await boot();}catch(error){notice(error.message,true);}};return;
    }
    state.config=await api('configuration');await loadDevices();$('navigation').hidden=false;
    if(owner()&&state.config.setupMode==='unselected')await onboarding();else show(location.hash.slice(1)||'remote');
  }catch(error){notice(error.message,true);$('content').setAttribute('aria-busy','false');}
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button)return;
  try {
    const action=button.dataset.action;
    if(action==='devices'&&state.editor&&button.textContent==='Cancel'&&!button.closest('#device-form')){renderDeviceEditor(state.editor);return;}
    if(['remote','devices','activities','settings'].includes(action)){show(action);return;}
    if(action==='refresh'){await boot();return;}
    if(action==='cancel-pair'){await api('controllers/cancel',{});await boot();return;}
    if(action==='full-access'){await api('controllers/upgrade',{});await boot();return;}
    if(action==='drawer')drawer();
    else if(action==='add-device')startDeviceSetup();
    else if(action==='open-device'){writeLocal('harmony-activity','');writeLocal('harmony-device',button.dataset.id);show('remote');}
    else if(action==='edit-device')renderDeviceEditor(state.devices.find(d=>d.id===button.dataset.id));
    else if(action==='edit-roku')location.assign(ROKU_SCREEN);
    else if(action==='layout')renderLayout();
    else if(action==='import-profile')renderImport();
    else if(action==='search-profile'){if(!state.draft)profileSearch={};renderSearch();}
    else if(action==='test-device')renderDeviceTest(state.editor);
    else if(action==='device-back')renderDeviceEditor(state.editor);
    else if(action==='learn')renderLearn();
    else if(action==='delete-device'){if(confirm('Delete this device from the hub?')){await mutate('devices',{action:'delete',deviceId:state.editor.id,transport:state.editor.transport});await loadDevices();show('devices');}}
    else if(action==='capture'){const result=await api('commands/learn',{});$('learn-raw').value=result.raw||'';$('learn-mode').value=result.mode||'raw';$('learn-protocol').value=result.protocolId||'2';$('learn-code').value=result.keycode||result.nec||'';$('capture-result').textContent=result.analysis||'Capture received. Verify the signal before saving.';updateLearnSave();}
    else if(action==='bt-command')renderBluetoothCommand();
    else if(action.startsWith('bt-')){const result=await api('bluetooth/pair',{action:{'bt-pair':'pairing_on','bt-status':'adapter_status','bt-stop':'pairing_off'}[action],type:$('bt-type').value,name:'Harmony Keyboard',bdaddr:$('bt-address').value});$('bt-result').hidden=false;$('bt-result').textContent=result.responseRaw||result.error||'Pairing request sent.';}
    else if(action==='new-activity')renderActivityEditor();
    else if(action==='edit-activity')renderActivityEditor(state.config.activities.find(a=>a.id===button.dataset.id));
    else if(action==='delete-activity'){if(confirm('Delete this local activity?')){const config=structuredClone(state.config);config.activities=config.activities.filter(a=>a.id!==button.dataset.id);await saveConfig(config);show('activities');}}
    else if(action==='confirm-wifi'){await api('network/confirm',{});notice('New Wi-Fi connection confirmed.');}
    else if(action==='native-activities'){$('native-activities').hidden=false;$('native-activities').textContent=JSON.stringify(await api('activities/native'),null,2);}
    else if(action==='approve'||action==='revoke'){await api('controllers',{id:button.dataset.id,action});await renderSettings();}
    else if(action==='export-portable'||action==='export-full'){if(action==='export-full'&&!confirm('This backup contains Wi-Fi and MQTT credentials and travels over local HTTP. Continue?'))return;const backup=await api('backups/'+(action==='export-full'?'full':'portable'));const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='harmony-'+(action==='export-full'?'sensitive-backup':'setup')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    else if(action==='reboot'){if(confirm('Reboot the hub?')){await api('maintenance/reboot',{});connection(false);notice('Hub is rebooting.');}}
  }catch(error){notice(error.message,true);}
});
window.addEventListener('hashchange',()=>{const view=location.hash.slice(1);if(state.config&&['remote','devices','activities','settings'].includes(view))show(view);});
$('connection').addEventListener('click',()=>boot());
async function pollSession(){try{const session=await api('session');if(!state.session||session.role!==state.session.role||session.buttonPending!==state.session.buttonPending){await boot();}else if(owner()&&state.view==='settings')renderMqttStatus(await api('integrations/mqtt'));}catch{if($('mqtt-status'))$('mqtt-status').textContent='MQTT connection status unavailable';}finally{clearTimeout(sessionTimer);sessionTimer=setTimeout(pollSession,state.session?.role==='pending'||state.session?.buttonPending?1500:15000);}}
sessionTimer=setTimeout(pollSession,1500);
boot();
