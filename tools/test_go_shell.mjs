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
const context=vm.createContext({document:{getElementById:el,title:'',body:{dataset:{}},addEventListener(){},hidden:false},window:{addEventListener(){},scrollTo(){}},location:{hash:'',replace(url){context.replaced=url;}},history:{replaceState(){},pushState(){context.pushed=(context.pushed||0)+1;},back(){context.backed=(context.backed||0)+1;}},
  confirm:message=>{(context.confirmed||(context.confirmed=[])).push(message);return context.confirmAnswer!==false;},navigator:{vibrate(){context.vibrated=(context.vibrated||0)+1;}},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},setTimeout:()=>0,clearTimeout(){},fetch:async()=>{throw new TypeError('offline');},AbortController,URL,structuredClone});
const inert=source.replace(/\n  boot\(\);\n\}\s*$/,'\n}');assert.notEqual(inert,source,'boot() auto-run not found');
vm.runInContext(inert.replace('const state =','var state =')+'\nthis.exports={parseRoute,routeHash,connection,state,needsFullUi,api,show,screens,renderActivities,renderDevices,deviceRemoteHtml,renderDeviceRemote,remoteBlocks,remoteHtml,renderActivityRemote,CONTROLS,controlFor,volumeTarget,editorSlots,availableCommands,addButton,removeButton,editorHtml,renderEditor,screenOf,MAX_CELLS,layoutShape,startDraft,submitLayout,getLeaveGuard:()=>leaveGuard,cloneScreen,withSlots,announceHub};',context);
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

