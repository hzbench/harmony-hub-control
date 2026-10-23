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
const el=id=>elements[id]||=({id,dataset:{},classList:{add(){},remove(){}},hidden:false,textContent:'',innerHTML:'',title:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},focus(){},addEventListener(){},querySelectorAll:()=>[]});
const context=vm.createContext({document:{getElementById:el,title:'',body:{dataset:{}},addEventListener(){},hidden:false},window:{addEventListener(){},scrollTo(){}},location:{hash:'',replace(url){context.replaced=url;}},history:{replaceState(){}},
  navigator:{vibrate(){context.vibrated=(context.vibrated||0)+1;}},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},setTimeout:()=>0,clearTimeout(){},fetch:async()=>{throw new TypeError('offline');},AbortController,URL});
const inert=source.replace(/\n  boot\(\);\n\}\s*$/,'\n}');assert.notEqual(inert,source,'boot() auto-run not found');
vm.runInContext(inert.replace('const state =','var state =')+'\nthis.exports={parseRoute,routeHash,connection,state,needsFullUi,api,show,screens,renderActivities,renderDevices,deviceRemoteHtml,renderDeviceRemote,remoteBlocks,remoteHtml,renderActivityRemote,CONTROLS,controlFor,volumeTarget,editorSlots,availableCommands,addButton,removeButton,persistConfig,editorHtml,renderEditor,screenOf,MAX_CELLS};',context);
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

// Drill-in screens get a back arrow and no tabs/connection icon; tab screens the reverse.
state.config={activities:[]};state.session={role:'owner'};
context.location.hash='#/activity/watch';show();
assert.equal(el('back').hidden,false);assert.equal(el('back').dataset.parent,'activities');
assert.equal(el('tabs').hidden,true);assert.equal(el('connection').hidden,true);
context.location.hash='#/devices';show();
assert.equal(el('back').hidden,true);assert.equal(el('tabs').hidden,false);assert.equal(el('connection').hidden,false);
assert.equal(el('title').textContent,'Devices');
console.log('Tab screens show tabs and the connectivity icon; drill-in screens show a back arrow instead');

// ---- Activities home ----
const calls=[];let outcome='completed',pending=null;
context.api=async(path,body)=>{calls.push({path,...body});if(path==='activities/run')return {id:'op'+calls.length};return {};};
context.operation=async()=>pending?await pending:{state:outcome};
state.online=true;
state.devices=[{id:'1',name:'LG C5'},{id:'2',name:'Receiver'}];
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
assert.match(content.innerHTML,/href="\/#activities"/);
console.log('Activities home lists activities with their devices, escaped, plus a Manage link');

await click({open:'watch'});
assert.deepEqual(calls.map(c=>[c.path,c.activityId,c.fixState]),[['activities/run','watch',false]]);
assert.equal(store.get('harmony-activity'),'watch');
assert.equal(context.location.hash,'#/activity/watch');
draw();
assert.match(content.innerHTML,/Running/);assert.match(content.innerHTML,/data-stop/);
console.log('Tapping an activity starts it, remembers it and opens its remote');

calls.length=0;context.location.hash='#/activities';
await click({open:'watch'});
assert.equal(calls.length,0);assert.equal(context.location.hash,'#/activity/watch');
console.log('Tapping the running activity just opens its remote');

calls.length=0;context.location.hash='#/activities';
await click({fix:'empty'});
assert.deepEqual(calls.map(c=>[c.activityId,c.fixState]),[['empty',true]]);
assert.equal(store.get('harmony-activity'),'empty');assert.equal(context.location.hash,'#/activities');
assert.match(el('notice').textContent,/Device state fixed/);
console.log('Fix device state re-runs with fixState, stays on the list and remembers the activity');

calls.length=0;
await click({stop:''});
assert.deepEqual(calls.map(c=>[c.activityId,c.fixState]),[['-1',false]]);
assert.equal(store.get('harmony-activity'),'');
console.log('Stop sends the hub power-off request and clears the running activity');

store.set('harmony-activity','watch');calls.length=0;outcome='cancelled';context.location.hash='#/activities';draw();
await click({open:'empty'});
assert.equal(store.get('harmony-activity'),'watch');assert.equal(context.location.hash,'#/activities');
assert.match(el('notice').textContent,/Cancelled/);assert.equal(el('notice').dataset.error,'true');
outcome='completed';
console.log('A cancelled start is not remembered and does not navigate');

