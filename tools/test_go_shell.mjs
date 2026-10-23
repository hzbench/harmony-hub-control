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
const el=id=>elements[id]||=({id,dataset:{},hidden:false,textContent:'',innerHTML:'',title:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},focus(){},addEventListener(){},querySelectorAll:()=>[]});
const context=vm.createContext({document:{getElementById:el,title:''},window:{addEventListener(){},scrollTo(){}},location:{hash:'',replace(url){context.replaced=url;}},history:{replaceState(){}},
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},setTimeout:()=>0,clearTimeout(){},fetch:async()=>{throw new TypeError('offline');},AbortController,URL});
const inert=source.replace(/\n  boot\(\);\n\}\s*$/,'\n}');assert.notEqual(inert,source,'boot() auto-run not found');
vm.runInContext(inert.replace('const state =','var state =')+'\nthis.exports={parseRoute,routeHash,connection,state,needsFullUi,api,show,screens,renderActivities,renderDevices};',context);
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
assert.equal(context.exports.parseRoute('#/device/bt%2F1').params[0],'bt/1');
console.log('Devices list shows type and command count (singular/plural), links to each device remote, and a Manage link');
state.devices=[];context.exports.renderDevices({content:devicesContent,params:[]});
assert.match(devicesContent.innerHTML,/No devices yet/);assert.match(devicesContent.innerHTML,/Manage devices/);
console.log('Devices list has an empty state that still offers Manage devices');
