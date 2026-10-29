import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../payload/www/go.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../payload/www/go.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../payload/www/go.css',import.meta.url),'utf8');
new vm.Script(source);

// The hub's CSP has no 'unsafe-inline' for styles: no style attributes or
// inline script/style blocks anywhere in the entry page or the JS templates.
assert.doesNotMatch(html,/\sstyle\s*=|<style|<script(?![^>]*\ssrc=)/i);
assert.doesNotMatch(source,/\sstyle\s*=|\.style\./);
assert.match(html,/href="\/go\/go\.css"/);assert.match(html,/src="\/go\/go\.js"/);
console.log('Entry page and shell script use no inline styles or scripts (CSP-safe)');

const elements={}, store=new Map();
const el=id=>elements[id]||=({id,dataset:{},classList:{add(){},remove(){}},hidden:false,textContent:'',innerHTML:'',title:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},focus(){},addEventListener(){},querySelectorAll:()=>[],querySelector(sel){return (this.found||={})[sel]||={dataset:{},hidden:false};}});
const context=vm.createContext({document:{getElementById:el,title:'',body:{dataset:{}},addEventListener(){},hidden:false},window:{addEventListener(){},scrollTo(){}},location:{hash:'',replace(url){context.replaced=url;},assign(url){context.assigned=url;}},history:{replaceState(){},pushState(){context.pushed=(context.pushed||0)+1;},back(){context.backed=(context.backed||0)+1;}},
  confirm:message=>{(context.confirmed||(context.confirmed=[])).push(message);return context.confirmAnswer!==false;},navigator:{vibrate(){context.vibrated=(context.vibrated||0)+1;}},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},setTimeout:()=>0,clearTimeout(){},fetch:async()=>{throw new TypeError('offline');},AbortController,URL,structuredClone,atob});
const inert=source.replace(/\n  boot\(\);\n\}\s*$/,'\n}');assert.notEqual(inert,source,'boot() auto-run not found');
vm.runInContext(inert.replace('const state =','var state =')+'\nthis.exports={parseRoute,routeHash,connection,state,needsFullUi,api,show,screens,renderActivities,renderDevices,deviceRemoteHtml,renderDeviceRemote,remoteBlocks,remoteHtml,renderActivityRemote,CONTROLS,controlFor,volumeTarget,editorSlots,availableCommands,addButton,insertRow,moveRow,removeRow,gridRows,removeButton,editorHtml,renderEditor,screenOf,MAX_CELLS,layoutShape,startDraft,submitLayout,getLeaveGuard:()=>leaveGuard,cloneScreen,withSlots,announceHub,loadDevices,typingPlan,createTyper,openKeyboard,KEYBOARD_COMMAND,setRunningActivity,syncHubActivity,announceRunning,channelChoices,ROKU_BUILTIN_NAMES,channelRowHtml,parseRelease,installRelease,waitForHub,pauses};',context);
const {parseRoute,routeHash,connection,state,needsFullUi,api,show}=context.exports;

assert.deepEqual(JSON.parse(JSON.stringify(parseRoute(''))),{name:'activities',params:[]});
assert.deepEqual(JSON.parse(JSON.stringify(parseRoute('#/devices'))),{name:'devices',params:[]});
assert.deepEqual(JSON.parse(JSON.stringify(parseRoute('#/activity/watch%20tv'))),{name:'activity',params:['watch tv']});
assert.deepEqual(JSON.parse(JSON.stringify(parseRoute('#/nonsense/x'))),{name:'activities',params:[]});
assert.deepEqual(JSON.parse(JSON.stringify(parseRoute('#/activity/%E0%A4%A'))),{name:'activities',params:[]});
for(const bad of ['#/constructor','#/__proto__','#/toString/x'])assert.equal(parseRoute(bad).name,'activities',bad);
assert.equal(routeHash('activity','a/b c'),'#/activity/a%2Fb%20c');
assert.equal(parseRoute(routeHash('activity','a/b c')).params[0],'a/b c');
console.log('Hash routing parses tabs and drill-ins, decodes params and falls back to Activities');

