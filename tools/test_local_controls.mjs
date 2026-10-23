import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../payload/www/app.js',import.meta.url),'utf8');
new vm.Script(source);
// The same tap / press-and-hold code lives in app.js (original UI) and go.js
// (daily-use UI); every scenario below runs against both.
const goSource=fs.readFileSync(new URL('../payload/www/go.js',import.meta.url),'utf8');
new vm.Script(goSource);
const commandCode={'app.js':source.slice(source.indexOf('async function tap('),source.indexOf('function drawer()')),
  'go.js':goSource.slice(goSource.indexOf('async function tap('),goSource.indexOf('// --- end command sending ---'))};
let code;
// window.harmonyHardwareVolume() chains a .then()/.catch()/.finally() onto
// its api() call rather than being itself async/awaited, so tests that
// drive it need to drain enough queued microtasks for that whole chain to
// settle before asserting on its side effects.
async function flushMicrotasks(){for(let i=0;i<20;i++)await Promise.resolve();}
function setup({delayQueue=false}={}){
  let now=0, sequence=0, failRenew=false, queue, finish;
  const timers=new Map(), calls=[], handlers={}, globals={}, state={online:true,hold:null,devices:[{id:'tv',transport:'ir'}]};
  const button={dataset:{device:'tv',command:'VolumeUp'},classList:{add(){},remove(){}},setAttribute(){},setPointerCapture(){},
    getBoundingClientRect:()=>({left:0,top:0,right:60,bottom:60}),addEventListener:(name,fn)=>handlers[name]=fn};
  const schedule=(fn,ms,repeat=false)=>{timers.set(++sequence,{fn,at:now+ms,ms,repeat});return sequence;};
  const surface={hidden:false,addEventListener:(name,fn)=>globals[name]=fn};
  const context=vm.createContext({state,Date:{now:()=>now},notice(){},root:{querySelectorAll:()=>[button]},window:surface,document:surface,
    setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>schedule(fn,ms,true),clearInterval:id=>timers.delete(id),
    api:async(path,body)=>{
      calls.push({path,...body});
      if(body.action==='keepalive'&&failRenew)throw Error('offline');
      if(body.mode==='hold'&&delayQueue)return new Promise(resolve=>queue=resolve);
      return {id:'operation-1'};
    },operation:()=>new Promise((resolve,reject)=>finish={resolve,reject})});
  vm.runInContext(code+'\nbindCommands(root);',context);
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  async function advance(ms){
    const end=now+ms;
    while(true){
      const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!due)break;
      const [id,t]=due;now=t.at;
      if(t.repeat)t.at+=t.ms;else timers.delete(id);
      t.fn();await flush();
    }
    now=end;await flush();
  }
  function event(type,props={}){handlers[type]?.({button:0,pointerId:1,key:'Enter',repeat:false,clientX:30,clientY:30,preventDefault(){},...props});}
  return {event,advance,flush,calls,state,timers,surface,
    surfaceEvent:type=>globals[type]?.(),failRenew:()=>failRenew=true,
    finish:async(error=false)=>{error?finish.reject(Error('failed')):finish.resolve({state:'completed'});await flush();},
    queued:async()=>{queue({id:'operation-1'});await flush();}};
}
for(const [name,source] of Object.entries(commandCode)){
code=source;
let t=setup();t.event('pointerdown');await t.advance(100);t.event('pointerup');t.event('click');await t.flush();
assert.equal(t.calls.filter(c=>c.path==='commands/send').length,1);
assert.equal(t.calls[0].mode,'tap');
for(const stop of ['pointerup','keyup','pointercancel','lostpointercapture','blur','pointermove']){
  t=setup();t.event(stop==='keyup'?'keydown':'pointerdown');await t.advance(1600);
  assert.equal(t.calls[0].mode,'hold');
  t.event(stop,stop==='pointermove'?{clientX:100}:{});if(stop==='pointerup'||stop==='keyup')t.event('click');await t.flush();
  assert.equal(t.state.hold,null);
  assert.equal(t.calls.filter(c=>c.action==='cancel').length,1);
  assert.equal(t.calls.filter(c=>c.path==='commands/send').length,1,'release must not send an extra tap');
}
console.log('New remote ('+name+'): touch, keyboard, long-hold release, pointer cancellation and synthetic-click suppression passed');

for(const stop of ['blur','pagehide','visibilitychange']){
  t=setup();t.event('pointerdown');await t.advance(550);
  assert.equal(t.calls.filter(c=>c.action==='keepalive').length,1);
  t.surface.hidden=true;t.surfaceEvent(stop);await t.advance(1000);
  assert.equal(t.calls.filter(c=>c.action==='cancel').length,1,stop);
  assert.equal(t.timers.size,0);
}
t=setup({delayQueue:true});t.event('pointerdown');await t.advance(300);t.event('pointerup');await t.queued();
assert.equal(t.calls.filter(c=>c.action==='cancel').length,1);
assert.equal(t.calls.filter(c=>c.mode==='tap').length,0);
assert.equal(t.timers.size,0);
t=setup();t.event('pointerdown');await t.advance(300);t.failRenew();await t.advance(250);
assert.equal(t.state.hold,null);assert.equal(t.calls.filter(c=>c.action==='cancel').length,1);
assert.equal(t.timers.size,0);
for(const error of [false,true]){
  t=setup();t.event('pointerdown');await t.advance(300);await t.finish(error);t.event('pointerup');await t.flush();
  assert.equal(t.state.hold,null);assert.equal(t.timers.size,0);
  assert.equal(t.calls.filter(c=>c.mode==='tap').length,0);
}
t=setup();t.state.online=false;t.event('pointerdown');await t.advance(1000);t.event('pointerup');await t.flush();
assert.equal(t.calls.length,0);
t=setup();t.event('pointerdown');t.event('pointermove',{clientX:100});await t.advance(1000);
assert.equal(t.calls.length,0);
console.log(name+': hold renewal failure, queued-release race, hidden pages, completion/failure and offline controls passed');
}