calls.length=0;state.online=false;
await click({open:'empty'});
assert.equal(calls.length,0);assert.match(el('notice').textContent,/disconnected/);
state.online=true;
console.log('Starting while disconnected is refused without calling the hub');

calls.length=0;let release;pending=new Promise(r=>release=r);context.location.hash='#/activities';draw();
const first=click({open:"empty"});for(let i=0;i<10;i++)await Promise.resolve();
await click({open:'watch'});await click({fix:'watch'});
assert.equal(calls.filter(c=>c.path==='activities/run').length,1);
assert.match(content.innerHTML,/data-cancel/);
await click({cancel:''});
assert.deepEqual(calls.at(-1),{path:'operations',id:'op1',action:'cancel'});
release({state:'cancelled'});await first;pending=null;
assert.doesNotMatch(content.innerHTML,/data-cancel/);
console.log('A second tap during a start is ignored and the in-flight start can be cancelled');

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
assert.match(devicesHtml,/href="\/#devices"/);
state.devices=[{id:'9',name:'Odd',type:'constructor',commands:[]}];context.exports.renderDevices({content:devicesContent,params:[]});
assert.match(devicesContent.innerHTML,/icon-Radio/);assert.doesNotMatch(devicesContent.innerHTML,/function|undefined/);
state.devices=[];
assert.equal(context.exports.parseRoute('#/device/bt%2F1').params[0],'bt/1');
console.log('Devices list shows type and command count (singular/plural), links to each device remote, and a Manage link');
state.devices=[];context.exports.renderDevices({content:devicesContent,params:[]});
assert.match(devicesContent.innerHTML,/No devices yet/);assert.match(devicesContent.innerHTML,/Manage devices/);
console.log('Devices list has an empty state that still offers Manage devices');

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
assert.deepEqual(kinds(remoteBlocks([cell('Back'),...arrows.map(c=>cell(c)),cell('Input'),cell('Mute')])),['Back','cross','Input,Mute']);
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
// Pinning all four arrows keeps them as a row in the order set, not a cross.
const arrowRow=remoteHtml({columns:4,cells:[],pinned:['Right','Up','Down','Left'].map(c=>cell(c))}).pinned;
assert.doesNotMatch(arrowRow,/class="dpad"/);
assert.deepEqual([...arrowRow.matchAll(/aria-label="(\w+)"/g)].map(m=>m[1]),['Right','Up','Down','Left']);
console.log('Pinned buttons render as their own footer row, skipping stale and volume cells');

// Full screen: header edit link only for the owner, footer outside the scrolling content.
state.config={activities:[{id:'watch',name:'Watch <TV>',steps:[{deviceId:'tv'}],screen:{columns:4,cells:[cell('Back')],pinned:[cell('Mute')]}}]};
const rc={content:{innerHTML:'',querySelectorAll:()=>[]},actions:{innerHTML:''},params:['watch'],setTitle(t){this.title=t;}};
state.session={role:'owner'};context.exports.renderActivityRemote(rc);
assert.equal(rc.title,'Watch <TV>');
assert.match(rc.actions.innerHTML,/href="#\/edit\/watch"/);
assert.match(rc.content.innerHTML,/class="pinned"/);
rc.actions.innerHTML='';state.session={role:'controller'};context.exports.renderActivityRemote(rc);
assert.equal(rc.actions.innerHTML,'');
rc.params=['nope'];context.exports.renderActivityRemote(rc);assert.match(rc.content.innerHTML,/no longer exists/);
console.log('Activity remote shows the edit link only to the owner and copes with a missing activity');

// Back from the editor returns to that activity's remote, not the list.
context.location.hash='#/edit/watch';show();
assert.equal(el('back').dataset.href,'#/activity/watch');
context.location.hash='#/activity/watch';show();
assert.equal(el('back').dataset.href,'#/activities');assert.equal(context.document.body.dataset.reserveNotice,'true');
context.location.hash='#/devices';show();assert.equal(context.document.body.dataset.reserveNotice,'false');
console.log('Back arrows return to the right parent; only remotes reserve space for send status');