// Slots: buttons keep the grid slot they sit in; gaps stay, empty rows collapse.
const slotCell=(command,slot,deviceId='tv')=>({deviceId,command,slot});
const slotsOf=html=>[...html.matchAll(/<button[^>]*data-command="([^"]*)"|<span><\/span>/g)].map(m=>m[1]||'_');
let grid=remoteHtml({columns:4,cells:[slotCell('Mute',3),slotCell('Back',0)]}).body;
assert.deepEqual(slotsOf(grid),['Back','_','_','Mute'],'gaps between buttons stay open, and order follows the slot not the list');
grid=remoteHtml({columns:4,cells:[slotCell('Back',0),slotCell('Input',9)]}).body;
assert.deepEqual(slotsOf(grid),['Back','_','_','_','_','Input','_','_'],'a row with no buttons collapses; gaps inside a row stay');
grid=remoteHtml({columns:3,cells:[slotCell('Back',4)]}).body;assert.deepEqual(slotsOf(grid),['_','Back','_']);
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
context.location.hash='#/setup';show();assert.equal(context.document.body.dataset.reserveNotice,'true','Setup holds space for its saved/error notice so the form does not jump');context.location.hash='#/devices';show();
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
assert.deepEqual(filled(eh,'pinned'),[2]);assert.deepEqual(emptied(eh,'pinned'),[0,1,3]);
assert.match(eh,/class="cell missing" type="button" data-zone="cells" data-slot="5"/);
assert.match(eh,/Gone \(its device or command no longer exists\)\. Press and hold to remove\./);
assert.match(eh,/aria-label="Volume up\. Press and hold to remove\."/);
assert.match(eh,/aria-label="Empty slot\. Tap to add a button\."/);
assert.match(eh,/Tap an empty square to add a button\. Press and hold a button to remove it\./);
assert.match(eh,/The bottom row stays on screen/);assert.doesNotMatch(eh,/Always visible/i);
assert.match(eh,/data-add-row/);assert.doesNotMatch(eh,/data-command=/,'editor buttons must never send commands');
assert.deepEqual(emptied(X.editorHtml({id:'w',steps:[],screen:editAct},{extraRows:1}),'cells').length,8);
const fullAct={id:'f',steps:[],screen:{columns:4,cells:Array.from({length:32},(_,i)=>sc('C'+i,i)),pinned:[]}};
const fh=X.editorHtml(fullAct,{extraRows:0});assert.doesNotMatch(fh,/data-add-row/);assert.match(fh,/button limit/);
const twoCol=X.editorHtml({id:'x',steps:[],screen:{columns:2,cells:[],pinned:[]}},{extraRows:0}).split('class="pinned"')[1];
assert.equal(emptied(twoCol,'pinned').length,2,'a 2-column footer has two slots');
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
  const setup=(activity,{owner=true}={})=>{
    newHub(activity);state.devices=[tv,bar];state.session={role:owner?'owner':'controller'};state.config=J(hub);
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
  click(content,'[data-add-row]');   // a second row of empty squares
  tapSlot(content,'cells',6);
  assert.equal(sheet.open,true);assert.match(sheet.innerHTML,/TV: Down/);assert.doesNotMatch(sheet.innerHTML,/TV: Up</);assert.doesNotMatch(sheet.innerHTML,/TV: Volume/);
  await choose('TV: Down');
  assert.equal(sheet.open,false);assert.deepEqual(layout(content,'cells'),{0:'Up',6:'Down'},'added where it was tapped, not at the first free slot');
  tapSlot(content,'pinned',2);await choose('TV: Mute');
  assert.deepEqual(layout(content,'pinned'),{2:'Mute'});assert.equal(posts.length,0);
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
  assert.deepEqual(posts[0].cells,[sc('Down',6)]);assert.deepEqual(posts[0].pinned,[sc('Mute',2)]);
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
  context.confirmed.length=0;pressCancel(ctx);assert.equal(context.confirmed.length,0,'clean: no prompt');assert.equal(context.location.hash,'#/activity/w');
  context.location.hash='#/edit/w';
  down(content,slotBtn(content,'cells',0));advance(600);await settle();
  el('notice').textContent='Saved.';
  context.confirmAnswer=false;pressCancel(ctx);assert.deepEqual(layout(content,'cells'),{1:'Down',2:'Mute'});assert.equal(context.location.hash,'#/edit/w','declining stays put');
  context.confirmAnswer=true;pressCancel(ctx);
  assert.equal(el('notice').textContent,'');assert.equal(context.location.hash,'#/activity/w');
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

  // Keyboard: an empty square opens the sheet from its normal click (Enter/Space), Delete removes the focused button.
  ({content,ctx}=setup({...base0,screen:{columns:4,cells:[sc('Up',0)],pinned:[]}}));
  const key=(b,k)=>{let prevented=false;content.onkeydown({key:k,target:{closest:()=>b},preventDefault(){prevented=true;}});return prevented;};
  assert.equal(key(slotBtn(content,'cells',3),'Enter'),false,'Enter on an empty square is left to the browser, which clicks it');
  assert.equal(key(slotBtn(content,'cells',0),'Enter'),false);assert.deepEqual(layout(content,'cells'),{0:'Up'},'Enter does not remove');
  const vibratedBefore=context.vibrated;
  assert.equal(key(slotBtn(content,'cells',0),'Delete'),true);assert.deepEqual(layout(content,'cells'),{});
  assert.equal(context.vibrated,vibratedBefore,'only a real long-press vibrates');
  assert.equal(key(slotBtn(content,'cells',2),'Delete'),false,'Delete on an empty square does nothing');

  // Add row reveals another row of empty slots.
  ({content}=setup({...base0,screen:{columns:4,cells:[],pinned:[]}}));
  const before=empties(content,'cells').length;
  click(content,'[data-add-row]');
  assert.equal(empties(content,'cells').length,before+4);

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
  assert.deepEqual([...content.innerHTML.matchAll(/<a class="row-main" href="([^"]+)"/g)].map(m=>m[1]),['#/roku','/#devices','/#activities','/#settings']);
  assert.match(content.innerHTML,/IR codes/);
}
console.log('Setup links into the original pages');
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
  for(const host of ['8.8.8.8','roku.local','192.168.1','192.168.1.300','172.32.0.1','']){await submit('Bed',"player",host);assert.equal(writes.length,0,host);assert.equal(el('notice').dataset.error,'true');}
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
  // Only the owner can change Rokus.
  state.session={role:'control'};const plain={innerHTML:''};X.screens.roku.render({content:plain,actions:{},params:[],setTitle(){}});
  assert.match(plain.innerHTML,/Only the hub owner/);assert.doesNotMatch(plain.innerHTML,/roku-name/);
  assert.equal(X.screens.roku.parent,'setup');
}
console.log('The owner can add, test and remove a Roku; Rokus appear as devices');
console.log('Switching screens clears the previous screen’s handlers');