const remoteCode=source.slice(source.indexOf('const norm ='),source.indexOf('function renderRemote()'));
const remote=vm.createContext({state:{devices:[{id:'tv',commands:[{name:'VolumeUp'}]}],config:{activities:[]}},readLocal:key=>key==='harmony-activity'?'watch':'tv',escape:s=>String(s),icon:s=>s});
vm.runInContext(remoteCode,remote);
assert.match(vm.runInContext('remoteButton("volumeup",activeDevice())',remote),/data-command="VolumeUp" data-device="tv"/);
assert.equal(vm.runInContext('remoteButton("ok",activeDevice())',remote),'');
console.log('Remote buttons resolve commands via device aliases and hide unmatched controls');

// resolveCell() is the lookup renderActivityScreen()'s cellButton() uses to
// turn a stored {deviceId,command} cell back into a renderable button (and
// the one harmonyHardwareVolume() reuses below) - unit-tested directly here
// since, like remoteButton() above, it's exercised through its pure return
// value rather than a full mount()ed render.
assert.equal(vm.runInContext("resolveCell({deviceId:'tv',command:'VolumeUp'}).device.id",remote),'tv');
assert.equal(vm.runInContext("resolveCell({deviceId:'tv',command:'VolumeUp'}).command.name",remote),'VolumeUp');
assert.equal(vm.runInContext("resolveCell({deviceId:'missing',command:'VolumeUp'})",remote),null);
assert.equal(vm.runInContext("resolveCell({deviceId:'tv',command:'Missing'})",remote),null);
console.log('resolveCell() resolves a screen cell to its live device/command and rejects stale references');

const volumeCalls=[];
const volumeState={online:true,config:{activities:[{id:'watch',screen:{cells:[{deviceId:'tv',command:'VolumeUp',label:'Volume'},{deviceId:'tv',command:'VolumeDown',label:'Volume'}]}}]},devices:[{id:'tv',transport:'ir',commands:[{name:'VolumeUp'},{name:'VolumeDown'}]}]};
const volumeCode=source.slice(source.indexOf('const norm ='),source.indexOf('function stopHold('));
const volumeContext=vm.createContext({state:volumeState,window:{},readLocal:key=>key==='harmony-activity'?'watch':'tv',escape:String,icon:()=>'',
  api:async(path,body)=>{if(path.startsWith('operations?'))return {state:'completed'};volumeCalls.push({path,...body});return {id:'op-1'};}});
vm.runInContext(volumeCode,volumeContext);
vm.runInContext('window.harmonyHardwareVolume("up")',volumeContext);
await flushMicrotasks();
assert.equal(volumeCalls.length,1);assert.equal(volumeCalls[0].deviceId,'tv');assert.equal(volumeCalls[0].command,'VolumeUp');
volumeCalls.length=0;
vm.runInContext('window.harmonyHardwareVolume("down")',volumeContext);
await flushMicrotasks();
assert.equal(volumeCalls.length,1);assert.equal(volumeCalls[0].command,'VolumeDown');
console.log('Hardware volume keys resolve the right command from an active activity\'s custom screen');

// A saved custom layout that omits the volume slot must suppress the
// hardware key too, same as it already suppresses the on-screen button —
// previously only remoteButton() enforced this.
const suppressedCalls=[];
const suppressedState={online:true,config:{activities:[],layouts:{tv:[{slot:'ok',command:'Select'}]}},devices:[{id:'tv',transport:'ir',commands:[{name:'VolumeUp'},{name:'Select'}]}]};
const suppressedContext=vm.createContext({state:suppressedState,window:{},readLocal:key=>key==='harmony-activity'?'':'tv',escape:String,icon:()=>'',
  api:async(path,body)=>{if(path.startsWith('operations?'))return {state:'completed'};suppressedCalls.push({path,...body});return {id:'op-1'};}});