// ---- Hardware volume ----
const sent=[];context.api=async(path,body)=>{sent.push({path,...body});return {id:'op'};};context.operation=async()=>({state:'completed'});
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const setActivity=(activity)=>{state.config={activities:[activity]};store.set('harmony-activity',activity?.id||'');};
state.online=true;
const press=async d=>{sent.length=0;context.window.harmonyHardwareVolume(d);await flush();return sent.map(c=>[c.deviceId,c.command]);};
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
assert.deepEqual([0,7,8,31,32].map(n=>X.editorSlots('cells',n,4)),[4,8,12,32,32]);
assert.equal(X.editorSlots('cells',8,4,1),16);assert.equal(X.editorSlots('cells',30,4,5),32);
assert.equal(X.editorSlots('cells',3,2),4);assert.equal(X.editorSlots('pinned',1,4),4);assert.equal(X.editorSlots('pinned',0,2),2);
console.log('Editor always offers an empty row beyond the last button, honours Add row, and stops at the 32-button limit');

// Available commands: start-step devices, minus placed (grid or footer) and volume.
state.devices=[tv,bar];
const act0={id:'w',name:'W',steps:[{deviceId:'tv'},{delayMs:5},{deviceId:'tv'},{deviceId:'gone'},{deviceId:'bar'}],screen:{columns:4,cells:[cell('Up'),cell('Mute')],pinned:[cell('Back')]}};
const avail=X.availableCommands(act0).map(o=>o.device.id+':'+o.command);
assert.ok(!avail.includes('tv:Up')&&!avail.includes('tv:Mute')&&!avail.includes('tv:Back'),'placed commands are not offered again');
assert.ok(!avail.some(a=>/Volume|VolUp|VolDn/.test(a)),'volume is left to the hardware keys');
assert.ok(avail.includes('tv:OK')&&avail.includes('tv:HDMI 1')&&avail.includes('bar:Mute'));
assert.equal(new Set(avail).size,avail.length);assert.ok(!avail.some(a=>a.startsWith('gone')));
assert.deepEqual(J(X.availableCommands({id:'n',steps:[]})),[]);
console.log("Add menu offers the start-step devices' commands minus placed and volume ones");

// Mutations: packed lists, caps, no duplicates; an activity without a screen gets one.
const bare={id:'b',name:'B',steps:[]};
assert.deepEqual(J(X.screenOf(bare)),{columns:4,cells:[],pinned:[]});
assert.equal(X.addButton(bare,'cells','tv','Up'),true);
assert.equal(X.addButton(bare,'cells','tv','Up'),false,'no duplicates');
assert.equal(X.addButton(bare,'pinned','tv','Up'),false,'not on both the grid and the footer');
for(const c of ['Back','Input','Mute','OK'])assert.equal(X.addButton(bare,'pinned','tv',c),true);
assert.equal(X.addButton(bare,'pinned','tv','Down'),false,'the footer holds at most `columns` buttons');
bare.screen.cells=Array.from({length:X.MAX_CELLS},(_,i)=>({deviceId:'tv',command:'C'+i}));
assert.equal(X.addButton(bare,'cells','tv','Left'),false,'the grid stops at 32 buttons');
assert.equal(X.removeButton(bare,'cells',5),true);assert.equal(bare.screen.cells.length,31);assert.equal(bare.screen.cells[5].command,'C6');
assert.equal(X.removeButton(bare,'cells',99),false);assert.equal(X.removeButton(bare,'cells',-1),false);
const narrow={id:'n',steps:[],screen:{columns:2,cells:[],pinned:[]}};
X.addButton(narrow,'pinned','tv','Up');X.addButton(narrow,'pinned','tv','Down');assert.equal(X.addButton(narrow,'pinned','tv','Left'),false);
console.log('Adding and removing keep packed lists within the grid and footer limits, without duplicates');

