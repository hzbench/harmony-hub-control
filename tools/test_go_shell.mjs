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
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},setTimeout:()=>0,clearTimeout(){},fetch:async()=>{throw new TypeError('offline');},AbortController,URL});
const inert=source.replace(/\n  boot\(\);\n\}\s*$/,'\n}');assert.notEqual(inert,source,'boot() auto-run not found');
vm.runInContext(inert.replace('const state =','var state =')+'\nthis.exports={parseRoute,routeHash,connection,state,needsFullUi,api,show,screens,renderActivities,renderDevices,remoteBlocks,remoteHtml,renderActivityRemote,CONTROLS,controlFor,volumeTarget};',context);
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