// A button must let a vertical swipe scroll the page: touch-action none on a remote's buttons made the remote
// impossible to scroll from anywhere a button was. (The press itself is cancelled by pointercancel when a pan starts.)
{
  const rule=selector=>(css.match(new RegExp('(?:^|\\n|\\})\\s*'+selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\{([^}]*)\\}'))||[])[1]||'';
  assert.match(rule('.cell'),/touch-action:\s*pan-y/,'remote buttons let a vertical swipe scroll');
  assert.doesNotMatch(rule('.cell'),/touch-action:\s*none/);
  assert.match(rule('.pinned .cell'),/touch-action:\s*none/,'the fixed row never scrolls, so its holds stay exact');
  const oldCss=fs.readFileSync(new URL('../payload/www/app.css',import.meta.url),'utf8');
  assert.match(oldCss,/button\[data-command\]\{touch-action:pan-y/,'the original UI\'s remote scrolls the same way');
  console.log('Remote buttons let a vertical swipe scroll the page; the fixed row does not');
}

assert.equal(state.online,null);
assert.equal(!state.online,true);
connection(null);assert.equal(el('connection').dataset.state,'connecting');
connection(true);assert.equal(el('connection').dataset.state,'online');assert.equal(state.online,true);
connection(false);assert.equal(el('connection').dataset.state,'offline');
assert.match(el('connection').attrs['aria-label'],/Disconnected/);
await assert.rejects(api('session'));
assert.equal(state.online,false);
console.log('Connectivity icon cycles connecting/online/offline and a network failure flags offline');

assert.equal(needsFullUi({role:'unpaired'}),true);
assert.equal(needsFullUi({role:'pending'}),true);
assert.equal(needsFullUi({role:'controller',buttonPending:true}),true);
assert.equal(needsFullUi({role:'owner'},{setupMode:'unselected'}),true);
assert.equal(needsFullUi({role:'owner'},{setupMode:'keep'}),false);
assert.equal(needsFullUi({role:'controller'},{setupMode:'unselected'}),false);
console.log('Pairing and first-run setup are handed to the original UI');

// Drill-in screens get a back arrow and no tabs; tab screens the reverse. The connection icon is on tab
// screens and on remotes (the app hides its toolbar there), but not on other drill-ins.
state.config={activities:[]};state.session={role:'owner'};
context.location.hash='#/activity/watch';show();
assert.equal(el('back').hidden,false);assert.equal(el('back').dataset.parent,'activities');
assert.equal(el('tabs').hidden,true);assert.equal(el('connection').hidden,false);
context.location.hash='#/roku';show();assert.equal(el('connection').hidden,true);
context.location.hash='#/edit/watch';show();assert.equal(el('connection').hidden,true,'the editor header has no room for the icon');
context.location.hash='#/devices';show();
assert.equal(el('back').hidden,true);assert.equal(el('tabs').hidden,false);assert.equal(el('connection').hidden,false);
assert.equal(el('title').textContent,'Devices');
console.log('Tab screens show tabs and the connectivity icon; drill-in screens show a back arrow instead');

// ---- Activities home ----
const calls=[];let outcome='completed',pending=null;
let hubDown=false,sessionGate=null,hubState={activityId:'',estimated:true};
context.api=async(path,body)=>{calls.push({path,...body});if(path==='activities/state')return hubState;if(path==='session'){if(sessionGate)await sessionGate;if(hubDown){state.online=false;throw Error('down');}state.online=true;return {};}if(path==='activities/run')return {id:'op'+calls.length};return {};};
context.operation=async()=>pending?await pending:{state:outcome};
state.online=true;
state.devices=[{id:'1',name:'LG C5',transport:'ir',commands:['VolumeUp','VolumeDown','Play'].map(name=>({name}))},{id:'2',name:'Receiver'}];
const announced=[];context.window.HarmonyNative={setRunningActivity:v=>announced.push(v)};
state.config={activities:[
  {id:'watch',name:'Watch <TV>',steps:[{deviceId:'1'},{deviceId:'2'},{deviceId:'1'}]},
  {id:'empty',name:'Empty',steps:[]}]};
const content={innerHTML:'',isConnected:true,onclick:null};
const click=async attr=>{const button={dataset:attr};await content.onclick({target:{closest:()=>button}});};
const draw=()=>context.exports.renderActivities({content,params:[]});
context.location.hash='#/activities';
draw();
assert.match(content.innerHTML,/Watch &lt;TV&gt;/);
assert.match(content.innerHTML,/LG C5 · Receiver/);
assert.match(content.innerHTML,/No devices/);
assert.doesNotMatch(content.innerHTML,/Running/);
assert.doesNotMatch(content.innerHTML,/href="\/#activities"/);
console.log('Activities home lists activities with their devices, escaped, with no Manage link');

await click({open:'watch'});
assert.deepEqual(calls.map(c=>[c.path,c.activityId,c.fixState]),[['activities/run','watch',false]]);
assert.equal(store.get('harmony-activity'),'watch');
assert.deepEqual(announced.map(v=>v&&JSON.parse(v)),[{id:'watch',name:'Watch <TV>',buttons:[{key:'play',label:'Play',deviceId:'1',command:'Play',transport:'ir'},{key:'volumedown',label:'Volume down',deviceId:'1',command:'VolumeDown',transport:'ir'},{key:'volumeup',label:'Volume up',deviceId:'1',command:'VolumeUp',transport:'ir'}]}],'starting an activity tells the app which buttons to keep on the lock screen');
assert.equal(context.location.hash,'#/activity/watch');
draw();
assert.doesNotMatch(content.innerHTML,/Running/);assert.match(content.innerHTML,/icon-Power/);assert.match(content.innerHTML,/data-stop/);
console.log('Tapping an activity starts it, remembers it and opens its remote');

calls.length=0;context.location.hash='#/activities';
await click({open:'watch'});
assert.equal(calls.length,0);assert.equal(context.location.hash,'#/activity/watch');
console.log('Tapping the running activity just opens its remote');

calls.length=0;context.location.hash='#/activities';
await click({fix:'empty'});
assert.deepEqual(calls.map(c=>[c.activityId,c.fixState]),[['empty',true]]);
assert.equal(store.get('harmony-activity'),'empty');assert.equal(context.location.hash,'#/activities');
assert.equal(announced.at(-1),'','an activity with nothing to press has no lock-screen buttons');
assert.match(el('notice').textContent,/Device state fixed/);
console.log('Fix device state re-runs with fixState, stays on the list and remembers the activity');

calls.length=0;
await click({stop:''});
assert.deepEqual(calls.map(c=>[c.activityId,c.fixState]),[['-1',false]]);
assert.equal(store.get('harmony-activity'),'');assert.equal(announced.at(-1),'','stopping clears them');
console.log('Stop sends the hub power-off request and clears the running activity');

// ---- The hub's own estimate of what is running (a change made by Home Assistant or another phone) ----
{
  const {syncHubActivity,setRunningActivity}=context.exports;
  let now=Date.now()+10000;context.Date=class extends Date{static now(){return now;}};
  const sync=async hub=>{hubState=hub;calls.length=0;return syncHubActivity();};
  now+=10000;   // clear of the settle window the earlier clicks started
  store.set('harmony-activity','watch');
  assert.equal(await sync({activityId:'watch',estimated:true}),false,'the hub agrees: nothing changes');
  assert.deepEqual(calls.map(c=>c.path),['activities/state']);
  assert.equal(await sync({activityId:'',estimated:true}),true,'the hub says nothing is running');
  assert.equal(store.get('harmony-activity'),'');assert.equal(announced.at(-1),'','the lock-screen buttons go too');
  assert.equal(await sync({activityId:'empty',estimated:true}),true,'another phone or Home Assistant started one');
  assert.equal(store.get('harmony-activity'),'empty');
  assert.equal(await sync({activityId:'-1',estimated:true}),true,'"-1" is the hub\'s power-off request');
  assert.equal(store.get('harmony-activity'),'');
  store.set('harmony-activity','watch');
  assert.equal(await sync({activityId:'deleted',estimated:true}),true,'an id the hub no longer has is nothing running');
  assert.equal(store.get('harmony-activity'),'');
  // Just after this phone starts or stops one, the hub may not have written its estimate yet.
  setRunningActivity('watch');
  assert.equal(await sync({activityId:'',estimated:true}),false);assert.equal(calls.length,0,'it does not even ask inside the settle window');
  assert.equal(store.get('harmony-activity'),'watch');
  now+=3500;
  assert.equal(await sync({activityId:'',estimated:true}),true,'then the hub is believed');
  assert.equal(store.get('harmony-activity'),'');
  // While a start is running the hub has not answered yet.
  store.set('harmony-activity','watch');now+=10000;
  let finish;pending=new Promise(resolve=>{finish=resolve;});outcome='completed';
  const running=click({open:'empty'});for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(await sync({activityId:'',estimated:true}),false,'no sync while an operation is in flight');
  assert.equal(calls.length,0);
  finish({state:'completed'});await running;pending=null;delete context.Date;
  context.location.hash='#/activities';
  console.log('The page takes the hub\'s estimate of what is running, but not mid-operation or just after its own change');
}
store.set('harmony-activity','watch');calls.length=0;outcome='cancelled';context.location.hash='#/activities';draw();
const announcedBefore=announced.length;
await click({open:'empty'});assert.equal(announced.length,announcedBefore,'a cancelled start announces nothing');
assert.equal(store.get('harmony-activity'),'watch');assert.equal(context.location.hash,'#/activities');
assert.match(el('notice').textContent,/Cancelled/);assert.equal(el('notice').dataset.error,'true');
outcome='completed';
console.log('A cancelled start is not remembered and does not navigate');

calls.length=0;state.online=false;hubDown=true;
await click({open:'empty'});
assert.deepEqual(calls.map(c=>c.path),['session'],'an offline press only asks the hub whether it is back');assert.match(el('notice').textContent,/disconnected/);
// While the hub is being asked, the screen says so; the message goes away when the answer arrives.
{
  let open;sessionGate=new Promise(r=>open=r);hubDown=false;calls.length=0;state.online=false;
  const pressing=click({open:'empty'});for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(el('notice').textContent,'Checking the hub…','a press waiting on the hub says so');
  open();sessionGate=null;await pressing;
  assert.doesNotMatch(el('notice').textContent,/Checking/,'the message does not outlive the check');
  store.set('harmony-activity','watch');context.location.hash='#/activities';draw();
}
hubDown=false;calls.length=0;state.online=false;
await click({open:'empty'});
assert.equal(calls[0].path,'session');assert.ok(calls.some(c=>c.path==='activities/run'),'the hub is back: the press goes through');
state.online=true;store.set('harmony-activity','watch');context.location.hash='#/activities';draw();
console.log('A press while disconnected re-checks the hub: refused if it is still down, sent if it is back');

// A start shows its progress on the row that was tapped, and only after BUSY_SHOW_MS; nothing is added to the list.
{
  const timers=[];context.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};context.clearTimeout=id=>{if(timers[id-1])timers[id-1].fn=null;};
  const fire=async()=>{for(const t of timers)if(t.fn){const fn=t.fn;t.fn=null;fn();}for(let i=0;i<10;i++)await Promise.resolve();};
  const listOnly=html=>assert.ok(html.startsWith('<div class="list">'),'nothing is added before the list');
  store.set('harmony-activity','watch');state.online=true;

  // quick: finished before the indication was due, so it never appears
  calls.length=0;pending=null;outcome='completed';timers.length=0;context.location.hash='#/activities';draw();
  const before=content.innerHTML;
  await click({open:'empty'});
  assert.equal(timers.length>0&&timers[0].ms,400,'the indication waits 400 ms');
  assert.equal(content.innerHTML.includes('spinner'),false,'a quick start shows nothing at all');
  store.set('harmony-activity','watch');context.location.hash='#/activities';draw();

  // slow: after 400 ms the tapped row shows a spinner and "Stop starting", the others dim, nothing else changes
  calls.length=0;timers.length=0;let release;pending=new Promise(r=>release=r);draw();
  const first=click({open:"empty"});for(let i=0;i<10;i++)await Promise.resolve();
  await click({open:'watch'});await click({fix:'watch'});
  assert.equal(calls.filter(c=>c.path==='activities/run').length,1,'a second tap during a start is ignored');
  assert.equal(content.innerHTML.includes('spinner'),false,'not yet');
  await fire();
  const html=content.innerHTML;
  listOnly(html);
  const rows=html.split('<div class="row"').slice(1);
  assert.equal(rows.length,2,'the same rows as before');
  const [watchRow,emptyRow]=rows;
  assert.match(emptyRow,/spinner/);assert.match(emptyRow,/data-cancel[^>]*>Stop starting</);assert.match(emptyRow,/Starting…/);
  assert.match(emptyRow,/Devices already switched stay as they are\./,'the note is on the control');
  assert.doesNotMatch(emptyRow,/data-fix/);assert.doesNotMatch(emptyRow,/data-dim/);
  assert.match(watchRow,/data-dim="true"/);assert.doesNotMatch(watchRow,/spinner/);
  assert.doesNotMatch(html,/class="busy"/);
  assert.equal(el('sr-status').textContent,'Starting… Empty','screen readers hear it');
  await click({cancel:''});
  assert.deepEqual(calls.at(-1),{path:'operations',id:'op1',action:'cancel'});
  outcome='cancelled';release({state:'cancelled'});await first;pending=null;outcome='completed';
  assert.doesNotMatch(content.innerHTML,/data-cancel|spinner/);assert.equal(el('sr-status').textContent,'');
  assert.match(content.innerHTML,/Device state is unknown/,'the cancelled row says so');
  assert.equal(content.innerHTML.split('Device state is unknown').length,2,'and only that row');
  assert.match(el('notice').textContent,/Cancelled\. Devices already switched stay as they are\. Device state is unknown\./);
  listOnly(content.innerHTML);

  // a later success clears the mark
  calls.length=0;await click({fix:'empty'});
  assert.doesNotMatch(content.innerHTML,/Device state is unknown/);

  // stopping draws on the running row: its power button becomes the spinner
  store.set('harmony-activity','watch');context.location.hash='#/activities';calls.length=0;timers.length=0;
  pending=new Promise(r=>release=r);draw();
  const stopping=click({stop:''});for(let i=0;i<10;i++)await Promise.resolve();await fire();
  const stopHtml=content.innerHTML.split('<div class="row"').slice(1)[0];
  assert.match(stopHtml,/<span class="row-icon row-power"><svg class="spinner"/);assert.doesNotMatch(stopHtml,/data-stop/);
  assert.match(stopHtml,/Stop powering off/);assert.match(stopHtml,/Powering off…/);
  release({state:'completed'});await stopping;pending=null;
  context.setTimeout=()=>0;context.clearTimeout=()=>{};
  store.set('harmony-activity','watch');context.location.hash='#/activities';draw();
}
console.log('A start shows progress on the tapped row after 400 ms, with Stop starting, dimmed rows and an unknown-state mark; nothing is added to the list');

// The Activities and Devices tabs float their messages (they have no reserved space).
{
  const rule=selector=>(css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\{([^}]*)\\}'))||[])[1]||'';
  const floating=rule('body[data-reserve-notice=false] #notice:not([hidden])');
  assert.match(floating,/position:\s*fixed/);assert.match(floating,/bottom:/);
  assert.equal(screens_reserve('activities'),false);assert.equal(screens_reserve('devices'),false);
  assert.equal(screens_reserve('setup'),true,'the other screens keep their reserved strip');
  assert.match(css,/prefers-reduced-motion:reduce\)\{\.spinner\{animation:none\}/);
  assert.doesNotMatch(css,/\.busy\b/);assert.doesNotMatch(source,/class="busy"/);
  function screens_reserve(name){return !!context.exports.screens[name].reserveNotice;}
  console.log('Activities and Devices notices float above the tab bar; reduced motion stops the spinner; the old banner is gone');
}

context.location.hash='#/devices';calls.length=0;el('notice').textContent='';outcome='failed';
context.operation=async()=>{throw Error('hub error');};
context.location.hash='#/activities';draw();
const late=click({open:'empty'});context.location.hash='#/devices';await late;
assert.equal(el('notice').textContent,'');
console.log('A start finishing after you navigate away does not write to another screen');

// ---- Devices list ----
state.devices=[
  {id:'1',name:'LG <C5>',type:'Television',transport:'ir',commands:Array(21).fill({name:'x'})},
  {id:'2',name:'Receiver',type:'Audio',transport:'ir',commands:[{name:'x'}]},
  {id:'3',name:'Roku',type:'Media Player',transport:'ir',commands:[]},
  {id:'bt/1',name:'Keyboard',type:'',transport:'bluetooth',commands:[{name:'a'},{name:'b'}]},
  {id:'4',name:'Gizmo',type:'Other',transport:'ir'}];
const devicesContent={innerHTML:''};
context.exports.renderDevices({content:devicesContent,params:[]});
const devicesHtml=devicesContent.innerHTML;
assert.match(devicesHtml,/LG &lt;C5&gt;/);
assert.match(devicesHtml,/Television · 21 commands/);
assert.match(devicesHtml,/Audio · 1 command</);
assert.match(devicesHtml,/Media Player · 0 commands/);
assert.match(devicesHtml,/Bluetooth · 2 commands/);
assert.match(devicesHtml,/Other · 0 commands/);
assert.match(devicesHtml,/href="#\/device\/1"/);
assert.match(devicesHtml,/href="#\/device\/bt%2F1"/);
assert.match(devicesHtml,/icon-Tv/);assert.match(devicesHtml,/icon-Speaker/);assert.match(devicesHtml,/icon-MonitorPlay/);
assert.doesNotMatch(devicesHtml,/href="\/#devices"/);
state.devices=[{id:'9',name:'Odd',type:'constructor',commands:[]}];context.exports.renderDevices({content:devicesContent,params:[]});
assert.match(devicesContent.innerHTML,/icon-Radio/);assert.doesNotMatch(devicesContent.innerHTML,/function|undefined/);
state.devices=[];
assert.equal(context.exports.parseRoute('#/device/bt%2F1').params[0],'bt/1');
console.log('Devices list shows type and command count (singular/plural), links to each device remote');
state.devices=[];context.exports.renderDevices({content:devicesContent,params:[]});
assert.match(devicesContent.innerHTML,/No devices yet/);assert.doesNotMatch(devicesContent.innerHTML,/Manage devices/);
console.log('Devices list has an empty state that shows no Manage link');

// ---- Activity remote ----
const J=v=>JSON.parse(JSON.stringify(v));
const appSource=fs.readFileSync(new URL('../payload/www/app.js',import.meta.url),'utf8');
const appControls=(()=>{const c=vm.createContext({});vm.runInContext(appSource.slice(appSource.indexOf('const norm ='),appSource.indexOf('function defaultLayout'))+';this.controls=controls',c);return J(c.controls);})();
assert.deepEqual(J(context.exports.CONTROLS).map(([slot,label,,aliases])=>[slot,label,aliases]),appControls.map(([slot,label,,aliases])=>[slot,label,aliases]));
console.log("go.js's control/alias table matches app.js's, so both UIs resolve commands identically");

const tv={id:'tv',name:'TV',transport:'ir',commands:['Up','Down','Left','Right','OK','Back','Input','Mute','VolumeUp','VolumeDown','HDMI 1','PowerOn'].map(name=>({name}))};
const bar={id:'bar',name:'Bar',transport:'ir',commands:[{name:'VolUp'},{name:'VolDn'},{name:'Mute'}]};
state.devices=[tv,bar];
const cell=(command,deviceId='tv',extra={})=>({deviceId,command,...extra});
const kinds=blocks=>J([...blocks].map(b=>b.kind==='cross'?'cross':[...b.entries].map(e=>e.cell.command).join(',')));
const {remoteBlocks,remoteHtml}=context.exports;

// Cross recognition does not depend on placement order or what surrounds it.
const arrows=['Up','Left','OK','Right','Down'];
for(const order of [arrows,[...arrows].reverse(),['Down','OK','Up','Right','Left']]){
  assert.deepEqual(kinds(remoteBlocks(order.map(c=>cell(c)))),['cross'],order.join());
}
// The cross always comes first; everything else follows in grid order.
assert.deepEqual(kinds(remoteBlocks([cell('Back'),...arrows.map(c=>cell(c)),cell('Input'),cell('Mute')])),['cross','Back,Input,Mute']);
assert.deepEqual(kinds(remoteBlocks([cell('Up'),cell('Back'),cell('Down'),cell('Input'),cell('Left'),cell('Mute'),cell('Right')])),['cross','Back,Input,Mute']);
const noOk=remoteBlocks(['Up','Down','Left','Right'].map(c=>cell(c)));
assert.deepEqual(kinds(noOk),['cross']);assert.equal(noOk[0].pick.ok,undefined);
assert.match(remoteHtml({columns:4,cells:['Up','Down','Left','Right'].map(c=>cell(c))}).body,/<span><\/span>/);
// A partial set of arrows is just ordinary buttons; a duplicate arrow stays ordinary.
assert.deepEqual(kinds(remoteBlocks([cell('Up'),cell('Down'),cell('Back')])),['Up,Down,Back']);
assert.deepEqual(kinds(remoteBlocks([...arrows.map(c=>cell(c)),cell('Up')])),['cross','Up']);
// Aliases count (a different device's "Select"/"Arrow Up" style names).
const alt={id:'alt',transport:'ir',commands:['Arrow Up','Arrow Down','Arrow Left','Arrow Right','Select'].map(name=>({name}))};
state.devices=[tv,bar,alt];
assert.deepEqual(kinds(remoteBlocks(['Arrow Up','Select','Arrow Left','Arrow Right','Arrow Down'].map(c=>cell(c,'alt')))),['cross']);
state.devices=[tv,bar];
console.log('The dpad cross is recognised in any placement order, keeps other buttons around it, and needs all four arrows');

// Slots: buttons keep the grid slot they sit in; gaps stay, and so do rows left empty on purpose.
const slotCell=(command,slot,deviceId='tv')=>({deviceId,command,slot});
const slotsOf=html=>[...html.matchAll(/<button[^>]*data-command="([^"]*)"|<span><\/span>/g)].map(m=>m[1]||'_');
let grid=remoteHtml({columns:4,cells:[slotCell('Mute',3),slotCell('Back',0)]}).body;
assert.deepEqual(slotsOf(grid),['Back','_','_','Mute'],'gaps between buttons stay open, and order follows the slot not the list');
grid=remoteHtml({columns:4,cells:[slotCell('Back',0),slotCell('Input',9)]}).body;
assert.deepEqual(slotsOf(grid),['Back','_','_','_','_','_','_','_','_','Input','_','_'],'a row with no buttons stays as a blank row; gaps inside a row stay');
grid=remoteHtml({columns:4,cells:[slotCell('Back',4)]}).body;
assert.deepEqual(slotsOf(grid),['_','_','_','_','Back','_','_','_'],'rows left empty above the first button are kept too');
assert.deepEqual(slotsOf(remoteHtml({columns:4,cells:[slotCell('Back',0)]}).body),['Back','_','_','_'],'nothing is added after the last button');
grid=remoteHtml({columns:3,cells:[slotCell('Back',4)]}).body;assert.deepEqual(slotsOf(grid),['_','_','_','_','Back','_']);
// Lists saved before slots existed fill the lowest free slots in order; collisions and bad slots are reassigned.
assert.deepEqual(slotsOf(remoteHtml({columns:4,cells:[cell('Back'),cell('Input'),cell('Mute')]}).body),['Back','Input','Mute','_']);
assert.deepEqual(slotsOf(remoteHtml({columns:4,cells:[slotCell('Back',1),cell('Input'),cell('Mute')]}).body),['Input','Back','Mute','_']);
assert.deepEqual(slotsOf(remoteHtml({columns:4,cells:[slotCell('Back',1),slotCell('Input',1),slotCell('Mute',99),slotCell('HDMI 1',-3),slotCell('OK','2')]}).body),['Input','Back','Mute','HDMI 1','OK','_','_','_']);
// The cross is pulled out whatever slots its members hold, and the rest keep theirs.
const withCross=remoteBlocks([slotCell('Up',5),slotCell('Left',6),slotCell('OK',7),slotCell('Right',8),slotCell('Down',9),slotCell('Back',0),slotCell('Mute',3)]);
assert.deepEqual(kinds(withCross),['cross','Back,Mute']);
// The squares the cross's own buttons held close up; only gaps left on purpose remain.
const arrowsAt=(...slots)=>['Up','Left','OK','Right','Down'].map((c,i)=>slotCell(c,slots[i]));
assert.deepEqual(slotsOf(remoteHtml({columns:4,cells:[...arrowsAt(0,1,2,3,4),slotCell('Back',5),slotCell('Input',6),slotCell('Mute',7)]}).body.split('</div>').slice(1).join('')),['Back','Input','Mute','_'],'a plus-shaped block of arrows leaves no hole behind');
const scattered=remoteHtml({columns:4,cells:[slotCell('Right',0),slotCell('Back',1),slotCell('Up',2),slotCell('Input',3),slotCell('OK',4),slotCell('Mute',5),slotCell('Down',6),slotCell('HDMI 1',7),slotCell('Left',8)]}).body;
assert.deepEqual(slotsOf(scattered.split('</div>').slice(1).join('')),['Back','Input','Mute','HDMI 1'],'arrows scattered through the grid are closed up too');
assert.deepEqual(slotsOf(remoteHtml({columns:4,cells:[...arrowsAt(0,1,2,3,4),slotCell('Back',5),slotCell('Mute',7)]}).body.split('</div>').slice(1).join('')),['Back','_','Mute','_'],'a gap left on purpose stays');
// Empty rows around the arrow pad are kept: crossRow rows sit above it, and the rows between it and the next button stay.
{
  const html=remoteHtml({columns:4,crossRow:2,cells:[...arrowsAt(8,9,10,11,12),slotCell('Back',0)]}).body;
  const [above,below]=[html.slice(0,html.indexOf('<div class="dpad">')),html.slice(html.indexOf('</div>',html.indexOf('<div class="dpad">'))+6)];
  assert.deepEqual(slotsOf(above),['Back','_','_','_','_','_','_','_'],'two rows above the pad, the second empty');
  assert.deepEqual(slotsOf(below),[],'no buttons below the pad, so no rows below it');
  const low=remoteHtml({columns:4,crossRow:0,cells:[...arrowsAt(0,1,2,3,4),slotCell('Mute',9)]}).body;
  assert.deepEqual(slotsOf(low.slice(low.indexOf('</div>',low.indexOf('<div class="dpad">'))+6)),['_','_','_','_','Mute','_','_','_'],'an empty row between the pad and the next button stays');
  assert.equal(slotsOf(remoteHtml({columns:4,crossRow:2,cells:arrowsAt(0,1,2,3,4)}).body.split('<div class="dpad">')[0]).length,8,'rows above the pad are kept even with no buttons in them');
}
// Inserting a row: buttons from that row down move one row later, counted the way the editor draws rows.
{
  const insertRow=context.exports.insertRow;
  const act=(cells,crossRow=0)=>({id:'a',steps:[],screen:{columns:4,crossRow,cells:cells.map(c=>({...c})),pinned:[]}});
  const slots=a=>Object.fromEntries(a.screen.cells.map(c=>[c.command,c.slot]));
  let a=act([slotCell('Back',0),slotCell('Input',4)]);
  assert.deepEqual(J(insertRow(a,1)),{moved:1});assert.deepEqual(slots(a),{Back:0,Input:8},'between two rows');
  a=act([slotCell('Back',0)]);insertRow(a,0);assert.deepEqual(slots(a),{Back:4},'above the first row');
  a=act([slotCell('Back',0)]);assert.deepEqual(J(insertRow(a,1)),{moved:0});assert.deepEqual(slots(a),{Back:0},'after the last row nothing moves');
  a=act([slotCell('Back',0),slotCell('Input',31)]);assert.equal(insertRow(a,1),false,'a button would go past the end');assert.deepEqual(slots(a),{Back:0,Input:31},'and nothing changes');
  // With the arrow pad (the five arrows hold squares that are closed up): crossRow 1 puts one row above the pad.
  const pad=(cross,more)=>act([...arrowsAt(20,21,22,23,24),slotCell('Back',0),...more],cross);
  a=pad(1,[slotCell('Mute',5)]);insertRow(a,1,'above');assert.equal(a.screen.crossRow,2,'a row above the pad pushes the pad down');assert.equal(slots(a).Mute,9);assert.equal(slots(a).Back,0);
  a=pad(1,[slotCell('Mute',5)]);insertRow(a,1,'below');assert.equal(a.screen.crossRow,1,'a row below the pad leaves it where it is');assert.equal(slots(a).Mute,9);
  a=pad(1,[slotCell('Mute',5)]);insertRow(a,0);assert.equal(a.screen.crossRow,2,'a row above everything pushes the pad down too');assert.equal(slots(a).Back,4);assert.equal(slots(a).Mute,9);
  a=act([...arrowsAt(0,1,2,3,4),slotCell('Back',5),slotCell('Mute',6)],0);insertRow(a,0,'below');
  assert.equal(a.screen.crossRow,0);assert.deepEqual([slots(a).Back,slots(a).Mute],[9,10],'rows are counted without the squares the pad holds: Back and Mute were in the first row, and each moves down one row of four');
  a=act([...arrowsAt(0,1,2,3,4),slotCell('Back',5),slotCell('Mute',6)],0);insertRow(a,0,'above');assert.equal(a.screen.crossRow,1,'a row above a pad that was at the top pushes it down');
  a=pad(0,[slotCell('Mute',6)]);insertRow(a,0,'below');assert.deepEqual([slots(a).Back,slots(a).Mute],[4,10],'buttons elsewhere simply move four slots on');
  // The pad's own buttons never move.
  a=pad(1,[slotCell('Mute',5)]);insertRow(a,1,'above');assert.deepEqual(['Up','Left','OK','Right','Down'].map(c=>slots(a)[c]),[20,21,22,23,24]);
}
// Moving and removing rows, counted the way the editor draws them.
{
  const {moveRow,removeRow}=context.exports;
  const act=(cells,crossRow=0)=>({id:'a',steps:[],screen:{columns:4,crossRow,cells:cells.map(c=>({...c})),pinned:[]}});
  const slots=a=>Object.fromEntries(a.screen.cells.map(c=>[c.command,c.slot]));
  let a=act([slotCell('Back',0),slotCell('Input',4),slotCell('Mute',8)]);
  assert.equal(moveRow(a,1,-1),true);assert.deepEqual(slots(a),{Back:4,Input:0,Mute:8},'a row swaps with the one above');
  assert.equal(moveRow(a,0,-1),false,'the first row cannot move up');assert.equal(moveRow(a,2,1),false,'and the last cannot move down when there is no room below');
  a=act([slotCell('Back',0)]);assert.equal(moveRow(a,0,1),false,'no room below');assert.equal(moveRow(a,0,1,1),true);assert.deepEqual(slots(a),{Back:4},'with a row of room below it can move into it');
  a=act([slotCell('Back',0),slotCell('Mute',5)]);moveRow(a,1,-1);assert.deepEqual(slots(a),{Back:4,Mute:1},'a button keeps its column when its row moves');
  a=act([slotCell('Back',0),slotCell('Input',8)]);assert.equal(removeRow(a,1),true);assert.deepEqual(slots(a),{Back:0,Input:4},'a blank row closes up');
  assert.equal(removeRow(a,0),false,'a row with a button is not removed');assert.deepEqual(slots(a),{Back:0,Input:4});
  // With the arrow pad: rows stay on their side of it.
  const pad=(crossRow,cells)=>act([...arrowsAt(20,21,22,23,24),...cells],crossRow);
  a=pad(1,[slotCell('Back',0),slotCell('Mute',5)]);
  assert.equal(moveRow(a,0,1),false,'the row above the pad cannot move down past it');assert.equal(moveRow(a,1,-1),false,'nor the row below move up past it');
  a=pad(2,[slotCell('Back',0),slotCell('Mute',8)]);assert.equal(removeRow(a,1),true);assert.equal(a.screen.crossRow,1,'removing a blank row above the pad moves the pad up with the rows below');assert.deepEqual([slots(a).Back,slots(a).Mute],[0,4]);
  a=pad(1,[slotCell('Back',0),slotCell('Mute',9)]);assert.equal(removeRow(a,1),true);assert.equal(a.screen.crossRow,1,'a blank row below the pad leaves the pad where it is');assert.equal(slots(a).Mute,5);
  a=pad(1,[slotCell('Back',0),slotCell('Mute',5),slotCell('Input',9)]);moveRow(a,1,1);assert.deepEqual([slots(a).Mute,slots(a).Input],[9,5],'rows below the pad swap');
  assert.deepEqual(['Up','Left','OK','Right','Down'].map(c=>slots(a)[c]),[20,21,22,23,24],'the pad\'s own buttons never move');
}
// Corner buttons of a complete cross show in the 3x3 block, and the squares they held close up too.
{
  const withCorner=remoteHtml({columns:4,cells:[...arrowsAt(0,1,2,3,4),{...slotCell('Back',5),corner:'tl'},{...slotCell('Input',6),corner:'br'},slotCell('Mute',7)]}).body;
  const dpad=withCorner.slice(0,withCorner.indexOf('</div>'));
  assert.deepEqual([...dpad.matchAll(/class="cell (\w+)"/g)].map(m=>m[1]),['tl','up','left','ok','right','down','br'],'corners join the cross, in reading order');
  assert.deepEqual(slotsOf(withCorner.split('</div>').slice(1).join('')),['Mute','_','_','_'],'the corner buttons leave no hole behind');
  // Without a complete cross a corner marker is ignored: the button stays in the grid at its slot.
  assert.deepEqual(slotsOf(remoteHtml({columns:4,cells:[{...slotCell('Back',0),corner:'tl'},slotCell('Mute',1)]}).body),['Back','Mute','_','_']);
}
console.log('Buttons keep their grid slot: gaps stay open, empty rows collapse, and older packed lists fill in order');

// Volume is hardware-only; stale cells are skipped; legacy label/wide are ignored.
assert.deepEqual(kinds(remoteBlocks([cell('VolumeUp'),cell('VolumeDown'),cell('Mute'),cell('Gone'),cell('Back','missing')])),['Mute']);
const legacy=remoteHtml({columns:2,cells:[cell('Mute','tv',{label:'Shhh',wide:true})]}).body;
assert.doesNotMatch(legacy,/Shhh|wide/);assert.match(legacy,/data-columns="2"/);assert.match(legacy,/aria-label="Mute"/);
// Known commands show an icon, unknown ones their own name; everything is escaped.
const iconsHtml=remoteHtml({cells:[cell('Mute'),cell('HDMI 1')]}).body;
assert.match(iconsHtml,/icon-VolumeX/);assert.match(iconsHtml,/<span class="cell-text">HDMI 1<\/span>/);
state.devices=[{id:'x',commands:[{name:'<b>"x"'}]}];
assert.doesNotMatch(remoteHtml({cells:[cell('<b>"x"','x')]}).body,/<b>/);
state.devices=[tv,bar];
assert.match(remoteHtml(undefined).body,/^$/);assert.equal(remoteHtml(undefined).pinned,'');
console.log('Remote view hides volume and stale cells, ignores label/wide, shows names for unknown commands, escapes everything');

// Pinned footer: same renderer, separate from the scrolling cells.
const pinnedView=remoteHtml({columns:4,cells:[cell('Back')],pinned:[cell('Mute'),cell('Gone'),cell('VolumeUp'),cell('Input')]});
assert.equal((pinnedView.pinned.match(/data-command=/g)||[]).length,2);
assert.doesNotMatch(pinnedView.body,/Mute/);
// The fixed row's buttons share the full width, whatever the count and wherever the gaps were.
for(const count of [1,2,3,4]){
  const row=remoteHtml({columns:4,cells:[],pinned:['Right','Up','Down','Left'].slice(0,count).map(c=>cell(c))}).pinned;
  assert.match(row,/^<div class="cells pinned-row">/);assert.doesNotMatch(row,/data-columns|<span><\/span>/,`${count} buttons: no empty grid squares`);
  assert.equal((row.match(/data-command=/g)||[]).length,count);
  assert.doesNotMatch(row,/\[object|undefined/,`${count} buttons: nothing but real faces`);assert.equal((row.match(/<button class="cell " type="button"/g)||[]).length,count,'plain cell buttons, no stray class');assert.equal((row.match(/<svg/g)||[]).length,count);
}
{
  const gapped=remoteHtml({columns:4,cells:[],pinned:[{...cell('Mute'),slot:0},{...cell('Input'),slot:3}]}).pinned;
  assert.equal((gapped.match(/data-command=/g)||[]).length,2);assert.doesNotMatch(gapped,/<span><\/span>/,'a gap left by a removed button does not leave a hole');
  assert.ok(gapped.indexOf('Mute')<gapped.indexOf('Input'),'and they stay in slot order');
  const reversed=remoteHtml({columns:4,cells:[],pinned:[{...cell('Input'),slot:3},{...cell('Mute'),slot:0}]}).pinned;assert.ok(reversed.indexOf('Mute')<reversed.indexOf('Input'),'slot order, not list order');
}
// Pinning all four arrows keeps them as a row in the order set, not a cross.
const arrowRow=remoteHtml({columns:4,cells:[],pinned:['Right','Up','Down','Left'].map(c=>cell(c))}).pinned;
assert.doesNotMatch(arrowRow,/class="dpad"/);
assert.deepEqual([...arrowRow.matchAll(/aria-label="(\w+)"/g)].map(m=>m[1]),['Right','Up','Down','Left']);
console.log('Pinned buttons render as their own footer row, skipping stale and volume cells');

// Full screen: no edit link in the header for anyone (editing lives in Setup), footer outside the scrolling content.
state.config={activities:[{id:'watch',name:'Watch <TV>',steps:[{deviceId:'tv'}],screen:{columns:4,cells:[cell('Back')],pinned:[cell('Mute')]}}]};
const rc={content:{innerHTML:'',querySelectorAll:()=>[]},actions:{innerHTML:''},params:['watch'],setTitle(t){this.title=t;}};
state.session={role:'owner'};context.exports.renderActivityRemote(rc);
assert.equal(rc.title,'Watch <TV>');
assert.equal(rc.actions.innerHTML,'');
assert.match(rc.content.innerHTML,/class="pinned"/);
rc.actions.innerHTML='';state.session={role:'controller'};context.exports.renderActivityRemote(rc);
assert.equal(rc.actions.innerHTML,'');
rc.params=['nope'];context.exports.renderActivityRemote(rc);assert.match(rc.content.innerHTML,/no longer exists/);
console.log('Activity remote has no edit link in the header and copes with a missing activity');

// The layout editor is part of editing an activity (in the original UI), and Back from it returns there.
state.session={role:'owner'};
context.location.hash='#/edit/watch';show();
assert.equal(el('back').dataset.href,'/#activities');assert.equal(el('back').hidden,false);
assert.equal('layouts' in context.exports.screens,false,'there is no separate Remote layouts screen');
context.location.hash='#/activity/watch';show();
assert.equal(el('back').dataset.href,'#/activities');assert.equal(context.document.body.dataset.reserveNotice,'true');assert.equal(context.document.body.dataset.screen,'activity','the screen name is on the body for per-screen styling');
context.location.hash='#/devices';show();assert.equal(context.document.body.dataset.reserveNotice,'false');
context.location.hash='#/setup';show();assert.equal(context.document.body.dataset.reserveNotice,'true','Setup holds space for its saved/error notice so the form does not jump');context.location.hash='#/devices';show();
console.log('Back arrows return to the right parent; only remotes reserve space for send status');

// ---- Hardware volume ----
const sent=[];context.api=async(path,body)=>{sent.push({path,...body});return {id:'op'};};context.operation=async()=>({state:'completed'});
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const setActivity=(activity)=>{state.config={activities:[activity]};store.set('harmony-activity',activity?.id||'');};
state.online=true;
const press=async d=>{sent.length=0;context.window.harmonyHardwareVolume(d);await flush();return sent.filter(c=>c.path!=='session').map(c=>[c.deviceId,c.command]);};
setActivity({id:'a',steps:[{deviceId:'bar'}],screen:{cells:[cell('VolumeUp'),cell('VolumeDown')]}});
assert.deepEqual(J(await press('up')),[['tv','VolumeUp']]);
assert.deepEqual(J(await press('down')),[['tv','VolumeDown']]);
// A screen cell for a deleted device/command is skipped in favour of the next one.
setActivity({id:'a',steps:[],screen:{cells:[cell('VolumeUp','gone'),cell('VolUp','bar')]}});
assert.deepEqual(J(await press('up')),[['bar','VolUp']]);
// No volume cell (the new editor can't place one): fall back to the start-step devices.
setActivity({id:'a',steps:[{deviceId:'tv'},{deviceId:'bar'}],screen:{cells:[cell('Back')]}});
assert.deepEqual(J(await press('up')),[['tv','VolumeUp']]);
setActivity({id:'a',steps:[{deviceId:'bar'}]});
assert.deepEqual(J(await press('down')),[['bar','VolDn']]);
setActivity({id:'a',steps:[{delay:1},{deviceId:'missing'}]});
assert.deepEqual(J(await press('up')),[]);
setActivity(null);state.config={activities:[]};assert.deepEqual(J(await press('up')),[]);
setActivity({id:'a',steps:[{deviceId:'tv'}]});state.online=false;assert.deepEqual(J(await press('up')),[]);state.online=true;
// Ignored while a previous volume command is still in flight.
let finishOp;context.operation=()=>new Promise(r=>finishOp=r);
sent.length=0;context.window.harmonyHardwareVolume('up');context.window.harmonyHardwareVolume('up');await flush();
assert.equal(sent.length,1);finishOp({state:'completed'});await flush();
context.operation=async()=>({state:'completed'});
assert.deepEqual(J(await press('up')),[['tv','VolumeUp']]);
console.log('Hardware volume uses a screen volume cell, else the start-step devices, skips stale targets and ignores overlapping presses');
// Regression: an empty reserved notice has no height unless the rule gives it one,
// which let "Sent to the hub." push the whole remote down under the user's finger.
assert.match(css,/body\[data-reserve-notice=true\] #notice\{min-height:\d+px\}/);
assert.match(css,/body\[data-reserve-notice=true\] #notice\[hidden\]\{display:block!important;visibility:hidden\}/);
console.log('Remote screens reserve space for the send status so a press cannot shift the buttons');

// ---- Device remote ----
const names=html=>[...html.matchAll(/data-command="([^"]*)"/g)].map(m=>m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
const dev=(id,commands,extra={})=>({id,name:id,transport:'ir',commands:commands.map(name=>({name})),...extra});
const full=dev('full',['PowerOn','PowerOff','Up','Down','Left','Right','OK','Back','Input','Mute','VolumeUp','VolumeDown','Home','Play','Pause','Stop','Guide','HDMI 1','Sleep Timer','Zoom']);
let h=context.exports.deviceRemoteHtml(full);
// Every command appears exactly once: nothing hidden, nothing duplicated.
assert.deepEqual(names(h).sort(),full.commands.map(c=>c.name).sort());
assert.match(h,/<span class="cell-label">On<\/span>/);assert.match(h,/<span class="cell-label">Off<\/span>/);
assert.match(h,/class="dpad"/);
// The cross sits between the power row and the back/input/mute row; the rest follows "All commands".
const at=re=>h.search(re);
assert.ok(at(/cells power/)<at(/class="dpad"/)&&at(/class="dpad"/)<at(/data-columns="3"/)&&at(/data-columns="3"/)<at(/All commands/));
const listed=names(h.slice(at(/All commands/)));
assert.ok(listed.includes('VolumeUp')&&listed.includes('VolumeDown'),'volume stays reachable on a device remote');
assert.ok(!listed.includes('Up')&&!listed.includes('Mute'));
assert.match(h,/<span class="cell-text">Volume up<\/span>/);assert.doesNotMatch(h,/icon-Plus|icon-Minus/);
assert.match(context.exports.deviceRemoteHtml(dev('ch',['ChannelUp','ChannelDown'])),/<span class="cell-text">Channel up<\/span>/);
assert.match(h,/<span class="cell-text">HDMI 1<\/span>/);
console.log('Device remote shows power, cross and back/input/mute first, then every other command, each exactly once');

// A toggle-only power button, no arrows: Power alone, arrows fall into the list.
h=context.exports.deviceRemoteHtml(dev('tog',['Power','Up','Down','Mute','Source']));
assert.deepEqual(names(h).sort(),['Down','Mute','Power','Source','Up']);
assert.match(h,/data-columns="1"/);assert.match(h,/<span class="cell-label">Power<\/span>/);assert.doesNotMatch(h,/class="dpad"/);
// Missing OK still gets a cross; missing a whole arrow does not.
assert.match(context.exports.deviceRemoteHtml(dev('d',['Up','Down','Left','Right'])),/class="dpad"/);
assert.doesNotMatch(context.exports.deviceRemoteHtml(dev('d',['Up','Down','Left','OK'])),/class="dpad"/);
// Nothing to curate: a saved custom layout does not hide or relabel anything here.
state.config={layouts:{lay:[{slot:'mute',label:'Shh',command:'Mute'}]},activities:[]};
h=context.exports.deviceRemoteHtml(dev('lay',['Mute','Up']));
assert.deepEqual(names(h).sort(),['Mute','Up']);assert.doesNotMatch(h,/Shh/);
assert.equal(context.exports.deviceRemoteHtml(dev('empty',[])),'');
assert.equal(context.exports.deviceRemoteHtml({id:'nocmds',name:'x'}),'');
assert.doesNotMatch(context.exports.deviceRemoteHtml(dev('x',['<img src=x>"'])),/<img/);
console.log('Device remote handles toggle-only power, partial arrows, saved layouts, empty devices and escapes names');

// Invariant: a device carrying every alias of every control still shows each command once.
const everything=dev('all',[...new Set(context.exports.CONTROLS.flatMap(c=>c[3]))]);
const everyHtml=context.exports.deviceRemoteHtml(everything);
assert.deepEqual(names(everyHtml).sort(),everything.commands.map(c=>c.name).sort());
console.log('Every control alias on one device still renders each command exactly once');

// Screen: no edit link, send-status space reserved, missing device handled.
state.devices=[full];state.session={role:'owner'};
const dc={content:{innerHTML:'',querySelectorAll:()=>[]},actions:{innerHTML:''},params:['full'],setTitle(t){this.title=t;}};
context.exports.renderDeviceRemote(dc);
assert.equal(dc.title,'full');assert.equal(dc.actions.innerHTML,'');assert.doesNotMatch(dc.content.innerHTML,/pinned|edit/i);
dc.params=['nope'];context.exports.renderDeviceRemote(dc);assert.match(dc.content.innerHTML,/no longer exists/);
context.location.hash='#/device/full';show();
assert.equal(el('back').dataset.href,'#/devices');assert.equal(context.document.body.dataset.reserveNotice,'true');
console.log('Device remote has no edit link, goes back to Devices and reserves space for send status');

// Hardware volume follows the device remote while it is open, the running activity otherwise.
const bar2=dev('bar2',['VolUp','VolDn']);state.devices=[full,bar2];
state.config={activities:[{id:'a',steps:[{deviceId:'bar2'}]}]};store.set('harmony-activity','a');state.online=true;
context.location.hash='#/device/full';
assert.deepEqual(J(await press('up')),[['full','VolumeUp']]);
context.location.hash='#/activities';
assert.deepEqual(J(await press('up')),[['bar2','VolUp']]);
context.location.hash='#/device/nope';
assert.deepEqual(J(await press('up')),[['bar2','VolUp']],'an unknown device route falls back to the running activity');
context.location.hash='#/device/'+encodeURIComponent('bar2');store.set('harmony-activity','');
assert.deepEqual(J(await press('down')),[['bar2','VolDn']],'works with no running activity too');
context.location.hash='#/activities';assert.deepEqual(J(await press('down')),[]);
// A device remote with no volume command falls back to the running activity.
state.devices=[full,bar2,dev('roku',['Home','Play'])];store.set('harmony-activity','a');
context.location.hash='#/device/roku';
assert.deepEqual(J(await press('up')),[['bar2','VolUp']]);
store.set('harmony-activity','');assert.deepEqual(J(await press('up')),[]);
console.log('Hardware volume drives the open device remote, else the running activity');

// ---- Edit remote layout ----
const X=context.exports;
const sc=(command,slot,deviceId='tv')=>({deviceId,command,slot});
assert.deepEqual([0,7,8,31,32].map(n=>X.editorSlots('cells',n,4)),[4,8,12,32,32]);
assert.equal(X.editorSlots('cells',8,4,1),16);assert.equal(X.editorSlots('cells',30,4,5),32);
assert.equal(X.editorSlots('cells',3,2),4);assert.equal(X.editorSlots('pinned',1,4),4);assert.equal(X.editorSlots('pinned',0,2),2);
console.log('Editor always offers an empty row beyond the last used slot, honours Add row, and stops at 32 slots');

// Available commands: start-step devices, minus placed (grid or footer) and volume.
state.devices=[tv,bar];
const act0={id:'w',name:'W',steps:[{deviceId:'tv'},{delayMs:5},{deviceId:'tv'},{deviceId:'gone'},{deviceId:'bar'}],screen:{columns:4,cells:[sc('Up',0),sc('Mute',1)],pinned:[sc('Back',0)]}};
const avail=X.availableCommands(act0).map(o=>o.device.id+':'+o.command);
assert.ok(!avail.includes('tv:Up')&&!avail.includes('tv:Mute')&&!avail.includes('tv:Back'),'placed commands are not offered again');
assert.ok(!avail.some(a=>/Volume|VolUp|VolDn/.test(a)),'volume is left to the hardware keys');
assert.ok(avail.includes('tv:OK')&&avail.includes('tv:HDMI 1')&&avail.includes('bar:Mute'));
assert.equal(new Set(avail).size,avail.length);assert.ok(!avail.some(a=>a.startsWith('gone')));
assert.deepEqual(J(X.availableCommands({id:'n',steps:[]})),[]);
console.log("Add menu offers the start-step devices' commands minus placed and volume ones");

// Mutations are slot-addressed: adding goes where asked, removing leaves a hole, nothing shifts.
const bare={id:'b',name:'B',steps:[]};
assert.deepEqual(J(X.screenOf(bare)),{columns:4,cells:[],pinned:[]});
assert.equal(X.addButton(bare,'cells',5,'tv','Up'),true);
assert.equal(X.addButton(bare,'cells',5,'tv','Down'),false,'the slot is taken');
assert.equal(X.addButton(bare,'cells',2,'tv','Up'),false,'no duplicates');
assert.equal(X.addButton(bare,'cells',2,'tv','Down'),true);
assert.deepEqual(J(bare.screen.cells),[sc('Down',2),sc('Up',5)],'kept in slot order');
assert.equal(X.addButton(bare,'pinned',0,'tv','Up'),false,'not on both the grid and the footer');
for(const [slot,c] of [[3,'OK'],[1,'Input'],[0,'Back'],[2,'Mute']])assert.equal(X.addButton(bare,'pinned',slot,'tv',c),true);
assert.deepEqual(J(bare.screen.pinned.map(c=>c.command)),['Back','Input','Mute','OK']);
for(const slot of [4,-1,1.5,'1',NaN])assert.equal(X.addButton(bare,'pinned',slot,'tv','Left'),false,`bad footer slot ${slot}`);
assert.equal(X.removeButton(bare,'cells',2),true);
assert.deepEqual(J(bare.screen.cells),[sc('Up',5)],'removing leaves the other button where it was');
assert.equal(X.removeButton(bare,'cells',2),false,'already empty');
bare.screen.cells=Array.from({length:X.MAX_CELLS},(_,i)=>sc('C'+i,i));
assert.equal(X.addButton(bare,'cells',X.MAX_CELLS,'tv','Left'),false,'the grid stops at 32 slots');
const narrow={id:'n',steps:[],screen:{columns:2,cells:[],pinned:[]}};
assert.equal(X.addButton(narrow,'pinned',0,'tv','Up'),true);assert.equal(X.addButton(narrow,'pinned',1,'tv','Down'),true);assert.equal(X.addButton(narrow,'pinned',2,'tv','Left'),false);
console.log('Adding goes into the chosen slot, removing leaves a hole, and slot/limit/duplicate rules hold');

// Draft and save.
const shapeOf=X.layoutShape, mk=(cells,pinned=[],columns=4)=>({columns,cells,pinned});
assert.equal(shapeOf(undefined),shapeOf({columns:4,cells:[],pinned:[]}));
assert.notEqual(shapeOf(mk([cell('Up')])),shapeOf(mk([])));assert.notEqual(shapeOf(mk([],[cell('Up')])),shapeOf(mk([cell('Up')])));
assert.equal(shapeOf(mk([cell('Up'),cell('Down')])),shapeOf(mk([sc('Up',0),sc('Down',1)])),'a packed legacy list equals the same layout with slots');
assert.notEqual(shapeOf(mk([sc('Up',0)])),shapeOf(mk([sc('Up',3)])),'moving a button is a change');
{
  const act={id:'w',name:'W',steps:[],screen:mk([cell('Up'),cell('Down')])};   // saved before slots existed
  store.set('harmony-layout-draft:w','{"base":"x","draft":{"cells":[],"pinned":[]}}');   // a leftover from an older version is ignored
  const d=X.startDraft(act);store.delete('harmony-layout-draft:w');
  assert.equal(d.base,shapeOf(act.screen));
  assert.deepEqual(J(d.draft),{columns:4,crossRow:0,cells:[sc('Up',0),sc('Down',1)],pinned:[]},'the draft gives every button a slot');
  assert.equal(shapeOf(d.draft),d.base,'...without counting as a change');
  d.draft.cells.push(sc('Mute',2));assert.equal(act.screen.cells.length,2);assert.equal(act.screen.cells[0].slot,undefined,'the draft is a copy');
}
console.log('Drafts start from the hub layout (giving old lists slots) and are copies');

{
  const posts=[];let hub,failPost=false;
  const reset=()=>{hub={revision:9,setupMode:'keep',layouts:{},activities:[
    {id:'w',name:'W',steps:[],screen:{columns:4,cells:[cell('Up')],pinned:[],extra:'kept'}},{id:'o',name:'Other',steps:[],screen:mk([cell('Mute')])}]};posts.length=0;failPost=false;};
  context.api=async(path,body)=>{
    if(path!=='configuration')return {};
    if(!body)return J(hub);
    posts.push(J(body));
    if(failPost)throw Error('Invalid configuration, layout or activity sequence.');
    hub={...J(body.configuration),revision:body.revision+1};return {ok:true};
  };
  const base=shapeOf(mk([cell('Up')])), draft=mk([sc('Up',0),sc('Down',3)],[sc('Mute',2)]);
  state.config={revision:1,activities:[]};
  reset();let confirms=0;
  assert.equal(await X.submitLayout('w',draft,base,()=>{confirms++;return true;}),true);
  assert.equal(posts.length,1);assert.equal(confirms,0);
  assert.equal(posts[0].revision,9,'uses the hub\'s current revision, not this tab\'s');
  const sent=posts[0].configuration;
  assert.deepEqual(sent.activities[0].screen.cells,[sc('Up',0),sc('Down',3)],'slots, including the gap, are saved');assert.deepEqual(sent.activities[0].screen.pinned,[sc('Mute',2)]);
  assert.equal(sent.activities[0].screen.extra,'kept','other screen fields survive');
  assert.deepEqual(J(sent.activities[1]),J({id:'o',name:'Other',steps:[],screen:mk([cell('Mute')])}),'other activities are untouched');
  assert.equal(state.config.revision,10,'local config is refreshed from the hub after saving');
  reset();hub.activities[0].screen.cells.push(cell('Left'));
  assert.equal(await X.submitLayout('w',draft,base,()=>{confirms++;return false;}),false);assert.equal(confirms,1);assert.equal(posts.length,0);
  assert.equal(await X.submitLayout('w',draft,base,()=>true),true);assert.equal(posts.length,1);
  reset();hub.activities.shift();state.config={revision:1,marker:true,activities:[]};
  await assert.rejects(X.submitLayout('w',draft,base,()=>true),/no longer exists/);assert.equal(posts.length,0);
  reset();failPost=true;await assert.rejects(X.submitLayout('w',draft,base,()=>true),/Invalid configuration/);
  assert.equal(posts.length,1);assert.equal(state.config.marker,true);
}
console.log('Save is one write from the hub\'s current config, asks before replacing a layout changed elsewhere, and fails without side effects');

// Rendering: gaps are real empty slots; stale and volume cells stay visible (and removable).
state.devices=[tv,bar];
const editAct=X.cloneScreen({columns:4,cells:[cell('Up'),cell('VolumeUp'),sc('Gone',5),cell('HDMI 1')],pinned:[sc('Mute',2)]});
const eh=X.editorHtml({id:'w',steps:[{deviceId:'tv'}],screen:editAct},{extraRows:0});
const filled=(html,zone)=>[...html.matchAll(new RegExp(`class="cell(?: (?!empty)[a-z]+)?(?: missing)?" type="button" data-zone="${zone}" data-slot="(\\d+)" aria-label`,'g'))].map(m=>+m[1]);
const emptied=(html,zone)=>[...html.matchAll(new RegExp(`class="cell empty(?: (?:ok|tl|tr|bl|br))?" type="button" data-zone="${zone}" data-slot="(\\d+)"`,'g'))].map(m=>+m[1]);
assert.deepEqual(filled(eh,'cells'),[0,1,2,5]);   // Up,VolumeUp,HDMI 1 packed into 0..2 (they had no slots); Gone at 5
assert.deepEqual(emptied(eh,'cells'),[3,4,6,7],'slots between buttons are empty squares');
assert.deepEqual(filled(eh,'pinned'),[0],'the fixed row has no gaps: its button sits in slot 0');assert.deepEqual(emptied(eh,'pinned'),[1],'with one add square after it');
assert.match(eh,/class="cell missing" type="button" data-zone="cells" data-slot="5"/);
assert.match(eh,/Gone \(its device or command no longer exists\)\. Press and hold to remove\./);
assert.match(eh,/aria-label="Volume up\. Press and hold to remove\."/);
assert.match(eh,/aria-label="Empty slot\. Tap to add a button\."/);
assert.doesNotMatch(eh,/class="edit-hint"/,'no paragraph above the grid pushing the buttons down');
assert.match(eh,/<p class="pinned-caption">Fixed bottom row<\/p>/,'the fixed row says what it is');assert.doesNotMatch(eh,/Always visible/i);
assert.match(eh,/data-add-row/);assert.doesNotMatch(eh,/data-command=/,'editor buttons must never send commands');
assert.deepEqual(emptied(X.editorHtml({id:'w',steps:[],screen:editAct},{extraRows:1}),'cells').length,8);
const fullAct={id:'f',steps:[],screen:{columns:4,cells:Array.from({length:32},(_,i)=>sc('C'+i,i)),pinned:[]}};
const fh=X.editorHtml(fullAct,{extraRows:0});assert.doesNotMatch(fh,/data-add-row/);assert.match(fh,/button limit/);
const twoCol=X.editorHtml({id:'x',steps:[],screen:{columns:2,cells:[],pinned:[]}},{extraRows:0}).split('class="pinned"')[1];
assert.deepEqual(emptied(twoCol,'pinned'),[0],'an empty 2-column footer offers one add square');
assert.doesNotMatch(remoteHtml({columns:4,cells:[],pinned:[cell('Mute')]}).pinned,/Always visible/i);
console.log('Editor draws gaps as empty squares, lists every cell (including stale and volume ones) and never sends commands');

// ---- Edit gestures (fake timers) ----
{
  let clock=0,seq=0,wall=1000;const timers=new Map();
  context.setTimeout=(fn,ms)=>{timers.set(++seq,{fn,at:clock+ms});return seq;};
  context.clearTimeout=id=>timers.delete(id);
  context.Date={now:()=>wall};
  const advance=ms=>{clock+=ms;wall+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}};
  let hub,posts=[];
  const newHub=activity=>{hub={revision:1,setupMode:'keep',layouts:{},activities:[J(activity)]};posts=[];};
  context.api=async(path,body)=>{
    if(path!=='configuration')return {};
    if(!body)return J(hub);
    posts.push(J(body.configuration.activities[0].screen));hub={...J(body.configuration),revision:body.revision+1};return {ok:true};
  };
  const sheet=Object.assign(el('sheet'),{open:false,innerHTML:'',onclick:null,showModal(){this.open=true;},close(){const was=this.open;this.open=false;if(was)this.onclose?.();}});
  const setup=(activity,{owner=true,extraDevices=[]}={})=>{
    newHub(activity);state.devices=[tv,bar,...extraDevices];state.session={role:owner?'owner':'controller'};state.config=J(hub);
    context.location.hash='#/edit/'+activity.id;sheet.open=false;context.confirmed=[];context.confirmAnswer=true;el('notice').textContent='';
    const content={innerHTML:'',isConnected:true,querySelector:()=>null};
    const ctx={content,actions:{innerHTML:'',onclick:null},params:[activity.id],setTitle(t){this.title=t;}};
    X.renderEditor(ctx);return {content,ctx};
  };
  const layout=(content,zone)=>Object.fromEntries([...content.innerHTML.matchAll(new RegExp(`class="cell(?: (?!empty)[a-z]+)?(?: missing)?" type="button" data-zone="${zone}" data-slot="(\\d+)" aria-label="([^".]*)`,'g'))].map(m=>[+m[1],m[2]]));
  const empties=(content,zone)=>[...content.innerHTML.matchAll(new RegExp(`class="cell empty(?: (?:ok|tl|tr|bl|br))?" type="button" data-zone="${zone}" data-slot="(\\d+)"`,'g'))].map(m=>+m[1]);
  const slotBtn=(content,zone,slot)=>{
    const isEmpty=new RegExp(`class="cell empty(?: (?:ok|tl|tr|bl|br))?" type="button" data-zone="${zone}" data-slot="${slot}"`).test(content.innerHTML);
    assert.ok(isEmpty||new RegExp(`data-zone="${zone}" data-slot="${slot}"`).test(content.innerHTML),`${zone} slot ${slot} should be rendered`);
    const corner=new RegExp(`data-zone="${zone}" data-slot="${slot}" data-corner="(\\w+)"`).exec(content.innerHTML)?.[1];
    return {dataset:{zone,slot:String(slot),...(corner?{corner}:{})},classList:{contains:c=>c==='empty'&&isEmpty}};
  };
  const down=(content,b,x=10,y=10)=>content.onpointerdown({target:{closest:()=>b},button:0,clientX:x,clientY:y});
  const tapSlot=(content,zone,slot)=>content.onclick({target:{closest:sel=>sel==='[data-zone]'?slotBtn(content,zone,slot):null}});
  const pickFrom=label=>[...sheet.innerHTML.matchAll(/data-pick="(\d+)"[^>]*>(?:<[^>]*>)*[^<]*<\/span>([^<]*)</g)].find(m=>m[2]===label)?.[1];
  const choose=async label=>{sheet.onclick({target:{closest:sel=>sel==='[data-pick]'?{dataset:{pick:pickFrom(label)}}:null}});await settle();};
  const click=(content,attr)=>content.onclick({target:{closest:sel=>sel===attr?{}:null}});
  const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  const saveEnabled=ctx=>!/data-save\s+disabled/.test(ctx.actions.innerHTML);
  const pressSave=async ctx=>{ctx.actions.onclick({target:{closest:sel=>sel==='[data-save]'?{}:null}});await settle();};
  const base0={id:'w',name:'W',steps:[{deviceId:'tv'}],screen:{columns:4,cells:[sc('Up',0),sc('Down',1),sc('Mute',2)],pinned:[sc('Back',0)]}};

  // Press-and-hold a button removes it from the DRAFT and leaves its slot empty; nothing is written to the hub yet.
  let {content,ctx}=setup(base0);
  assert.equal(ctx.title,'Edit remote');assert.equal(saveEnabled(ctx),false,'nothing to save yet');assert.doesNotMatch(content.innerHTML,/Unsaved changes/);
  down(content,slotBtn(content,'cells',1));advance(349);assert.deepEqual(layout(content,'cells'),{0:'Up',1:'Down',2:'Mute'},'not before the hold time');
  advance(2);await settle();
  assert.deepEqual(layout(content,'cells'),{0:'Up',2:'Mute'},'the buttons to the right do not move');
  assert.ok(empties(content,'cells').includes(1),'the vacated slot is an empty square');
  assert.equal(posts.length,0,'editing never writes to the hub');
  assert.equal(state.config.activities[0].screen.cells.length,3,'the loaded config is untouched until Save');
  assert.ok(![...store.keys()].some(k=>k.startsWith('harmony-layout')),'edits are not stored on this device');
  assert.equal(saveEnabled(ctx),true);assert.doesNotMatch(content.innerHTML,/Unsaved changes|draft-bar/,'no banner that shifts the grid');
  // The click from lifting the finger over the now-empty square must not open the sheet; a later tap does.
  tapSlot(content,'cells',1);assert.equal(sheet.open,false,'ignored right after a long-press removal');
  advance(800);tapSlot(content,'cells',1);assert.equal(sheet.open,true);sheet.close();
  // A tap (released early) and a drag past the slop do nothing; nor does a hold during which the page scrolled.
  for(const stop of ['up','move','cancel']){
    down(content,slotBtn(content,'cells',0));
    if(stop==='up')content.onpointerup();
    if(stop==='move')content.onpointermove({clientX:10,clientY:40});
    if(stop==='cancel'){context.window.scrollY=40;}
    advance(1000);await settle();
    assert.deepEqual(layout(content,'cells'),{0:'Up',2:'Mute'},stop);
  }
  context.window.scrollY=0;
  // Holding an empty square does nothing (it is a tap target, not a hold target).
  down(content,slotBtn(content,'cells',1));advance(1000);await settle();assert.equal(sheet.open,false);assert.deepEqual(layout(content,'cells'),{0:'Up',2:'Mute'});
  // Chrome fires pointercancel when a pan starts, even for a tiny drift; with no actual scroll the hold still counts.
  down(content,slotBtn(content,'cells',0));content.onpointermove({clientX:12,clientY:14});content.onpointercancel?.();advance(600);await settle();
  assert.deepEqual(layout(content,'cells'),{2:'Mute'},'a small wobble and a pointercancel still count as holding');
  // Navigating away before the hold completes does nothing.
  down(content,slotBtn(content,'cells',2));context.location.hash='#/devices';advance(600);await settle();
  assert.equal(posts.length,0);

  // Tapping an empty square adds the chosen command in THAT slot (grid and footer); still only the draft changes.
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[sc('Up',0)],pinned:[]}}));
  click(content,'[data-add-row]');content.onclick({target:{closest:sel=>sel==='[data-place-row]'?{dataset:{placeRow:'1'}}:null}});   // a second row of empty squares, below the last
  tapSlot(content,'cells',6);
  assert.equal(sheet.open,true);assert.match(sheet.innerHTML,/TV: Down/);assert.doesNotMatch(sheet.innerHTML,/TV: Up</);assert.doesNotMatch(sheet.innerHTML,/TV: Volume/);
  await choose('TV: Down');
  assert.equal(sheet.open,false);assert.deepEqual(layout(content,'cells'),{0:'Up',6:'Down'},'added where it was tapped, not at the first free slot');
  tapSlot(content,'pinned',0);await choose('TV: Mute');
  assert.deepEqual(layout(content,'pinned'),{0:'Mute'});assert.equal(posts.length,0);
  // Cancel and backdrop close the sheet without changing anything.
  tapSlot(content,'cells',3);assert.equal(sheet.open,true);
  sheet.onclick({target:{closest:sel=>sel==='[data-sheet-cancel]'?{}:null}});assert.equal(sheet.open,false);
  tapSlot(content,'cells',3);sheet.onclick({target:sheet,closest:()=>null});assert.equal(sheet.open,false);
  assert.deepEqual(layout(content,'cells'),{0:'Up',6:'Down'});
  // The open sheet owns one history entry, so Android Back closes just the sheet.
  context.pushed=0;context.backed=0;
  tapSlot(content,'cells',3);assert.equal(context.pushed,1,'opening the sheet pushes one history entry');
  sheet.onclick({target:{closest:sel=>sel==='[data-sheet-cancel]'?{}:null}});assert.equal(context.backed,1,'closing it pops that entry again');
  tapSlot(content,'cells',3);context.window.onpopstate();
  assert.equal(sheet.open,false,'Back closes the sheet');assert.equal(context.backed,1,'...without going back a second time');
  assert.equal(context.pushed,2);
  tapSlot(content,'cells',3);context.location.hash='#/activity/w';show();
  assert.equal(sheet.open,false);assert.equal(context.backed,1,'leaving the screen with the sheet open does not navigate back');assert.equal(context.window.onpopstate,null);
  context.location.hash='#/edit/w';
  assert.deepEqual(layout(content,'cells'),{0:'Up',6:'Down'});

  // Save: the whole session goes to the hub in ONE write, gaps included; the editor is clean afterwards.
  down(content,slotBtn(content,'cells',0));advance(600);await settle();   // remove Up
  assert.equal(posts.length,0);
  await pressSave(ctx);
  assert.equal(posts.length,1,'exactly one hub write for the whole session');
  assert.deepEqual(posts[0].cells,[sc('Down',6)]);assert.deepEqual(posts[0].pinned,[sc('Mute',0)]);
  assert.equal(el('notice').textContent,'Saved.');assert.equal(saveEnabled(ctx),false);
  assert.equal(state.config.activities[0].screen.cells.length,1,'the remote view now sees the new layout');
  await pressSave(ctx);assert.equal(posts.length,1,'Save with nothing changed does nothing');
  advance(800);down(content,slotBtn(content,'cells',6));advance(600);await settle();
  assert.equal(el('notice').textContent,'','a new edit clears the old "Saved." message');

  // A rejected save keeps the draft and says why.
  ({content,ctx}=setup(base0));
  down(content,slotBtn(content,'cells',0));advance(600);await settle();
  const realApi=context.api;context.api=async(path,body)=>{if(body)throw Error('Invalid configuration, layout or activity sequence.');return realApi(path,body);};
  await pressSave(ctx);
  assert.match(el('notice').textContent,/^Not saved: Invalid configuration/);assert.equal(el('notice').dataset.error,'true');
  assert.deepEqual(layout(content,'cells'),{1:'Down',2:'Mute'});assert.equal(saveEnabled(ctx),true);
  context.api=realApi;await pressSave(ctx);assert.equal(posts.length,1,'a retry then succeeds');

  // The layout changed on another device: ask before replacing it.
  ({content,ctx}=setup(base0));
  down(content,slotBtn(content,'cells',0));advance(600);await settle();
  hub.activities[0].screen.cells.push(sc('Left',9));
  context.confirmAnswer=false;await pressSave(ctx);
  assert.equal(posts.length,0,'declining leaves the hub alone');assert.match(context.confirmed.at(-1),/changed on another device/);assert.equal(saveEnabled(ctx),true);
  context.confirmAnswer=true;await pressSave(ctx);assert.equal(posts.length,1);

  // Cancel asks (only when there are changes), then clears the draft and returns to the remote.
  const pressCancel=ctx=>ctx.actions.onclick({target:{closest:sel=>sel==='[data-cancel]'?{}:null}});
  ({content,ctx}=setup(base0));
  assert.match(ctx.actions.innerHTML,/data-cancel/);
  context.confirmed.length=0;pressCancel(ctx);assert.equal(context.confirmed.length,0,'clean: no prompt');assert.equal(context.assigned,'/#activities','cancel returns to the activity page in the original UI');context.assigned=undefined;
  context.location.hash='#/edit/w';
  down(content,slotBtn(content,'cells',0));advance(600);await settle();
  el('notice').textContent='Saved.';
  context.confirmAnswer=false;pressCancel(ctx);assert.deepEqual(layout(content,'cells'),{1:'Down',2:'Mute'});assert.equal(context.location.hash,'#/edit/w','declining stays put');
  context.confirmAnswer=true;pressCancel(ctx);
  assert.equal(el('notice').textContent,'');assert.equal(context.assigned,'/#activities');context.assigned=undefined;
  assert.equal(posts.length,0);
  context.location.hash='#/edit/w';

  // Leaving: the back arrow asks while there are unsaved changes; leaving discards the edits.
  ({content,ctx}=setup(base0));
  assert.equal(X.getLeaveGuard()(),true);assert.equal(context.confirmed.length,0,'no prompt when clean');
  down(content,slotBtn(content,'cells',0));advance(600);await settle();
  context.confirmAnswer=false;assert.equal(X.getLeaveGuard()(),false);assert.match(context.confirmed.at(-1),/Leave without saving/);
  context.confirmAnswer=true;assert.equal(X.getLeaveGuard()(),true);
  context.location.hash='#/activity/w';show();assert.equal(X.getLeaveGuard(),null);
  // Coming back starts from the hub's layout again; the abandoned edits are gone.
  ({content,ctx}=setup(base0));
  assert.deepEqual(layout(content,'cells'),{0:'Up',1:'Down',2:'Mute'});assert.equal(saveEnabled(ctx),false);assert.equal(el('notice').textContent,'');
  down(content,slotBtn(content,'cells',0));advance(600);await settle();
  hub.activities[0].screen.cells.push(sc('Left',9));context.confirmAnswer=false;await pressSave(ctx);
  assert.equal(posts.length,0,'a change made elsewhere meanwhile is still detected');
  context.confirmAnswer=true;

  // With all four arrows on the remote the editor draws what the remote draws: the cross first, then the other
  // buttons with the cross's squares closed up. Each square still edits its real slot.
  ({content,ctx}=setup({...base0,screen:{columns:4,pinned:[],cells:[sc('Right',0),sc('Back',1),sc('Up',2),sc('Input',3),sc('OK',4),sc('Mute',5),sc('Down',6),sc('HDMI 1',7),sc('Left',8)]}}));
  assert.match(content.innerHTML,/class="dpad"/);assert.ok(content.innerHTML.indexOf('class="dpad"')<content.innerHTML.indexOf('edit-grid'),'cross first');
  const crossPart=content.innerHTML.slice(content.innerHTML.indexOf('class="dpad"'),content.innerHTML.indexOf('edit-grid'));
  assert.deepEqual([...crossPart.matchAll(/data-slot="(\d+)"/g)].map(m=>+m[1]),[31,2,30,8,4,0,29,6,28],'corner squares (reserved at the far end), then up, left, ok, right, down at their own slots');
  const gridPart=content.innerHTML.slice(content.innerHTML.indexOf('edit-grid'),content.innerHTML.indexOf('data-add-row'));
  assert.deepEqual([...gridPart.matchAll(/data-slot="(\d+)"/g)].map(m=>+m[1]),[1,3,5,7,9,10,11,12],'the rest closed up, then one empty row');
  assert.deepEqual(empties(content,'cells'),[31,30,29,28,9,10,11,12],'the cross corners reserve slots at the far end; grid squares map to the next free real slots');
  tapSlot(content,'cells',9);await choose('TV: PowerOn');
  assert.deepEqual(Object.keys(layout(content,'cells')).map(Number).sort((a,b)=>a-b),[0,1,2,3,4,5,6,7,8,9]);assert.match(content.innerHTML,/class="dpad"/);
  // Removing OK keeps the cross: its centre becomes an empty square, and the grid below looks exactly as before.
  const gridNow=()=>content.innerHTML.slice(content.innerHTML.indexOf('edit-grid'),content.innerHTML.indexOf('data-add-row')).replace(/data-slot="\d+"/g,'');
  const gridBefore=gridNow();
  down(content,slotBtn(content,'cells',4));advance(600);await settle();
  assert.match(content.innerHTML,/class="dpad"/);
  assert.match(content.innerHTML.slice(content.innerHTML.indexOf('class="dpad"'),content.innerHTML.indexOf('edit-grid')),/class="cell empty ok" type="button" data-zone="cells" data-slot="31"/);
  assert.equal(gridNow(),gridBefore,'nothing in the grid moved or appeared');
  advance(800);tapSlot(content,'cells',31);await choose('TV: OK');
  assert.equal(gridNow(),gridBefore,'adding OK back changes nothing else');
  assert.match(content.innerHTML.slice(content.innerHTML.indexOf('class="dpad"'),content.innerHTML.indexOf('edit-grid')),/data-slot="31" aria-label="OK/);
  // A corner square takes a button of its own, shown in that corner.
  down(content,slotBtn(content,'cells',1));advance(600);await settle();   // free Back (it was in the grid) to place it in a corner
  advance(800);tapSlot(content,'cells',30);await choose('TV: Back');
  assert.match(content.innerHTML.slice(content.innerHTML.indexOf('class="dpad"'),content.innerHTML.indexOf('edit-grid')),/class="cell tl" type="button" data-zone="cells" data-slot="30" aria-label="Back/);
  assert.equal(posts.length,0,'still nothing written until Save');
  down(content,slotBtn(content,'cells',2));advance(600);await settle();   // remove Up: no complete cross any more
  assert.doesNotMatch(content.innerHTML,/class="dpad"/,'the arrows go back to the grid when the cross is incomplete');
  assert.ok(empties(content,'cells').includes(2),'...and Up\'s square is a hole');

  const place=row=>content.onclick({target:{closest:sel=>sel==='[data-place-row]'?{dataset:{placeRow:String(row)}}:null}});
  // Add arrow pad: choose a spot, and the whole cross goes there in one go, from a blank layout, without disturbing the grid.
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[sc('Back',0),sc('Mute',1)],pinned:[]}}));
  assert.match(content.innerHTML,/data-add-pad >/,'offered while there is no cross');assert.doesNotMatch(content.innerHTML,/class="dpad"/);
  const gridOf=()=>{const h=content.innerHTML,a=h.indexOf('edit-grid');return h.slice(a,h.indexOf('</div>',a));};const _g=()=>gridOf().replace(/data-slot="\d+"/g,'');
  const gridBeforePad=gridOf().replace(/data-slot="\d+"/g,'');
  click(content,'[data-add-pad]');
  assert.match(content.innerHTML,/data-place-row="0"/,'asks where to put it');assert.doesNotMatch(content.innerHTML,/class="dpad"/);assert.equal(saveEnabled(ctx),false,'nothing added until a spot is chosen');
  place(0);
  assert.match(content.innerHTML,/class="dpad"/);assert.doesNotMatch(content.innerHTML,/data-add-pad/,'gone once the cross exists');
  assert.deepEqual(Object.keys(layout(content,'cells')).map(Number).sort((a,b)=>a-b),[0,1,27,28,29,30,31],'five cross buttons at the far end of the grid');
  assert.equal(gridOf().replace(/data-slot="\d+"/g,''),gridBeforePad,'the grid is unchanged');
  assert.equal(saveEnabled(ctx),true);assert.equal(posts.length,0);
  assert.match(content.innerHTML.slice(content.innerHTML.indexOf('class="dpad"'),content.innerHTML.indexOf('edit-grid')),/class="cell empty tl"/,'the corners are open squares');
  // Arrows already placed stay where they are; only the missing ones are added.
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[sc('Up',0),sc('Left',1)],pinned:[]}}));
  click(content,'[data-add-pad]');place(0);
  assert.deepEqual(Object.keys(layout(content,'cells')).map(Number).sort((a,b)=>a-b),[0,1,29,30,31],'Down, Right and OK were added');assert.match(content.innerHTML,/class="dpad"/);
  // The editor's fixed row matches the remote: buttons share the width, plus one "+" for the next free slot.
  {
    const pinnedHtml=c=>c.innerHTML.split('class="pinned"')[1];
    ({content,ctx}=setup({...base0,screen:{columns:4,cells:[],pinned:[sc('Back',0)]}}));
    assert.match(pinnedHtml(content),/class="cells pinned-row edit-grid"/);assert.deepEqual(layout(content,'pinned'),{0:'Back'});assert.deepEqual(empties(content,'pinned'),[1],'one + square, right after the button');
    ({content,ctx}=setup({...base0,screen:{columns:4,cells:[],pinned:[sc('Back',0),sc('Input',1),sc('Mute',2),sc('OK',3)]}}));
    assert.deepEqual(empties(content,'pinned'),[],'a full row offers no more squares');
    // Removing one in the middle closes the gap; a new button goes after the last one, where the + is.
    ({content,ctx}=setup({...base0,screen:{columns:4,cells:[],pinned:[sc('Back',0),sc('Input',1),sc('Mute',2)]}}));
    down(content,slotBtn(content,'pinned',1));advance(600);await settle();
    assert.deepEqual(layout(content,'pinned'),{0:'Back',1:'Mute'},'the rest close up');assert.deepEqual(empties(content,'pinned'),[2]);
    advance(800);tapSlot(content,'pinned',2);await choose('TV: Input');
    assert.deepEqual(layout(content,'pinned'),{0:'Back',1:'Mute',2:'Input'},'the new one is on the right');assert.deepEqual(empties(content,'pinned'),[3]);
    // A layout saved with a gap at the front (a removed first button) still adds on the right.
    ({content,ctx}=setup({...base0,screen:{columns:4,cells:[],pinned:[sc('Mute',1)]}}));
    assert.deepEqual(layout(content,'pinned'),{0:'Mute'},'old gaps are closed when the editor opens');assert.equal(saveEnabled(ctx),false,'which is not a change in itself');
    tapSlot(content,'pinned',1);await choose('TV: Back');
    assert.deepEqual(layout(content,'pinned'),{0:'Mute',1:'Back'},'the + is on the right, and so is the new button');
    await pressSave(ctx);assert.deepEqual(hub.activities[0].screen.pinned,[sc('Mute',0),sc('Back',1)],'saved in order, packed');
  }
  // Arrows on the bottom row move into the pad instead of reading as "no arrow keys".
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[],pinned:['Up','Down','Left','Right'].map((c,i)=>sc(c,i))}}));
  assert.doesNotMatch(content.innerHTML,/data-add-pad disabled/);assert.doesNotMatch(content.innerHTML,/arrow keys/);
  click(content,'[data-add-pad]');place(0);
  assert.equal(Object.keys(layout(content,'pinned')).length,0,'the bottom row gave up its arrows');
  assert.match(content.innerHTML,/class="dpad"/);
  // A complete cross hides the button; a device without arrows disables it and says why.
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[],pinned:[]}}));
  ({content,ctx}=setup({...base0,steps:[{deviceId:'bar'}],screen:{columns:4,cells:[],pinned:[]}}));
  assert.match(content.innerHTML,/data-add-pad disabled/);assert.match(content.innerHTML,/doesn’t have all four arrow keys|don’t have all four arrow keys/);
  // No room: refuse rather than half-add.
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:Array.from({length:30},(_,i)=>({deviceId:'bar',command:'X'+i,slot:i})),pinned:[]}}));
  assert.match(content.innerHTML,/data-add-pad disabled/);assert.match(content.innerHTML,/isn’t room for the arrow pad/);

  // The arrow pad can sit between any two rows; the remote follows, and it can be moved or the choice cancelled.
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[sc('Back',0),sc('Input',4),sc('Mute',8)],pinned:[]}}));
  click(content,'[data-add-pad]');
  assert.deepEqual([...content.innerHTML.matchAll(/data-place-row="(\d+)"/g)].map(m=>+m[1]),[0,1,2,3],'a bar before every row and after the last');
  click(content,'[data-place-cancel]');assert.doesNotMatch(content.innerHTML,/data-place-row/);assert.doesNotMatch(content.innerHTML,/class="dpad"/);assert.equal(saveEnabled(ctx),false);
  click(content,'[data-add-pad]');place(2);
  const order=[content.innerHTML.indexOf('aria-label="Back.'),content.innerHTML.indexOf('aria-label="Input.'),content.innerHTML.indexOf('class="dpad"'),content.innerHTML.indexOf('aria-label="Mute.')];
  assert.deepEqual(order,[...order].sort((a,b)=>a-b),'Back, Input, then the pad, then Mute');
  assert.ok(order[2]>order[1]&&order[2]<order[3]);
  assert.match(content.innerHTML,/data-move-pad/);assert.doesNotMatch(content.innerHTML,/data-add-pad/);
  assert.equal(JSON.parse(JSON.stringify(ctx.actions.innerHTML)).includes('data-save'),true);
  click(content,'[data-move-pad]');assert.ok(!content.innerHTML.includes('data-place-row="2"'),'no bar where the pad already is');
  place(0);assert.ok(content.innerHTML.indexOf('class="dpad"')<content.innerHTML.indexOf('aria-label="Back. Press'),'moved to the top');assert.equal(posts.length,0);
  await pressSave(ctx);assert.equal(hub.activities[0].screen.crossRow,0);
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[sc('Back',0),sc('Input',4),sc('Mute',8)],pinned:[]}}));
  click(content,'[data-add-pad]');place(1);await pressSave(ctx);
  assert.equal(hub.activities[0].screen.crossRow,1,'the spot is saved with the layout');
  state.config=J(hub);
  const rem=remoteHtml(state.config.activities[0].screen).body;
  assert.ok(rem.indexOf('aria-label="Back"')<rem.indexOf('class="dpad"')&&rem.indexOf('class="dpad"')<rem.indexOf('aria-label="Input"'),'the remote draws the pad where it was placed');

  // The Android app asks the page before acting on the hardware Back key.
  ({content,ctx}=setup(base0));
  const handleBack=()=>context.window.harmonyHandleBack();
  assert.equal(typeof context.window.harmonyHandleBack,'function');
  context.confirmed.length=0;assert.equal(handleBack(),false,'nothing to lose: let the app go back');assert.equal(context.confirmed.length,0);
  down(content,slotBtn(content,'cells',0));advance(600);await settle();
  context.confirmAnswer=false;assert.equal(handleBack(),true,'unsaved changes, user stays: handled');assert.match(context.confirmed.at(-1),/Leave without saving/);
  assert.deepEqual(layout(content,'cells'),{1:'Down',2:'Mute'},'the edits are untouched');
  context.confirmAnswer=true;assert.equal(handleBack(),false,'user chooses to leave: let the app go back');
  await pressSave(ctx);context.confirmed.length=0;assert.equal(handleBack(),false,'saved: nothing to lose');assert.equal(context.confirmed.length,0);
  advance(800);tapSlot(content,'cells',0);assert.equal(sheet.open,true);
  assert.equal(handleBack(),true,'with the add sheet open Back only closes it');assert.equal(sheet.open,false);
  context.location.hash='#/activity/w';show();assert.equal(context.window.harmonyHandleBack,null,'the hook goes away with the screen');
  context.location.hash='#/edit/w';

  // The instructions live behind a ? button in the header instead of above the grid.
  {
    ({content,ctx}=setup(base0));
    assert.match(ctx.actions.innerHTML,/<button type="button" class="header-action" data-help aria-label="How editing works"[^>]*>[^]*<button type="button" class="cancel-button"/,'the help button sits in the header, before Cancel');
    assert.doesNotMatch(content.innerHTML,/Tap an empty square to add a button/);assert.doesNotMatch(content.innerHTML,/class="edit-hint"/);
    ctx.actions.onclick({target:{closest:sel=>sel==='[data-help]'?{}:null}});
    assert.equal(sheet.open,true);
    for(const line of [/Tap an empty square to add a button/,/Press and hold a button to remove it/,/Add arrow pad/,/bottom row stays on screen/,/Nothing changes until you tap Save/])assert.match(sheet.innerHTML,line);
    assert.equal(saveEnabled(ctx),false,'reading the help changes nothing');
    assert.equal(context.window.harmonyHandleBack(),true,'Back closes the help first');assert.equal(sheet.open,false);
    ctx.actions.onclick({target:{closest:sel=>sel==='[data-help]'?{}:null}});sheet.onclick({target:{closest:sel=>sel==='[data-sheet-cancel]'?{}:null}});assert.equal(sheet.open,false,'Done closes it');
    // No help while a save is running; the sheet would be left open across the redraw.
    {
      ({content,ctx}=setup(base0));const drawn=[];Object.defineProperty(ctx.actions,'innerHTML',{configurable:true,set(v){drawn.push(v);},get(){return drawn.at(-1)||'';}});
      down(content,slotBtn(content,'cells',0));advance(600);await settle();
      await pressSave(ctx);
      assert.ok(drawn.some(h=>/data-help[^>]*disabled/.test(h)&&/Saving…/.test(h)),'help is disabled while "Saving…" is shown');
      assert.doesNotMatch(drawn.at(-1),/data-help[^>]*disabled/,'and available again afterwards');
    }
    // The one hint that stays is the one that is needed mid-task.
    click(content,'[data-add-pad]');assert.match(content.innerHTML,/<p class="edit-hint">Tap where the arrow pad should go\.<\/p>/);
    click(content,'[data-place-cancel]');assert.doesNotMatch(content.innerHTML,/class="edit-hint"/);
  }
  // The Keyboard is a button like the others: offered for a device that can type, placed in a slot, and saved in the layout.
  {
    const kb={id:'kb',name:'Den Roku',type:'Roku',transport:'roku',keyboard:true,commands:[{name:'Home'}]};
    const cancelSheet=()=>sheet.onclick({target:{closest:sel=>sel==='[data-sheet-cancel]'?{}:null}});
    ({content,ctx}=setup(base0));
    assert.doesNotMatch(content.innerHTML,/keyboard-device|keyboard-setting/,'there is no separate Keyboard setting');
    tapSlot(content,'cells',3);assert.doesNotMatch(sheet.innerHTML,/Keyboard/,'no device can type, so none is offered');cancelSheet();
    ({content,ctx}=setup(base0,{extraDevices:[kb]}));
    tapSlot(content,'cells',3);assert.match(sheet.innerHTML,/Den Roku: Keyboard/,'a device that can type is offered like any command');
    assert.doesNotMatch(sheet.innerHTML,/\(keyboard\)/,'the stand-in command name is never shown');
    await choose('Den Roku: Keyboard');
    assert.equal(layout(content,'cells')[3],'Keyboard');assert.equal(saveEnabled(ctx),true);
    await pressSave(ctx);
    assert.deepEqual(hub.activities[0].screen.cells.find(c=>c.command==='(keyboard)'),{deviceId:'kb',command:'(keyboard)',slot:3},'saved as a cell of the layout');
    assert.equal('keyboard' in hub.activities[0],false,'and not on the activity');
    tapSlot(content,'cells',4+0);assert.doesNotMatch(sheet.innerHTML,/Den Roku: Keyboard/,'once placed it is not offered again');cancelSheet();
    // An activity from before it was a button names its keyboard device. The editor shows that as a button; saving moves it.
    ({content,ctx}=setup({...base0,keyboard:{deviceId:'kb'}},{extraDevices:[kb]}));
    assert.equal(layout(content,'cells')[3],'Keyboard','the old setting appears as a button in the first free slot');
    assert.equal(saveEnabled(ctx),false,'opening it is not a change');
    down(content,slotBtn(content,'cells',2));advance(600);await settle();
    assert.equal(saveEnabled(ctx),true);await pressSave(ctx);
    assert.equal('keyboard' in hub.activities[0],false,'the old setting is gone');assert.ok(hub.activities[0].screen.cells.some(c=>c.command==='(keyboard)'&&c.deviceId==='kb'),'and the button is in the layout');
    // A device that can no longer type shows as missing, like any deleted device.
    ({content,ctx}=setup({...base0,screen:{columns:4,cells:[...base0.screen.cells,{deviceId:'gone',command:'(keyboard)',slot:3}],pinned:[]}}));
    assert.match(content.innerHTML,/class="cell missing"[^>]*aria-label="Keyboard \(its device or command no longer exists\)/);
  }
  // Keyboard: an empty square opens the sheet from its normal click (Enter/Space), Delete removes the focused button.
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[sc('Up',0)],pinned:[]}}));
  const key=(b,k)=>{let prevented=false;content.onkeydown({key:k,target:{closest:()=>b},preventDefault(){prevented=true;}});return prevented;};
  assert.equal(key(slotBtn(content,'cells',3),'Enter'),false,'Enter on an empty square is left to the browser, which clicks it');
  assert.equal(key(slotBtn(content,'cells',0),'Enter'),false);assert.deepEqual(layout(content,'cells'),{0:'Up'},'Enter does not remove');
  const vibratedBefore=context.vibrated;
  assert.equal(key(slotBtn(content,'cells',0),'Delete'),true);assert.deepEqual(layout(content,'cells'),{});
  assert.equal(context.vibrated,vibratedBefore,'only a real long-press vibrates');
  assert.equal(key(slotBtn(content,'cells',2),'Delete'),false,'Delete on an empty square does nothing');

  // Add row asks where, and the new row goes there.
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[],pinned:[]}}));
  const before=empties(content,'cells').length;
  click(content,'[data-add-row]');
  assert.match(content.innerHTML,/Tap where the new row should go\./);assert.doesNotMatch(content.innerHTML,/data-add-row/,'the Add row button gives way to Cancel while choosing');
  assert.deepEqual([...content.innerHTML.matchAll(/data-place-row="(\d+)"/g)].map(m=>+m[1]),[0,1],'a bar above the first row and one below the last');
  click(content,'[data-place-cancel]');assert.doesNotMatch(content.innerHTML,/data-place-row/);assert.equal(empties(content,'cells').length,before);assert.equal(saveEnabled(ctx),false,'cancelling changes nothing');
  const placeAt=(row,side)=>content.onclick({target:{closest:sel=>sel==='[data-place-row]'?{dataset:{placeRow:String(row),...(side?{placeSide:side}:{})}}:null}});
  click(content,'[data-add-row]');placeAt(1);
  assert.equal(empties(content,'cells').length,before+4,'at the end it is another row of empty squares');
  // In the middle it opens a blank row between two rows, and Save keeps it.
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[sc('Up',0),sc('Down',4)],pinned:[]}}));
  click(content,'[data-add-row]');
  assert.deepEqual([...content.innerHTML.matchAll(/data-place-row="(\d+)"/g)].map(m=>+m[1]),[0,1,2]);
  placeAt(1);
  assert.deepEqual(layout(content,'cells'),{0:'Up',8:'Down'},'the second row moves down one row');assert.equal(saveEnabled(ctx),true);
  await pressSave(ctx);assert.deepEqual(hub.activities[0].screen.cells.map(c=>[c.command,c.slot]),[['Up',0],['Down',8]],'saved with the gap');
  // Row-editing mode: each row has up, down, add-above and remove-blank controls.
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[sc('Up',0),sc('Down',8)],pinned:[]}}));
  const rowTool=(kind,row)=>content.onclick({target:{closest:sel=>sel.startsWith('[data-row-up]')?{dataset:{['row'+kind]:String(row)}}:null}});
  assert.doesNotMatch(content.innerHTML,/data-row-up/,'the controls only show in the mode');assert.match(content.innerHTML,/data-edit-rows/);
  click(content,'[data-edit-rows]');
  assert.match(content.innerHTML,/Move a row with the arrows/);assert.doesNotMatch(content.innerHTML,/data-add-row/);assert.match(content.innerHTML,/data-rows-done/);
  assert.match(content.innerHTML,/data-row-up="0"[^>]*disabled/,'the first row cannot move up');
  assert.match(content.innerHTML,/data-row-remove="1"(?![^>]*disabled)/,'the blank row between the two can be removed');
  assert.match(content.innerHTML,/data-row-remove="0"[^>]*disabled/,'a row with a button cannot');
  rowTool('Remove',1);assert.deepEqual(layout(content,'cells'),{0:'Up',4:'Down'},'the blank row closed up');assert.equal(saveEnabled(ctx),true);
  rowTool('Up',1);assert.deepEqual(layout(content,'cells'),{0:'Down',4:'Up'},'the rows swapped');
  rowTool('Insert',1);assert.deepEqual(layout(content,'cells'),{0:'Down',8:'Up'},'a row added above row 2');
  rowTool('Down',0);assert.deepEqual(layout(content,'cells'),{4:'Down',8:'Up'},'moved down into the blank row');
  await pressSave(ctx);assert.deepEqual(hub.activities[0].screen.cells.map(c=>[c.command,c.slot]),[['Down',4],['Up',8]],'saved');
  click(content,'[data-rows-done]');assert.doesNotMatch(content.innerHTML,/data-row-up/);assert.match(content.innerHTML,/data-add-row/);
  // The arrow pad is a wall: no controls move a row across it.
  ({content,ctx}=setup({...base0,screen:{columns:4,crossRow:1,cells:[sc('Back',0),sc('Up',20),sc('Left',21),sc('OK',22),sc('Right',23),sc('Down',24),sc('Mute',5)],pinned:[]}}));
  click(content,'[data-edit-rows]');
  assert.match(content.innerHTML,/data-row-down="0"[^>]*disabled/,'the last row above the pad cannot go down');assert.match(content.innerHTML,/data-row-up="1"[^>]*disabled/,'the first row below it cannot go up');
  // With no room, it says so and changes nothing.
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[sc('Up',0),sc('Down',31)],pinned:[]}}));
  click(content,'[data-add-row]');placeAt(0);
  assert.match(el('notice').textContent,/no room for another row/);assert.equal(saveEnabled(ctx),false);assert.deepEqual(layout(content,'cells'),{0:'Up',31:'Down'});
  // Above or below the arrow pad are separate places.
  ({content,ctx}=setup({...base0,screen:{columns:4,crossRow:1,cells:[sc('Back',0),sc('Up',20),sc('Left',21),sc('OK',22),sc('Right',23),sc('Down',24),sc('Mute',5)],pinned:[]}}));
  click(content,'[data-add-row]');
  assert.deepEqual([...content.innerHTML.matchAll(/data-place-row="(\d+)"(?: data-place-side="(\w+)")?/g)].map(m=>m[1]+(m[2]?m[2][0]:'')),['0','1a','1b','2'],'two bars at the pad, above and below it');
  placeAt(1,'above');await pressSave(ctx);
  assert.equal(hub.activities[0].screen.crossRow,2);assert.equal(hub.activities[0].screen.cells.find(c=>c.command==='Mute').slot,9);

  // Not the owner, or an activity that is gone: no editor, no handlers, no guard.
  ({content}=setup(base0,{owner:false}));assert.match(content.innerHTML,/Only the hub owner/);assert.equal(content.onpointerdown,undefined);
  context.location.hash='#/edit/w';show();assert.equal(X.getLeaveGuard(),null,'a non-owner gets no editor and no leave prompt');
  const ghost={content:{innerHTML:'',isConnected:true},actions:{innerHTML:''},params:['ghost'],setTitle(){}};X.renderEditor(ghost);assert.match(ghost.content.innerHTML,/no longer exists/);
  context.setTimeout=()=>0;context.clearTimeout=()=>{};context.confirmed=[];context.confirmAnswer=true;delete context.Date;
}
console.log('Editing changes only a local draft in fixed slots; Save is one write; conflicts, rejection, cancel and leaving are handled');