// Saving: one request at a time, always the latest state, revision taken from the hub.
{
  const posts=[];let releaseFirst,failPost=false,failGet=false,afterCalls=0;
  state.config={revision:5,activities:[{id:'w',name:'W',steps:[],screen:{columns:4,cells:[]}}]};
  const server={revision:5,activities:[{id:'w',name:'hub copy',steps:[]}]};
  context.api=async(path,body)=>{
    if(path==='configuration'&&body){
      posts.push({revision:body.revision,cells:body.configuration.activities[0].screen.cells.length});
      if(posts.length===1&&releaseFirst===undefined){await new Promise(r=>releaseFirst=r);}
      if(failPost)throw Error('Configuration changed in another browser. Reload before saving.');
      server.revision=body.revision+1;return {ok:true};
    }
    if(path==='configuration'){if(failGet)throw new TypeError('offline');return JSON.parse(JSON.stringify(server));}
    return {};
  };
  // A burst while the first save is in flight coalesces into exactly one more save with the latest edits.
  const first=X.persistConfig();
  state.config.activities[0].screen.cells.push({deviceId:'tv',command:'Up'});X.persistConfig();
  state.config.activities[0].screen.cells.push({deviceId:'tv',command:'Down'});X.persistConfig();
  for(let i=0;i<5;i++)await Promise.resolve();
  assert.equal(posts.length,1);
  releaseFirst();await first;await flush();
  assert.deepEqual(J(posts),[{revision:5,cells:0},{revision:6,cells:2}]);
  assert.equal(state.config.revision,7);
  assert.equal(state.config.activities[0].screen.cells.length,2,'local edits survive the revision refresh');
  // A rejected save shows the error and reloads what the hub actually has.
  failPost=true;posts.length=0;
  context.afterSave=undefined;
  await X.persistConfig();
  assert.match(el('notice').textContent,/^Not saved: Configuration changed in another browser/);assert.equal(el('notice').dataset.error,'true');
  assert.equal(state.config.activities[0].name,'hub copy');
  // Offline: nothing to reload from, so local edits stay and a later save still works.
  state.config={revision:7,activities:[{id:'w',name:'W',steps:[],screen:{columns:4,cells:[{deviceId:'tv',command:'Up'}]}}]};
  failGet=true;await X.persistConfig();
  assert.equal(state.config.activities[0].name,'W');
  failPost=false;failGet=false;posts.length=0;await X.persistConfig();
  assert.deepEqual(J(posts),[{revision:7,cells:1}]);
}
console.log('Saves run one at a time with the latest state, take the revision from the hub, and recover from rejection or offline');

// Rendering: stale and volume cells stay visible (and removable); slots are drawn; labels explain the gestures.
state.devices=[tv,bar];
const editAct={id:'w',name:'W',steps:[{deviceId:'tv'}],screen:{columns:4,cells:[cell('Up'),cell('VolumeUp'),cell('Gone'),cell('HDMI 1')],pinned:[cell('Mute')]}};
const eh=X.editorHtml(editAct,{extraRows:0});
assert.equal((eh.match(/data-zone="cells" data-index=/g)||[]).length,4);
assert.equal((eh.match(/class="cell empty" type="button" data-zone="cells"/g)||[]).length,4);
assert.equal((eh.match(/data-zone="pinned" data-index=/g)||[]).length,1);
assert.equal((eh.match(/class="cell empty" type="button" data-zone="pinned"/g)||[]).length,3);
assert.match(eh,/class="cell missing" type="button" data-zone="cells" data-index="2"/);
assert.match(eh,/Gone \(its device or command no longer exists\)\. Press and hold to remove\./);
assert.match(eh,/aria-label="Volume up\. Press and hold to remove\."/);
assert.match(eh,/Press and hold an empty square to add a button/);assert.match(eh,/data-add-row/);
assert.doesNotMatch(eh,/data-command=/,'editor buttons must never send commands');
assert.equal((X.editorHtml(editAct,{extraRows:1}).match(/class="cell empty" type="button" data-zone="cells"/g)||[]).length,8);
const fullAct={id:'f',steps:[],screen:{columns:4,cells:Array.from({length:32},(_,i)=>cell('C'+i)),pinned:[]}};
const fh=X.editorHtml(fullAct,{extraRows:0});assert.doesNotMatch(fh,/data-add-row/);assert.match(fh,/button limit/);
const twoCol=X.editorHtml({id:'x',steps:[],screen:{columns:2,cells:[]}},{extraRows:0}).split('Always visible')[1];
assert.equal((twoCol.match(/class="cell empty"/g)||[]).length,2,'a 2-column footer has two slots');
console.log('Editor lists every cell (including stale and volume ones), draws empty slots and never sends commands');