vm.runInContext(volumeCode,suppressedContext);
vm.runInContext('window.harmonyHardwareVolume("up")',suppressedContext);
await flushMicrotasks();
assert.equal(suppressedCalls.length,0);
console.log('Hardware volume key is suppressed by a custom layout the same way the on-screen button is');

// A screen cell referencing a deleted device/command must be skipped in
// favor of the next alias-matching cell, instead of silently sending to
// a stale target (or sending nothing at all).
const staleCalls=[];
const staleState={online:true,config:{activities:[{id:'watch',screen:{cells:[{deviceId:'missing',command:'VolumeUp'},{deviceId:'tv',command:'VolumeUp'}]}}]},devices:[{id:'tv',transport:'ir',commands:[{name:'VolumeUp'}]}]};
const staleContext=vm.createContext({state:staleState,window:{},readLocal:key=>key==='harmony-activity'?'watch':'tv',escape:String,icon:()=>'',
  api:async(path,body)=>{if(path.startsWith('operations?'))return {state:'completed'};staleCalls.push({path,...body});return {id:'op-1'};}});
vm.runInContext(volumeCode,staleContext);
vm.runInContext('window.harmonyHardwareVolume("up")',staleContext);
await flushMicrotasks();
assert.equal(staleCalls.length,1);assert.equal(staleCalls[0].deviceId,'tv');
console.log('Hardware volume key skips a screen cell with a deleted device and uses the next matching one');
vm.runInContext("state.config.activities=[];state.devices[0].commands=[{name:'Vol_dn'},{name:'Ch_next'},{name:'Ch_prev'}]",remote);
for(const [slot,command] of [['volumedown','Vol_dn'],['channelup','Ch_next'],['channeldown','Ch_prev']]){
  assert.match(vm.runInContext(`remoteButton('${slot}',activeDevice())`,remote),new RegExp(`data-command="${command}"`));
}
console.log('Imported LG volume-down and channel command aliases resolve correctly');
vm.runInContext("state.devices[0].commands=[{name:'Power On'},{name:'Power Off'}]",remote);
assert.match(vm.runInContext('remoteButton("poweron",activeDevice())',remote),/>On<\/span>/);
assert.match(vm.runInContext('remoteButton("poweroff",activeDevice())',remote),/>Off<\/span>/);