// Leaving the editor must not leave its handlers on the shared content element.
{
  const content=el('content');content.onpointerdown=()=>{};content.onkeydown=()=>{};content.oncontextmenu=()=>{};
  state.config={activities:[]};state.session={role:'owner'};context.location.hash='#/devices';show();
  assert.equal(content.onpointerdown,null);assert.equal(content.onkeydown,null);assert.equal(content.oncontextmenu,null);assert.equal(el('header-actions').onclick,null);assert.equal(X.getLeaveGuard(),null);
}
// Setup links into the original pages, which still own device setup, activity steps and settings.
{
  const content={innerHTML:''};
  X.screens.setup.render({content,actions:{},params:[],setTitle(){}});
  assert.deepEqual([...content.innerHTML.matchAll(/<a class="row-main" href="([^"]+)"/g)].map(m=>m[1]),['#/update','/#devices','/#activities','/#settings']);
  assert.match(content.innerHTML,/IR codes/);
}
console.log('Setup links into the original pages');
// A controller (anyone paired who is not the owner) is shown only what they can use in Setup.
{
  const render=()=>{const content={innerHTML:''};X.screens.setup.render({content,actions:{},params:[],setTitle(){}});return content;};
  const links=html=>[...html.matchAll(/<a class="row-main" href="([^"]+)"/g)].map(m=>m[1]);
  const setupTab=()=>el('tabs').found['[data-tab=setup]'];
  const seen=[];context.api=async(path,body)=>{seen.push(path);if(path==='session')return {role:'control',buttonPending:true,csrf:'c'};return {};};
  state.config={hubName:'Den',activities:[]};

  state.session={role:'control',csrf:'c'};delete context.window.HarmonyNative;
  let content=render();
  assert.deepEqual(links(content.innerHTML),[],'no owner-only links');
  assert.doesNotMatch(content.innerHTML,/Software update|Activities|Settings|hub-name/);
  assert.match(content.innerHTML,/data-full-access/);assert.match(content.innerHTML,/Get full access/);
  assert.doesNotMatch(content.innerHTML,/data-hub-address/,'a browser has no hub address row');
  context.location.hash='#/setup';X.show();assert.equal(setupTab().hidden,false,'there is something to use, so the tab stays');

  // In the app the Hub address row stays for everyone, next to Get full access.
  context.window.HarmonyNative={changeHubAddress(){context.addressAsked=true;}};
  content=render();assert.match(content.innerHTML,/data-hub-address/);assert.match(content.innerHTML,/data-full-access/);
  await content.onclick({target:{closest:sel=>sel==='[data-hub-address]'?{}:null}});assert.equal(context.addressAsked,true);

  // Get full access asks the hub, then hands this browser to the original UI to wait for the Pair button.
  seen.length=0;context.replaced=undefined;
  await content.onclick({target:{closest:sel=>sel==='[data-full-access]'?{}:null}});
  assert.equal(seen[0],'controllers/upgrade');assert.equal(context.replaced,'/');
  context.api=async path=>{if(path==='controllers/upgrade')throw Error('Another browser is waiting for the Pair button.');return {};};
  await content.onclick({target:{closest:sel=>sel==='[data-full-access]'?{}:null}});
  assert.equal(el('notice').textContent,'Another browser is waiting for the Pair button.');assert.equal(el('notice').dataset.error,'true');

  // A hub without a Pair button, in a browser: nothing is left, so the tab goes and the screen says so.
  delete context.window.HarmonyNative;state.session={role:'control',csrf:'c',buttonAvailable:false};
  content=render();assert.match(content.innerHTML,/nothing to set up/);assert.doesNotMatch(content.innerHTML,/data-full-access/);
  X.show();assert.equal(setupTab().hidden,true);
  // ...but in the app the Hub address row is still something.
  context.window.HarmonyNative={changeHubAddress(){}};X.show();assert.equal(setupTab().hidden,false);delete context.window.HarmonyNative;

  // The owner sees everything, and a role that changes while the page is open grows the owner rows without a reload.
  state.session={role:'owner',csrf:'c'};content=render();
  assert.deepEqual(links(content.innerHTML),['#/update','/#devices','/#activities','/#settings']);
  assert.match(content.innerHTML,/hub-name/);assert.doesNotMatch(content.innerHTML,/data-full-access/,'the owner has full access already');
  X.show();assert.equal(setupTab().hidden,false);
  state.session={role:'control',csrf:'c',buttonAvailable:false};X.show();assert.equal(setupTab().hidden,true);
  state.session={role:'owner',csrf:'c'};X.show();assert.equal(setupTab().hidden,false,'approved while open: the tab and rows come back');
  // Owner-only screens still refuse someone who opens their address directly.
  state.session={role:'control',csrf:'c'};
  for(const route of ['#/update','#/roku']){context.location.hash=route;X.show();assert.match(el('content').innerHTML,/Only the hub owner/,route);}
  // An empty list tells a controller who can fill it, and the owner where to.
  const saved=state.devices;state.devices=[];state.config={activities:[]};
  for(const [role,devices,activities] of [['control',/owner has not set any up/,/owner has not set any up/],['owner',/Add one in the full settings pages/,/Create one in the full settings pages/]]){
    state.session={role};
    const d={innerHTML:''},a={innerHTML:'',isConnected:true};X.renderDevices({content:d,params:[]});X.renderActivities({content:a,params:[]});
    assert.match(d.innerHTML,devices,role);assert.match(a.innerHTML,activities,role);
  }
  state.devices=saved;
  context.location.hash='#/setup';state.session={role:'owner'};
  context.api=undefined;delete context.api;
}
console.log('A controller sees only Get full access (and Hub address in the app); the owner rows return when the role changes');
// The owner can name the hub; the name is saved on the hub and announced to the app.
{
  const announced=[];context.window.HarmonyNative={setHubName:n=>announced.push(n)};
  let hubCfg={revision:4,hubName:'Old <name>',activities:[]};const posts=[];
  context.api=async(path,body)=>{if(path!=='configuration')return {};if(!body)return J(hubCfg);posts.push(J(body));hubCfg={...J(body.configuration),revision:body.revision+1};return {ok:true};};
  state.config=J(hubCfg);state.session={role:'owner'};
  const input={value:''};const content={innerHTML:'',querySelector:sel=>sel==='#hub-name'?input:null};
  X.screens.setup.render({content,actions:{},params:[],setTitle(){}});
  assert.match(content.innerHTML,/id="hub-name" name="hub-name" value="Old &lt;name&gt;"/,'shows the current name, escaped');
  input.value='  Living Room ';let prevented=false;
  await content.onsubmit({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.deepEqual(announced,['Living Room']);
  assert.equal(posts[0].revision,4);assert.equal(posts[0].configuration.hubName,'Living Room','trimmed, one revision-checked write');
  assert.equal(el('notice').textContent,'Hub name saved.');
  input.value='';await content.onsubmit({preventDefault(){}});assert.deepEqual(announced,['Living Room','']);assert.equal(el('notice').textContent,'Hub name cleared.');
  // A rejected save says so and does not announce.
  context.api=async()=>{throw Error('Request failed (400)');};input.value='x';await content.onsubmit({preventDefault(){}});
  assert.equal(el('notice').textContent,'Request failed (400)');assert.equal(announced.length,2);
  // Non-owners get no form.
  state.session={role:'control'};const plain={innerHTML:''};X.screens.setup.render({content:plain,actions:{},params:[],setTitle(){}});
  assert.doesNotMatch(plain.innerHTML,/hub-name/);
  announced.length=0;state.config={hubName:'Den'};X.announceHub();assert.deepEqual(announced,['Den']);
  delete context.window.HarmonyNative;assert.doesNotThrow(()=>X.announceHub());
}
console.log('The owner can name the hub and the app is told');
// Roku screen: the owner adds, tests and removes Rokus; each change is one revision-checked write.
{
  let hubCfg={revision:7,networkDevices:[{id:'roku_a',name:'Den <TV>',kind:'roku',model:'tv',host:'192.168.1.50'}],activities:[]};
  const writes=[],sent=[];let netFail=false;
  context.api=async(path,body)=>{
    if(path==='configuration'){if(!body)return J(hubCfg);writes.push(J(body));hubCfg={...J(body.configuration),revision:body.revision+1};return {ok:true};}
    if(path==='network/devices')return {devices:(hubCfg.networkDevices||[]).map(d=>({id:d.id,name:d.name,type:'Roku',commands:[{name:'Home'}]}))};
    if(path==='devices'||path==='bluetooth/devices')return {devices:[]};
    if(path==='commands/send'){sent.push(J(body));if(netFail)throw Error('Could not reach the Roku.');return {id:'op1'};}
    if(path.startsWith('operations'))return {state:'completed',result:{ok:true,reply:'Den Roku'}};
    return {};
  };
  context.operation=async()=>({state:'completed',result:{ok:true,reply:'Den Roku'}});
  state.config=J(hubCfg);state.session={role:'owner'};context.location.hash='#/roku';
  const fields={'#roku-name':{value:''},'#roku-model':{value:'tv'},'#roku-host':{value:''}};
  const content={innerHTML:'',isConnected:true,querySelector:sel=>fields[sel]};
  X.screens.roku.render({content,actions:{},params:[],setTitle(){}});
  assert.match(content.innerHTML,/Den &lt;TV&gt;/,'lists Rokus, escaped');assert.match(content.innerHTML,/192\.168\.1\.50/);
  const submit=async(name,model,host)=>{fields['#roku-name'].value=name;fields['#roku-model'].value=model;fields['#roku-host'].value=host;await content.onsubmit({preventDefault(){}});};
  // Bad input never reaches the hub.
  for(const host of ['8.8.8.8','roku.local','192.168.1','192.168.1.300','172.32.0.1','010.1.2.3','192.168.01.50','']){await submit('Bed',"player",host);assert.equal(writes.length,0,host);assert.equal(el('notice').dataset.error,'true');}
  await submit('  ','tv','192.168.1.60');assert.equal(writes.length,0);assert.equal(el('notice').textContent,'Give the Roku a name.');
  // A good one is a single write that keeps the others, and then shows up as a device.
  await submit(' Bedroom ','player','10.1.2.3');
  assert.equal(writes.length,1);assert.equal(writes[0].revision,7);
  assert.deepEqual(writes[0].configuration.networkDevices.map(d=>[d.name,d.model,d.host,d.kind]),[['Den <TV>','tv','192.168.1.50','roku'],['Bedroom','player','10.1.2.3','roku']]);
  assert.match(writes[0].configuration.networkDevices[1].id,/^roku_[0-9a-f]{8}$/);
  assert.deepEqual(state.devices.map(d=>[d.name,d.transport]),[['Den <TV>','roku'],['Bedroom','roku']],'Rokus are loaded as devices');
  assert.match(content.innerHTML,/Bedroom/);
  // Test sends the connection query, not a key.
  await content.onclick({target:{closest:sel=>sel==='[data-roku-test]'?{dataset:{rokuTest:'roku_a'}}:null}});
  assert.deepEqual(sent[0],{deviceId:'roku_a',command:'DeviceInfo',transport:'roku',mode:'tap'});assert.equal(el('notice').textContent,'Connected to Den Roku.');
  netFail=true;await content.onclick({target:{closest:sel=>sel==='[data-roku-test]'?{dataset:{rokuTest:'roku_a'}}:null}});
  assert.equal(el('notice').textContent,'Could not reach the Roku.');assert.equal(el('notice').dataset.error,'true');
  // Remove asks first; saying no changes nothing.
  const removeClick=id=>content.onclick({target:{closest:sel=>sel==='[data-roku-remove]'?{dataset:{rokuRemove:id}}:null}});
  context.confirmAnswer=false;await removeClick('roku_a');assert.equal(writes.length,1);
  context.confirmAnswer=true;await removeClick('roku_a');
  assert.equal(writes.length,2);assert.deepEqual(writes[1].configuration.networkDevices.map(d=>d.name),['Bedroom']);assert.doesNotMatch(content.innerHTML,/Den &lt;TV&gt;/);
  // The hub's own error is shown and the list is not changed.
  const before=writes.length,failing=context.api;context.api=async(p,b)=>{if(p==='configuration'&&b)throw Error('Maximum of 8');return failing(p,b);};
  await submit('X','tv','192.168.1.9');assert.equal(el('notice').textContent,'Maximum of 8');assert.equal(writes.length,before);context.api=failing;
  // The change is saved even if refreshing afterwards fails: no error, no reason to add it twice.
  {
    const normal=context.api;let afterWrite=false;
    context.api=async(path,body)=>{
      if(path==='configuration'&&body){afterWrite=true;return normal(path,body);}
      if(afterWrite&&(path==='configuration'||path==='network/devices'))throw Error('network blip');
      return normal(path,body);
    };
    const count=writes.length;await submit('Kitchen','player','192.168.1.77');
    assert.equal(writes.length,count+1);assert.equal(el('notice').dataset.error,'false','a saved Roku is not reported as a failure');
    assert.match(content.innerHTML,/Kitchen/,'and it is listed');
    context.api=normal;
  }
  // Removing a Roku that activities still use says which ones; nothing is removed from them.
  {
    hubCfg={...hubCfg,activities:[{id:'a1',name:'Watch TV',steps:[{deviceId:'roku_b',command:'Home',transport:'roku'}],exitSteps:[]},{id:'a2',name:'Music',steps:[],exitSteps:[],screen:{columns:4,cells:[{deviceId:'roku_b',command:'Home',slot:0}],pinned:[]}},{id:'a3',name:'Other',steps:[{deviceId:'x',command:'y'}],exitSteps:[]}]};
    hubCfg.networkDevices=[{id:'roku_b',name:'Bedroom',kind:'roku',model:'player',host:'10.1.2.3'}];state.config=J(hubCfg);
    context.confirmed=[];context.confirmAnswer=false;await removeClick('roku_b');
    assert.match(context.confirmed.at(-1),/Remove Bedroom\? Watch TV, Music still use it and will stop working there/);assert.doesNotMatch(context.confirmed.at(-1),/Other/);
    context.confirmAnswer=true;
  }
  // If the Roku list cannot be fetched the other devices still load.
  {
    const normal=context.api;context.api=async(path,body)=>{if(path==='network/devices')throw Error('not found');if(path==='devices')return {devices:[{id:'1',name:'TV',commands:[]}]};if(path==='bluetooth/devices')return {devices:[]};return normal(path,body);};
    await context.exports.loadDevices();assert.deepEqual(state.devices.map(d=>d.id),['1']);context.api=normal;
  }
  // Favorite channels: pick which of the Roku's channels get a button, and save them with the Roku.
  {
    const names=[...fs.readFileSync(new URL('../payload/source/local_roku.h',import.meta.url),'utf8').matchAll(/\{"([^"]+)", "[A-Za-z0-9]+", [01]\}/g)].map(m=>m[1].toLowerCase());
    assert.ok(names.length>20,'found the hub\u2019s built-in command names');
    assert.deepEqual([...names,'deviceinfo','listapps'].sort(),[...X.ROKU_BUILTIN_NAMES].sort(),'the client and the hub agree on which names are taken');
    // What the sheet offers.
    const pick=(entries,installed)=>X.channelChoices(new Map(entries),installed);
    assert.deepEqual(J(pick([['1','Netflix']],null).map(c=>[c.id,c.checked,c.blocked])),[['1',true,'']],'before asking the Roku, just the favorites');
    const inst=[{id:'1',name:'Netflix'},{id:'2',name:'Hulu'},{id:'3',name:'Home'},{id:'4',name:'netflix'}];
    assert.deepEqual(J(pick([['1','Netflix']],inst).map(c=>[c.id,c.checked,c.blocked])),[['1',true,''],['2',false,''],['3',false,'Name is used by a button'],['4',false,'Same name as another channel']]);
    assert.deepEqual(J(pick([['9','Old']],inst).at(-1)),{id:'9',name:'Old',gone:true,checked:true,blocked:''},'a favorite the Roku no longer has is kept and marked');
    const twelve=Array.from({length:12},(_,i)=>[`c${i}`,`Channel ${i}`]);
    assert.deepEqual(pick(twelve,[...twelve.map(([id,name])=>({id,name})),{id:'x',name:'Extra'}]).at(-1).blocked,'Up to 12','at the limit nothing more can be ticked');
    assert.equal(pick(twelve,null).every(c=>c.checked&&!c.blocked),true,'but the ticked ones can always be unticked');
    // The sheet itself.
    const sheetEl=el('sheet'),status={textContent:''},list={innerHTML:''};
    Object.assign(sheetEl,{open:false,innerHTML:'',onclick:null,onchange:null,showModal(){this.open=true;},close(){const was=this.open;this.open=false;if(was)this.onclose?.();},
      querySelector:sel=>sel==='[data-channel-status]'?status:sel==='[data-channel-list]'?list:null});
    state.session={role:'owner'};hubCfg.networkDevices=[{id:'roku_c',name:'Den',kind:'roku',model:'tv',host:'10.1.1.1',channels:[{id:'1',name:'Netflix'},{id:'9',name:'Old'}]}];state.config=J(hubCfg);
    X.screens.roku.render({content,actions:{},params:[],setTitle(){}});
    assert.match(content.innerHTML,/data-roku-channels="roku_c" aria-label="Favorite channels for Den"/);
    const sentChannels=[];const baseApi=context.api;
    context.operation=async()=>({state:'completed',result:{ok:true,apps:[{id:'1',name:'Netflix'},{id:'2',name:'Hulu'},{id:'3',name:'Home'},{id:'4',name:'Plex'}]}});
    context.api=async(path,body)=>{if(path==='commands/send'){sentChannels.push(J(body));return {id:'op'};}return baseApi(path,body);};
    await content.onclick({target:{closest:sel=>sel==='[data-roku-channels]'?{dataset:{rokuChannels:'roku_c'}}:null}});
    assert.equal(sheetEl.open,true);assert.match(sheetEl.innerHTML,/Favorite channels/);assert.match(sheetEl.innerHTML,/for Den/);
    assert.match(list.innerHTML,/data-channel="1"[^>]*checked/);assert.match(list.innerHTML,/data-channel="9"[^>]*checked/);assert.doesNotMatch(list.innerHTML,/data-channel="2"/,'only favorites until the Roku is asked');
    const tap=sel=>sheetEl.onclick({target:{closest:s=>s===sel?{}:null}});
    await tap('[data-find-channels]');
    assert.deepEqual(sentChannels,[{deviceId:'roku_c',command:'ListApps',transport:'roku',mode:'tap'}]);assert.equal(status.textContent,'Found 4 channels.');
    assert.match(list.innerHTML,/data-channel="2"[^>]*>/);assert.match(list.innerHTML,/\(not installed\)/);
    assert.match(list.innerHTML,/data-channel="3"[^>]*disabled/);assert.match(list.innerHTML,/Name is used by a button/);
    const toggle=(id,name,checked)=>sheetEl.onchange({target:{closest:sel=>sel==='[data-channel]'?{checked,dataset:{channel:id,name}}:null}});
    toggle('2','Hulu',true);toggle('1','Netflix',false);toggle('9','Old',false);toggle('4','Plex',true);
    await tap('[data-save-channels]');
    const last=writes.at(-1);assert.deepEqual(last.configuration.networkDevices[0].channels,[{id:'2',name:'Hulu'},{id:'4',name:'Plex'}],'saved in the order picked, as part of the Roku');
    assert.equal(last.configuration.networkDevices[0].host,'10.1.1.1','the rest of the Roku is untouched');
    assert.equal(sheetEl.open,false);assert.equal(el('notice').textContent,'Favorite channels saved.');
    // A save the hub refuses keeps the sheet open and says why.
    await content.onclick({target:{closest:sel=>sel==='[data-roku-channels]'?{dataset:{rokuChannels:'roku_c'}}:null}});
    const before=writes.length;context.api=async(path,body)=>{if(path==='configuration'&&body)throw Error('Request failed (400)');return baseApi(path,body);};
    toggle('3','Home',true);await tap('[data-save-channels]');
    assert.equal(sheetEl.open,true);assert.equal(status.textContent,'Request failed (400)');assert.equal(writes.length,before);
    // A failed search says why in the sheet too, and everything can be unticked and saved.
    context.api=async(path,body)=>{if(path==='commands/send')throw Error('Could not reach the Roku.');return baseApi(path,body);};
    await tap('[data-find-channels]');assert.equal(status.textContent,'Could not reach the Roku.');
    context.api=baseApi;toggle('3','Home',false);toggle('2','Hulu',false);toggle('4','Plex',false);await tap('[data-save-channels]');
    assert.deepEqual(writes.at(-1).configuration.networkDevices[0].channels,[],'no favorites is allowed');
    // Robustness: an answer with no list is an error, odd entries are ignored, a closed sheet is left alone,
    // ticks during a save do not change what is saved, and names are escaped.
    {
      netFail=false;
      const answerWith=result=>{context.operation=async()=>({state:'completed',result});};
      const reopen=async()=>{await content.onclick({target:{closest:sel=>sel==='[data-roku-channels]'?{dataset:{rokuChannels:'roku_c'}}:null}});};
      hubCfg.networkDevices=[{id:'roku_c',name:'Den',kind:'roku',model:'tv',host:'10.1.1.1',channels:[{id:'1',name:'Netflix'}]}];state.config=J(hubCfg);
      X.screens.roku.render({content,actions:{},params:[],setTitle(){}});
      answerWith({ok:true});await reopen();await tap('[data-find-channels]');
      assert.equal(status.textContent,'The Roku did not list its channels.');assert.doesNotMatch(list.innerHTML,/not installed/,'no list is not the same as no channels: favorites are not called uninstalled');
      answerWith({ok:true,apps:[{id:'5'},{name:'Nameless'},null,{id:7,name:'Number id'},{id:'6',name:'Fine'}],skipped:2});await tap('[data-find-channels]');
      assert.equal(status.textContent,"Found 5 channels. 2 more can't be used as buttons.");assert.match(list.innerHTML,/data-channel="6"/);assert.doesNotMatch(list.innerHTML,/Nameless|Number id/,'entries without a usable id and name are left out');
      sheetEl.close();
      let release;context.operation=()=>new Promise(resolve=>{release=()=>resolve({state:'completed',result:{ok:true,apps:[]}});});
      await reopen();const finding=tap('[data-find-channels]');for(let n=0;n<20;n++)await Promise.resolve();
      assert.equal(status.textContent,'Asking the Roku…');sheetEl.close();release();await finding;
      assert.equal(status.textContent,'Asking the Roku…','a late answer does not touch a sheet that was closed');
      // Ticks while a save is running are ignored: what is saved is what was ticked when it started.
      await reopen();let finishWrite;const heldApi=context.api;
      context.api=async(path,body)=>{if(path==='configuration'&&body){await new Promise(resolve=>{finishWrite=resolve;});}return heldApi(path,body);};
      const writesBefore=writes.length,saving=tap('[data-save-channels]');for(let n=0;n<20;n++)await Promise.resolve();
      sheetEl.onchange({target:{closest:sel=>sel==='[data-channel]'?{checked:true,dataset:{channel:'8',name:'Late tick'}}:null}});
      assert.doesNotMatch(list.innerHTML,/Late tick/,'the sheet does not show a tick that will not be saved');
      finishWrite();await saving;context.api=heldApi;
      assert.deepEqual(writes.at(-1).configuration.networkDevices[0].channels,[{id:'1',name:'Netflix'}],'a tick made during the save is not part of it');
    }
    {
      // Names with markup are shown as text.
      const row=X.channelChoices(new Map(),[{id:'9',name:'<img src=x onerror=alert(1)>'}]);
      assert.doesNotMatch(X.channelRowHtml(row[0]),/<img/,'channel names are escaped');assert.match(X.channelRowHtml(row[0]),/&lt;img/);
    }
    context.operation=async()=>({state:'completed',result:{ok:true,reply:'Den Roku'}});
  }
  // Only the owner can change Rokus.
  state.session={role:'control'};const plain={innerHTML:''};X.screens.roku.render({content:plain,actions:{},params:[],setTitle(){}});
  assert.match(plain.innerHTML,/Only the hub owner/);assert.doesNotMatch(plain.innerHTML,/roku-name/);
  assert.equal(X.screens.roku.parent,'devices');assert.equal(X.screens.roku.backTo,'/#devices','Back goes to the device list it was opened from');
}
console.log('The owner can add, test and remove a Roku; Rokus appear as devices');
// Which commands the lock-screen buttons send: the same choice the hardware volume keys make.
{
  const log=[];context.window.HarmonyNative={setRunningActivity:v=>log.push(v)};
  const tvd={id:'tv',name:'TV',transport:'ir',commands:['VolumeUp','VolumeDown','Play','Mute'].map(name=>({name}))};
  const rk={id:'rk',name:'Roku',transport:'roku',commands:[{name:'Play'}]};
  const bt={id:'bt',name:'Fire',transport:'bluetooth',commands:['Play','VolumeUp'].map(name=>({name}))};
  const bar2={id:'bar2',name:'Sound bar',transport:'ir',commands:['Play_Pause','VolumeUp','VolumeDown','Mute'].map(name=>({name}))};
  state.devices=[tvd,rk,bt,bar2];
  state.config={activities:[{id:'e',name:'Streaming',steps:[{deviceId:'bt'}]},{id:'a',name:'Watch',steps:[{deviceId:'tv'}]},{id:'b',name:'Roku only',steps:[{deviceId:'rk'}]},{id:'c',name:'Nothing',steps:[{deviceId:'gone'}]},
    {id:'d',name:'Custom',steps:[{deviceId:'tv'}],screen:{columns:4,cells:[{deviceId:'rk',command:'Play',slot:0}],pinned:[]}},
    // A sound bar comes first in the start steps and has Play_Pause, but the remote's Play (in the fixed row) is the Roku's.
    {id:'f',name:'Watch Roku',steps:[{deviceId:'bar2'},{deviceId:'rk'}],screen:{columns:4,cells:[],pinned:[{deviceId:'rk',command:'Rewind',slot:0},{deviceId:'rk',command:'Play',slot:1}]}},
    {id:'g',name:'Both',steps:[{deviceId:'bar2'}],screen:{columns:4,cells:[{deviceId:'tv',command:'Play',slot:0}],pinned:[{deviceId:'rk',command:'Play',slot:0}]}}]};
  const announce=id=>{log.length=0;store.set('harmony-activity','');context.exports.setRunningActivity(id);return log.at(-1);};
  const labels=json=>JSON.parse(json).buttons.map(b=>`${b.label}:${b.deviceId}.${b.command}.${b.transport}`);
  assert.deepEqual(labels(announce('a')),['Play:tv.Play.ir','Mute:tv.Mute.ir','Volume down:tv.VolumeDown.ir','Volume up:tv.VolumeUp.ir']);
  assert.deepEqual(labels(announce('b')),['Play:rk.Play.roku'],'only the buttons the activity can actually press');
  assert.equal(announce('c'),'','nothing to press: nothing announced');
  assert.deepEqual(labels(announce('d')),['Play:rk.Play.roku','Mute:tv.Mute.ir','Volume down:tv.VolumeDown.ir','Volume up:tv.VolumeUp.ir'],'a button on the activity\u2019s own screen wins over the devices');
  assert.deepEqual(labels(announce('f')),['Play:rk.Play.roku','Mute:bar2.Mute.ir','Volume down:bar2.VolumeDown.ir','Volume up:bar2.VolumeUp.ir'],'the Play on the remote\u2019s fixed row, not the first device\u2019s Play_Pause');
  assert.deepEqual(labels(announce('g')).slice(0,1),['Play:tv.Play.ir'],'the grid is looked at before the fixed row');
  assert.deepEqual(labels(announce('e')),['Play:bt.Play.bluetooth','Volume up:bt.VolumeUp.bluetooth'],'a Bluetooth device is announced with its own transport');
  // Whenever the devices are reloaded the app hears about it: a removed Roku can't stay on the lock screen.
  store.set('harmony-activity','b');log.length=0;state.devices=[tvd,bt];context.api=async path=>path==='devices'?{devices:[tvd]}:path==='bluetooth/devices'?{devices:[bt]}:{devices:[]};
  await context.exports.loadDevices();assert.equal(log.at(-1),'','the Roku is gone, so is the button (nothing else for this activity to press)');
  assert.equal(announce(''),'','stopped');assert.equal(announce('missing'),'','an unknown activity announces nothing');
  delete context.window.HarmonyNative;assert.doesNotThrow(()=>context.exports.setRunningActivity('a'),'no app, no problem');
}
console.log('The running activity and its lock-screen buttons are announced to the app');
// Software update: read a release file, upload it in chunks, wait through the restart, report what happened.
{
  let clock=0;X.pauses.wait=async ms=>{clock+=ms;};X.pauses.now=()=>clock;   // time only passes when the code waits
  const big=Buffer.alloc(25600,7), small=Buffer.from('hello');
  const manifest=JSON.stringify({version:'0.2.0',files:[{name:'big.bin',size:big.length},{name:'small',size:small.length}]});
  const releaseOf=(over={})=>({manifest,signature:'ab',files:{'big.bin':big.toString('base64'),small:small.toString('base64')},...over});
  const text=over=>JSON.stringify(releaseOf(over));
  // Reading the file.
  assert.equal(X.parseRelease(text()).manifest.version,'0.2.0');
  for(const [input,words] of [['not json',/not JSON/],['[]',/not a hub release bundle/],[text({signature:undefined}),/not a hub release bundle/],
      [text({manifest:'{'}),/manifest is damaged/],[text({files:{small:'aGk='}}),/missing files it lists: big.bin/],
      [text({manifest:JSON.stringify({files:[]})}),/no version or file list/],
      [text({files:null}),/not a hub release bundle/],[text({files:'x'}),/not a hub release bundle/],[text({files:[]}),/not a hub release bundle/],
      [text({manifest:'null'}),/no version or file list/],[text({manifest:JSON.stringify({version:'1',files:'x'})}),/no version or file list/],
      [text({manifest:JSON.stringify({version:'1',files:[null]})}),/no version or file list/],[text({manifest:JSON.stringify({version:'1',files:[{size:1}]})}),/no version or file list/]])
    assert.throws(()=>X.parseRelease(input),words,String(input).slice(0,40));
  // The upload: begin, every chunk in order, apply, then the wait.
  const calls=[],said=[];let sessionUp=['up','down','down','up'],statuses=[{pending:true},{pending:false,version:'0.2.0',result:'Release passed startup health checks'}];
  context.api=async(path,body)=>{
    calls.push({path,...body});
    if(path==='session'){const step=sessionUp.length>1?sessionUp.shift():sessionUp[0];if(step==='down')throw new TypeError('offline');return {};}
    if(path==='updates/status')return statuses.length>1?statuses.shift():statuses[0];
    return {ok:true};
  };
  const done=await X.installRelease(X.parseRelease(text()),t=>said.push(t));
  assert.deepEqual(J(done),{outcome:'ok',version:'0.2.0',result:'Release passed startup health checks'});
  const chunks=calls.filter(c=>c.path==='updates/chunk');
  assert.deepEqual(calls.filter(c=>!['session','updates/status'].includes(c.path)).map(c=>c.path),['updates/begin','updates/chunk','updates/chunk','updates/chunk','updates/chunk','updates/chunk','updates/apply']);
  assert.equal(calls[0].manifest,manifest);assert.equal(calls[0].signature,'ab');
  assert.deepEqual(chunks.map(c=>[c.name,c.offset]),[['big.bin',0],['big.bin',8192],['big.bin',16384],['big.bin',24576],['small',0]]);
  assert.ok(chunks.every(c=>c.hex.length<=32768&&c.hex.length%2===0));
  assert.equal(Buffer.from(chunks.filter(c=>c.name==='big.bin').map(c=>c.hex).join(''),'hex').equals(big),true,'the hub receives exactly the signed bytes');
  assert.ok(said.some(t=>/Uploading big.bin… 100%/.test(t))&&said.some(t=>/restarting/.test(t))&&said.some(t=>/startup check/.test(t)));
  // A damaged file is found before the hub is told anything.
  for(const files of [{'big.bin':'***not base64***',small:small.toString('base64')},{'big.bin':Buffer.alloc(10).toString('base64'),small:small.toString('base64')}]) {
    const sent=[];context.api=async path=>{sent.push(path);return {};};
    await assert.rejects(()=>X.installRelease(X.parseRelease(text({files})),()=>{}),/big\.bin in that release is (damaged|not the size)/);
    assert.deepEqual(sent,[],'nothing is sent for a damaged bundle');
  }
  // The other endings.
  const ending=async(session,status,version='0.2.0')=>{sessionUp=session;statuses=status;context.api=async path=>{if(path==='session'){const s=sessionUp.length>1?sessionUp.shift():sessionUp[0];if(s==='down')throw new TypeError('offline');return {};}if(path==='updates/status'){const s=statuses.length>1?statuses.shift():statuses[0];if(s instanceof Error)throw s;return s;}return {};};return J(await X.waitForHub(version,()=>{}));};
  assert.equal((await ending(['up','down','up'],[{pending:false,version:'0.1.0',result:'Rolled back after a failed health check'}])).outcome,'rolled-back');
  assert.equal((await ending(['up','down','up'],[{pending:false,version:'0.1.5',result:''}])).outcome,'unclear');
  assert.equal((await ending(['up','down','up'],[new TypeError('x'),{pending:true},{pending:false,version:'0.2.0',result:'ok'}])).outcome,'ok','a status that fails while the hub starts is retried');
  clock=0;await assert.rejects(()=>ending(['down'],[{pending:false,version:'0.2.0'}]),/has not come back after five minutes/);assert.ok(clock>=300000&&clock<=310000,'waits five minutes of real time, however long each request takes');
  clock=0;await assert.rejects(()=>ending(['up','down','up'],[{pending:true}]),/startup check has not finished/);assert.ok(clock>=180000&&clock<=190000+60000);
  // The screen.
  const nodes={'[data-update-version]':{textContent:''},'[data-update-status]':{textContent:''},'[data-install-update]':{disabled:true},'[data-reload]':{hidden:true}};
  const content={innerHTML:'',isConnected:true,querySelector:sel=>nodes[sel]||null};
  const render=owner=>{state.session={role:owner?'owner':'control'};state.online=true;context.location.hash='#/update';for(const n of Object.values(nodes)){n.textContent='';}nodes['[data-install-update]'].disabled=true;nodes['[data-reload]'].hidden=true;content.innerHTML='';content.onchange=content.onclick=null;
    X.screens.update.render({content,actions:{},params:[],setTitle(){}});};
  const calls2=[];let startStatus={ok:true,version:'0.1.0',pending:false,result:''};
  context.api=async(path,body)=>{calls2.push(path);if(path==='updates/status')return startStatus;if(path==='session')return {};return {ok:true};};
  const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
  render(true);await settle();
  assert.match(content.innerHTML,/type="file" accept="\.json,application\/json"/);assert.equal(nodes['[data-update-version]'].textContent,'Installed: version 0.1.0.');
  const pickFile=async(body,size=body.length)=>content.onchange({target:{closest:sel=>sel==='#update-file'?{}:null,files:[{size,text:async()=>body}]}});
  await pickFile('junk');assert.match(nodes['[data-update-status]'].textContent,/not JSON/);assert.equal(nodes['[data-install-update]'].disabled,true);
  await pickFile(text(),7_000_000);assert.match(nodes['[data-update-status]'].textContent,/too large/);
  await pickFile(text());assert.equal(nodes['[data-update-status]'].textContent,'Ready to install version 0.2.0.');assert.equal(nodes['[data-install-update]'].disabled,false);
  const click=sel=>content.onclick({target:{closest:s=>s===sel?{}:null}});
  // Saying no sends nothing.
  context.confirmed=[];context.confirmAnswer=false;calls2.length=0;await click('[data-install-update]');
  assert.match(context.confirmed.at(-1),/Install version 0\.2\.0\?/);assert.deepEqual(calls2,[],'nothing is sent unless confirmed');
  // Yes: uploaded, the hub restarts and comes back running it.
  context.confirmAnswer=true;calls2.length=0;let phase='before';
  context.api=async(path,body)=>{calls2.push(path);if(path==='updates/apply')phase='restarting';if(path==='session'){if(phase==='restarting'){phase='back';throw new TypeError('offline');}return {};}if(path==='updates/status')return phase==='back'?{pending:false,version:'0.2.0',result:'Release passed startup health checks'}:startStatus;return {ok:true};};
  await click('[data-install-update]');
  assert.equal(nodes['[data-update-status]'].textContent,'Updated: the hub is running version 0.2.0.');assert.equal(nodes['[data-reload]'].hidden,false,'offers to reload into the new version');
  assert.equal(nodes['[data-install-update]'].disabled,true,'the same file is not installed twice');
  assert.equal(calls2.includes('updates/begin')&&calls2.includes('updates/apply'),true);
  let reloaded=false;context.location.reload=()=>{reloaded=true;};await click('[data-reload]');assert.equal(reloaded,true);
  // A rollback is reported as a failure, in words.
  render(true);await settle();await pickFile(text());phase='before';
  context.api=async path=>{if(path==='updates/apply')phase='restarting';if(path==='session'){if(phase==='restarting'){phase='back';throw new TypeError('offline');}return {};}if(path==='updates/status')return phase==='back'?{pending:false,version:'0.1.0',result:'Rolled back after a failed health check'}:startStatus;return {ok:true};};
  el('notice').textContent='';await click('[data-install-update]');
  assert.match(nodes['[data-update-status]'].textContent,/went back to version 0\.1\.0: Rolled back after a failed health check/);assert.equal(el('notice').dataset.error,'true');assert.equal(nodes['[data-reload]'].hidden,true);
  // The hub refusing the file (wrong key, say) shows its message and leaves the button usable.
  render(true);await settle();await pickFile(text());
  context.api=async path=>{if(path==='updates/begin')throw Error('Release signature, platform or manifest is invalid.');return startStatus;};
  await click('[data-install-update]');
  assert.equal(nodes['[data-update-status]'].textContent,'Release signature, platform or manifest is invalid.');assert.equal(nodes['[data-install-update]'].disabled,false,'can try another file');
  // A pending earlier update, an unreadable version, offline, and non-owners.
  context.api=async path=>{if(path==='updates/status')return {ok:true,version:'',pending:true,result:''};return {};};render(true);await settle();
  assert.equal(nodes['[data-update-version]'].textContent,'Installed: version not recorded (still being checked).');
  context.api=async()=>{throw Error('offline');};render(true);await settle();assert.equal(nodes['[data-update-version]'].textContent,'The installed version could not be read.');
  render(false);assert.match(content.innerHTML,/Only the hub owner/);
  context.operation=async()=>({state:'completed',result:{ok:true,reply:'Den Roku'}});
}
console.log('Software update: file checks, chunked upload, the wait through the restart, and each ending are reported');
// Typing: what is sent for each change, in order, in chunks.
{
  assert.equal(X.typingPlan('','abc'),'abc');assert.equal(X.typingPlan('abc','abcd'),'d');assert.equal(X.typingPlan('abc','ab'),'\b');
  assert.equal(X.typingPlan('teh','the'),'\b\bhe','a correction backs up to where the text differs');
  assert.equal(X.typingPlan('abc',''),'\b\b\b');assert.equal(X.typingPlan('abc','abc'),'');
  assert.equal(X.typingPlan('a€','a€!'),'!');assert.equal(X.typingPlan('a😀','a'),'\b','an emoji is one character, not two');
  const sentTexts=[],gates=[];let failNext=false;
  context.api=async(path,body)=>{
    if(path!=='commands/type')return {};
    sentTexts.push(body.text);
    await new Promise(resolve=>gates.push(resolve));
    if(failNext){failNext=false;throw Error('Typed 0 of 1 characters. Could not reach the Roku.');}
    return {id:'t'+sentTexts.length};
  };
  context.operation=async()=>({state:'completed'});
  const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  const open=async()=>{while(gates.length){gates.shift()();await settle();}};
  let typer=X.createTyper('kb');
  typer.change('h');await settle();assert.deepEqual(sentTexts,['h'],'the first letter goes out at once');
  typer.change('he');typer.change('hel');typer.change('hell');await settle();assert.deepEqual(sentTexts,['h'],'the rest wait for the request in flight');
  await open();assert.deepEqual(sentTexts,['h','ell'],'and then go together, in order');await open();
  typer.change('hel');typer.change('help');await open();await open();assert.deepEqual(sentTexts,['h','ell','\b','p'],'a correction is a Backspace, then the new letter');
  // Enter is a key, and starts a fresh line of text.
  sentTexts.length=0;typer=X.createTyper('kb');typer.change('go');await open();await open();typer.enter();await open();typer.change('x');await open();
  assert.deepEqual(sentTexts,['go','\n','x']);
  // A long paste is split into chunks of at most 64 characters.
  sentTexts.length=0;typer=X.createTyper('kb');typer.change('a'.repeat(150));await open();await open();await open();await open();
  assert.deepEqual(sentTexts.map(t=>t.length),[64,64,22]);
  // A failure is shown, drops what was waiting, and typing carries on afterwards.
  sentTexts.length=0;el('notice').textContent='';let resets=0;typer=X.createTyper('kb',()=>{resets++;});failNext=true;
  typer.change('a');typer.change('ab');typer.change('abc');await settle();await open();await open();
  assert.equal(el('notice').textContent,'Typed 0 of 1 characters. Could not reach the Roku. The box was cleared; check what reached the device.');assert.equal(el('notice').dataset.error,'true');assert.deepEqual(sentTexts,['a'],'the queued letters were dropped, not retried');
  assert.equal(resets,1,'the field is cleared so the screen matches what the typer now assumes');
  typer.change('d');await open();assert.deepEqual(sentTexts,['a','d'],'typing starts again from an empty baseline');
  typer.change('');await open();assert.deepEqual(sentTexts,['a','d','\b'],'and backspaces only what was typed since');
  // The Keyboard button: only where there is a device that can type.
  const kb={id:'kb',name:'Den <Roku>',type:'Roku',transport:'roku',keyboard:true,commands:[{name:'Home'}]};
  state.devices=[{id:'tv',name:'TV',commands:[{name:'Up'}]},kb];state.session={role:'control'};
  state.config={activities:[{id:'w',name:'Watch',steps:[],screen:{columns:4,cells:[],pinned:[]},keyboard:{deviceId:'kb'}},{id:'n',name:'No kb',steps:[],screen:{columns:4,cells:[],pinned:[]}},{id:'g',name:'Gone',steps:[],screen:{columns:4,cells:[],pinned:[]},keyboard:{deviceId:'gone'}},{id:'t',name:'TV kb',steps:[],screen:{columns:4,cells:[],pinned:[]},keyboard:{deviceId:'tv'}}]};
  const remoteCtx=(render,id)=>{const ctx={content:{innerHTML:'',querySelectorAll(sel){return sel!=='[data-keyboard]'?[]:[...this.innerHTML.matchAll(/data-keyboard data-device="([^"]*)"/g)].map(m=>({dataset:{device:m[1]},addEventListener:(type,fn)=>{(this.listeners||={})[type]=fn;}}));}},actions:{innerHTML:'',onclick:null},params:[id],setTitle(){}};X[render](ctx);return ctx;};
  const withKb=remoteCtx('renderActivityRemote','w');
  assert.match(withKb.content.innerHTML,/<div class="pinned"><button type="button" class="keyboard-button" data-keyboard data-device="kb" aria-label="Type on Den &lt;Roku&gt;">/,'anyone, not only the owner, gets the button, in the fixed bar');
  assert.equal(withKb.actions.innerHTML,'','and it is not in the header');
  for(const id of ['n','g','t'])assert.doesNotMatch(remoteCtx('renderActivityRemote',id).content.innerHTML,/data-keyboard/,id+': no button without a device that can type');
  state.session={role:'owner'};assert.equal(remoteCtx('renderActivityRemote','w').actions.innerHTML,'','the owner has no edit pencil in the header');state.session={role:'control'};
  assert.match(remoteCtx('renderDeviceRemote','kb').content.innerHTML,/<div class="pinned"><button[^>]*data-keyboard/,'a Roku opened on its own has it too');assert.doesNotMatch(remoteCtx('renderDeviceRemote','tv').content.innerHTML,/data-keyboard/);
  // With a fixed row, the button sits directly above it.
  state.config.activities.push({id:'p',name:'Pinned',steps:[],screen:{columns:4,cells:[],pinned:[{deviceId:'tv',command:'Up',slot:0}]},keyboard:{deviceId:'kb'}});
  const withPinned=remoteCtx('renderActivityRemote','p').content.innerHTML;
  assert.ok(withPinned.indexOf('data-keyboard')>withPinned.indexOf('class="pinned"')&&withPinned.indexOf('data-keyboard')<withPinned.indexOf('aria-label="Up"'),'above the fixed row\u2019s buttons, inside the same bar');
  // A Keyboard button placed in the layout is an ordinary cell: in the grid or the fixed row, with no second one above the bar.
  state.config.activities.push({id:'c',name:'Cell',steps:[],screen:{columns:4,cells:[{deviceId:'kb',command:'(keyboard)',slot:1},{deviceId:'tv',command:'Up',slot:0}],pinned:[]},keyboard:{deviceId:'kb'}});
  const withCell=remoteCtx('renderActivityRemote','c');
  assert.equal((withCell.content.innerHTML.match(/data-keyboard/g)||[]).length,1,'one Keyboard button, not the old one as well');
  assert.match(withCell.content.innerHTML,/<div class="remote">.*data-keyboard data-device="kb" aria-label="Type on Den &lt;Roku&gt;" title=.*<\/div>/s,'inside the grid');
  assert.doesNotMatch(withCell.content.innerHTML,/keyboard-button/);
  assert.equal(typeof withCell.content.listeners.click,'function','and it opens the keyboard');
  state.config.activities.push({id:'f',name:'FixedKb',steps:[],screen:{columns:4,cells:[],pinned:[{deviceId:'kb',command:'(keyboard)',slot:0}]}});
  assert.match(remoteCtx('renderActivityRemote','f').content.innerHTML,/<div class="pinned"><div class="cells pinned-row"><button class="cell " type="button" data-keyboard data-device="kb"/,'or in the fixed row');
  state.config.activities.push({id:'x',name:'StaleKb',steps:[],screen:{columns:4,cells:[{deviceId:'tv',command:'(keyboard)',slot:0}],pinned:[]}});
  assert.doesNotMatch(remoteCtx('renderActivityRemote','x').content.innerHTML,/data-keyboard/,'a device that cannot type gets no Keyboard button');
  // Tapping it opens the sheet with the input focused; typing goes to the hub.
  const input={value:'',focused:false,focus(){this.focused=true;}};
  const sheet=Object.assign(el('sheet'),{open:false,innerHTML:'',onclick:null,onclose:null,showModal(){this.open=true;},close(){const was=this.open;this.open=false;if(was)this.onclose?.();},querySelector:sel=>sel==='#keyboard-input'?input:null});
  sentTexts.length=0;const kbCtx=remoteCtx('renderActivityRemote','w');
  kbCtx.content.listeners.click();
  assert.equal(sheet.open,true);assert.equal(input.focused,true);assert.match(sheet.innerHTML,/Type on Den &lt;Roku&gt;/);assert.match(sheet.innerHTML,/autocorrect="off"/);
  input.value='hi';input.oninput();await settle();await open();assert.deepEqual(sentTexts,['hi']);
  let prevented=false;input.onkeydown({key:'Enter',preventDefault(){prevented=true;}});await settle();await open();
  assert.equal(prevented,true);assert.equal(input.value,'','Enter clears the field');assert.deepEqual(sentTexts,['hi','\n']);
  input.onkeydown({key:'a',preventDefault(){throw Error('other keys are left alone');}});
  input.value='z';input.oninput();await settle();await open();sentTexts.length=0;let broke=false;
  input.onbeforeinput({inputType:'insertLineBreak',preventDefault(){broke=true;}});await settle();await open();
  assert.equal(broke,true);assert.deepEqual(sentTexts,['\n'],'a soft keyboard that reports Enter only as a line break still presses Enter');assert.equal(input.value,'');
  input.onbeforeinput({inputType:'insertText',preventDefault(){throw Error('ordinary typing is left alone');}});
  assert.equal(context.window.harmonyHandleBack(),true,'hardware Back closes the sheet first');assert.equal(sheet.open,false);assert.equal(context.window.harmonyHandleBack(),false);
  context.operation=async()=>({state:'completed'});
}
console.log('Typing is sent in order and in chunks; the Keyboard button appears only where a device can type');
console.log('Switching screens clears the previous screen’s handlers');