// ---- Edit gestures (fake timers) ----
{
  let clock=0,seq=0;const timers=new Map();
  context.setTimeout=(fn,ms)=>{timers.set(++seq,{fn,at:clock+ms});return seq;};
  context.clearTimeout=id=>timers.delete(id);
  const advance=ms=>{clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}};
  const posts=[];
  context.api=async(path,body)=>{if(path==='configuration'&&body){posts.push(J(body.configuration.activities[0].screen));return {ok:true};}if(path==='configuration')return {revision:99,activities:[]};return {};};
  const sheet=Object.assign(el('sheet'),{open:false,innerHTML:'',onclick:null,showModal(){this.open=true;},close(){this.open=false;}});
  const setup=(activity,{owner=true}={})=>{
    state.devices=[tv,bar];state.session={role:owner?'owner':'controller'};state.config={revision:1,activities:[activity]};
    context.location.hash='#/edit/'+activity.id;posts.length=0;sheet.open=false;
    const content={innerHTML:'',isConnected:true,querySelector:()=>null};
    const ctx={content,actions:{innerHTML:''},params:[activity.id],setTitle(t){this.title=t;}};
    X.renderEditor(ctx);return {content,ctx};
  };
  const btn=(content,zone,index)=>{ // find the nth zone button in the rendered html
    const re=index===undefined?new RegExp(`class="cell empty" type="button" data-zone="${zone}"`):new RegExp(`data-zone="${zone}" data-index="${index}"`);
    assert.match(content.innerHTML,re,`${zone} ${index} should be rendered`);
    return {dataset:{zone,...(index===undefined?{}:{index:String(index)})},classList:{contains:c=>c==='empty'&&index===undefined}};
  };
  const down=(content,b,x=10,y=10)=>content.onpointerdown({target:{closest:()=>b},button:0,clientX:x,clientY:y});
  const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

  // Press-and-hold a filled cell removes it immediately and saves.
  let a={id:'w',name:'W',steps:[{deviceId:'tv'}],screen:{columns:4,cells:[cell('Up'),cell('Down'),cell('Mute')],pinned:[cell('Back')]}};
  let {content,ctx}=setup(a);
  assert.equal(ctx.title,'Edit remote: W');
  down(content,btn(content,'cells',1));advance(499);assert.equal(a.screen.cells.length,3,'not before the hold time');
  advance(2);await settle();
  assert.deepEqual(J(a.screen.cells.map(c=>c.command)),['Up','Mute']);
  assert.equal(posts.length,1);assert.deepEqual(posts[0].cells.map(c=>c.command),['Up','Mute']);
  assert.equal(context.vibrated,1);
  assert.equal((content.innerHTML.match(/data-zone="cells" data-index=/g)||[]).length,2,'the grid redraws immediately');
  // A tap (released early), a drag past the slop, and a pointer cancel all do nothing.
  for(const stop of ['up','move','cancel']){
    ({content}=setup(a));posts.length=0;
    down(content,btn(content,'cells',0));
    if(stop==='up')content.onpointerup();
    if(stop==='move')content.onpointermove({clientX:10,clientY:40});
    if(stop==='cancel')content.onpointercancel();
    advance(1000);await settle();
    assert.equal(a.screen.cells.length,2,stop);assert.equal(posts.length,0,stop);
  }
  ({content}=setup(a));down(content,btn(content,'cells',0));content.onpointermove({clientX:12,clientY:14});advance(600);await settle();
  assert.equal(a.screen.cells.length,1,'a small wobble still counts as holding');
  // Navigating away before the hold completes does nothing.
  ({content}=setup(a));posts.length=0;down(content,btn(content,'cells',0));context.location.hash='#/devices';advance(600);await settle();
  assert.equal(a.screen.cells.length,1);assert.equal(posts.length,0);

  // Press-and-hold an empty cell opens the add sheet; choosing a command adds it and saves.
  a={id:'w',name:'W',steps:[{deviceId:'tv'}],screen:{columns:4,cells:[cell('Up')],pinned:[]}};
  ({content}=setup(a));
  down(content,btn(content,'cells'));advance(600);
  assert.equal(sheet.open,true);
  assert.match(sheet.innerHTML,/TV: Down/);assert.doesNotMatch(sheet.innerHTML,/TV: Up</);assert.doesNotMatch(sheet.innerHTML,/TV: Volume/);
  const downOption=[...sheet.innerHTML.matchAll(/data-pick="(\d+)"[^>]*>(?:<[^>]*>)*[^<]*<\/span>TV: Down</g)].map(m=>m[1]);
  assert.equal(downOption.length,1);
  sheet.onclick({target:{closest:sel=>sel==='[data-pick]'?{dataset:{pick:downOption[0]}}:null}});await settle();
  assert.equal(sheet.open,false);assert.deepEqual(J(a.screen.cells.map(c=>c.command)),['Up','Down']);
  assert.equal(posts.length,1);
  // Cancel and backdrop close the sheet without changing anything.
  posts.length=0;down(content,btn(content,'cells'));advance(600);assert.equal(sheet.open,true);
  sheet.onclick({target:{closest:sel=>sel==='[data-sheet-cancel]'?{}:null}});assert.equal(sheet.open,false);
  down(content,btn(content,'cells'));advance(600);sheet.onclick({target:sheet,closest:()=>null});assert.equal(sheet.open,false);
  assert.equal(a.screen.cells.length,2);assert.equal(posts.length,0);

  // The footer is edited the same way, into its own list.
  down(content,btn(content,'pinned'));advance(600);
  const mute=[...sheet.innerHTML.matchAll(/data-pick="(\d+)"[^>]*>(?:<[^>]*>)*[^<]*<\/span>TV: Mute</g)].map(m=>m[1])[0];
  sheet.onclick({target:{closest:sel=>sel==='[data-pick]'?{dataset:{pick:mute}}:null}});await settle();
  assert.deepEqual(J(a.screen.pinned.map(c=>c.command)),['Mute']);assert.equal(a.screen.cells.length,2);
  down(content,btn(content,'pinned',0));advance(600);await settle();assert.equal(a.screen.pinned.length,0);

  // Nothing left to add: the sheet says so instead of listing nothing.
  a={id:'w',name:'W',steps:[{deviceId:'bar'}],screen:{columns:4,cells:[cell('Mute','bar')],pinned:[]}};
  ({content}=setup(a));down(content,btn(content,'cells'));advance(600);
  assert.match(sheet.innerHTML,/already on the remote/);assert.doesNotMatch(sheet.innerHTML,/data-pick/);
  a={id:'w',name:'W',steps:[],screen:{columns:4,cells:[],pinned:[]}};
  ({content}=setup(a));down(content,btn(content,'cells'));advance(600);assert.match(sheet.innerHTML,/no devices yet/);
  sheet.close();

  // Keyboard: Enter on an empty slot opens the sheet, Delete removes a button.
  a={id:'w',name:'W',steps:[{deviceId:'tv'}],screen:{columns:4,cells:[cell('Up')],pinned:[]}};
  ({content}=setup(a));
  const key=(b,k)=>{let prevented=false;content.onkeydown({key:k,target:{closest:()=>b},preventDefault(){prevented=true;}});return prevented;};
  assert.equal(key(btn(content,'cells'),'Enter'),true);assert.equal(sheet.open,true);sheet.close();
  assert.equal(key(btn(content,'cells'),'x'),false);
  assert.equal(key(btn(content,'cells',0),'Enter'),false);assert.equal(a.screen.cells.length,1,'Enter does not remove');
  const vibratedBefore=context.vibrated;
  assert.equal(key(btn(content,'cells',0),'Delete'),true);await settle();assert.equal(a.screen.cells.length,0);
  assert.equal(context.vibrated,vibratedBefore,'only a real long-press vibrates');

  // Add row reveals another row of empty slots.
  ({content}=setup(a));
  const before=(content.innerHTML.match(/class="cell empty" type="button" data-zone="cells"/g)||[]).length;
  content.onclick({target:{closest:sel=>sel==='[data-add-row]'?{}:null}});
  assert.equal((content.innerHTML.match(/class="cell empty" type="button" data-zone="cells"/g)||[]).length,before+4);

  // Not the owner, or an activity that is gone: no editor, no handlers.
  a={id:'w',name:'W',steps:[],screen:{columns:4,cells:[cell('Up')],pinned:[]}};
  ({content}=setup(a,{owner:false}));assert.match(content.innerHTML,/Only the hub owner/);assert.equal(content.onpointerdown,undefined);
  const ghost={content:{innerHTML:'',isConnected:true},params:['ghost'],setTitle(){}};X.renderEditor(ghost);assert.match(ghost.content.innerHTML,/no longer exists/);
  // The activity vanishing under an open editor (another browser) redraws safely.
  ({content}=setup({id:'w',name:'W',steps:[{deviceId:'tv'}],screen:{columns:4,cells:[cell('Up')],pinned:[]}}));
  state.config={revision:2,activities:[]};down(content,btn(content,'cells',0));advance(600);await settle();
  assert.match(content.innerHTML,/no longer exists/);
  context.setTimeout=()=>0;context.clearTimeout=()=>{};
}
console.log('Press-and-hold adds and removes immediately; taps, drags, cancels and leaving the screen do nothing; keyboard and sheet paths work');

// Leaving the editor must not leave its handlers on the shared content element.
{
  const content=el('content');content.onpointerdown=()=>{};content.onkeydown=()=>{};content.oncontextmenu=()=>{};
  state.config={activities:[]};state.session={role:'owner'};context.location.hash='#/devices';show();
  assert.equal(content.onpointerdown,null);assert.equal(content.onkeydown,null);assert.equal(content.oncontextmenu,null);
}
console.log('Switching screens clears the previous screen’s handlers');