const ui=vm.createContext({escape:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;'),icon:()=>'',deviceOptions:()=>'<option>TV</option>',commandOptions:()=>'<option>Power</option>'});
vm.runInContext(source.slice(source.indexOf('function deviceTypeOptions('),source.indexOf('const norm =')),ui);
assert.match(vm.runInContext('deviceTypeOptions("TV & projector")',ui),/<option selected>TV &amp; projector<\/option>/);
assert.equal((vm.runInContext('deviceTypeOptions("Television")',ui).match(/>Television</g)||[]).length,1);
vm.runInContext(source.slice(source.indexOf('function activityStep('),source.indexOf('function renderActivityEditor(')),ui);
const delay=vm.runInContext('activityStep({deviceId:"",delayMs:500},"steps",0)',ui);
assert.match(delay,/Delay \(ms\)/);assert.doesNotMatch(delay,/data-key="command"|data-key="role"/);
const action=vm.runInContext('activityStep({deviceId:"tv",delayMs:500,role:"power-on"},"steps",0)',ui);
assert.match(action,/Delay after \(ms\)/);assert.match(action,/value="power-on" selected/);

const inputs=Object.fromEntries(['learn-mode','learn-name','learn-raw','learn-code','learn-protocol','save-learned'].map(id=>[id,{value:''}]));
ui.$=id=>inputs[id];
vm.runInContext(source.slice(source.indexOf('function updateLearnSave('),source.indexOf('function renderLearn(')),ui);
function canSave(mode,name,raw='',code='',protocol='2'){
  for(const [id,value] of Object.entries({'learn-mode':mode,'learn-name':name,'learn-raw':raw,'learn-code':code,'learn-protocol':protocol}))inputs[id].value=value;
  vm.runInContext('updateLearnSave()',ui);return !inputs['save-learned'].disabled;
}
assert.equal(canSave('raw','Volume up','9000 4500 560'),true);
assert.equal(canSave('raw','Volume up','','20DF40BF'),false);
assert.equal(canSave('nec','Volume up','','20DF40BF'),true);
assert.equal(canSave('keycode','Volume up','','0020',''),false);
assert.equal(canSave('keycode','Volume up','','0020'),true);
assert.equal(canSave('nec',' ','','20DF40BF'),false);
let routed='settings';ui.state={config:{}};ui.location={hash:'#main'};ui.show=view=>{routed=view;};
inputs.navigation={addEventListener:(name,handler)=>ui.onNavigation=handler};
ui.window={addEventListener:(name,handler)=>ui.onHash=handler};
vm.runInContext(source.slice(source.indexOf("window.addEventListener('hashchange'"),source.indexOf("$('connection').addEventListener")),ui);
ui.onHash();assert.equal(routed,'settings');
ui.location.hash='#devices';ui.onHash();assert.equal(routed,'devices');
ui.onNavigation({target:{closest:()=>({dataset:{view:'devices'}})},preventDefault(){}});assert.equal(routed,'devices');
console.log('Power labels, imported device types, activity fields, manual codes and keyboard skip navigation passed');

vm.runInContext("state.devices[0].commands=['VOL+','VOL-','UP_ARROW','DN_ARROW','LEFT_ARROW','RIGHT_ARROW','ENTER','HOME_MENU','PLAY PAUSE','INPUT-','INPUT+'].map(name=>({name}))",remote);
const layout=JSON.parse(vm.runInContext('JSON.stringify(defaultLayout(activeDevice().commands))',remote));
for(const [slot,name] of [['volumeup','VOL+'],['volumedown','VOL-'],['up','UP_ARROW'],['down','DN_ARROW'],['menu','HOME_MENU'],['play','PLAY PAUSE'],['input','INPUT+']])assert.equal(layout.find(b=>b.slot===slot).command,name);
vm.runInContext('state.config.layouts={tv:[]}',remote);
assert.equal(vm.runInContext('remoteButton("volumeup",activeDevice())',remote),'','explicitly hidden controls must stay hidden');
vm.runInContext(source.slice(source.indexOf('const profileNorm='),source.indexOf('let profileIndex;')),remote);
const matches=vm.runInContext(`findProfiles([
  {type:'blob',path:'Air_Conditioners/Pioneer/Pioneer_AC.ir'},
  {type:'blob',path:'Audio_and_Video_Receivers/Pioneer/Pioneer_VSX_LX52.ir'},
  {type:'blob',path:'_Converted_/Pronto/P/Pioneer/VSX-52.ir'}
],'Pioneer',{manufacturer:'Pioneer',model:'VSX-LX52',type:'Audio'})`,remote);
assert.equal(matches[0].exact,true);assert.equal(matches.length,3);
assert.equal(vm.runInContext(`findProfiles([{type:'blob',path:'SoundBars/Bose/Bose_Solo_5.ir'}],'Bose Solo-5',{manufacturer:'Bose',model:'Solo 5',type:'Audio'}).length`,remote),1);
console.log('Profile ranking, punctuation-insensitive search, receiver aliases and hidden controls passed');

const setupCode=source.slice(source.indexOf('function renderSetupReview()'),source.indexOf('function renderDeviceTest('));
for(const failRefresh of [false,true]){
  const saveCalls=[],fields={'setup-review-back':{},'content':{querySelectorAll:()=>[]},'setup-review':{}};
  const setupState={config:{revision:7},devices:[{id:'2'}],draft:{name:'Receiver',manufacturer:'Pioneer',model:'VSX-LX52',type:'Audio',commands:[{name:'VOL+'}],layout:[],source:'candidate.ir'}};
  const context=vm.createContext({state:setupState,$:id=>fields[id],controls:[],escape:String,setupProgress:()=>'',profileTitle:String,profilePayload:()=>'',mount(){},returnToDevice(){},notice(){},TextEncoder,
    window:{scrollTo(){}},writeLocal(){},show(){},loadDevices:async()=>{},api:async(path,body)=>{saveCalls.push({path,body});if(path==='devices')return {deviceId:'2'};if(failRefresh)throw Error('offline');return {revision:8};}});
  vm.runInContext(setupCode+'\nrenderSetupReview();',context);
  const buttons=[{},{}],form={dataset:{},isConnected:true,querySelectorAll:()=>buttons};
  const event={target:form,submitter:{value:'later'},preventDefault(){}};
  const saving=fields['setup-review'].onsubmit(event);
  await fields['setup-review'].onsubmit(event);await saving;
  assert.equal(saveCalls.filter(c=>c.path==='devices').length,1);
  assert.equal(saveCalls[0].body.action,'create-profile');assert.equal(saveCalls[0].body.revision,7);
  assert.equal(setupState.draft,null,'a saved draft must never be resubmitted after a refresh failure');
  assert.ok(!saveCalls.some(c=>c.path==='commands/send'),'saving never transmits');
}
console.log('Single-save setup, double-submit suppression and refresh-failure handling passed');
