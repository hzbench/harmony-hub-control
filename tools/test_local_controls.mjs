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
  const notices=[], timers=new Map(), calls=[], handlers={}, globals={}, state={online:true,hold:null,devices:[{id:'tv',transport:'ir'}]};
  const button={dataset:{device:'tv',command:'VolumeUp'},classList:{add(){},remove(){}},setAttribute(){},setPointerCapture(){},
    getBoundingClientRect:()=>({left:0,top:0,right:60,bottom:60}),addEventListener:(name,fn)=>handlers[name]=fn};
  const schedule=(fn,ms,repeat=false)=>{timers.set(++sequence,{fn,at:now+ms,ms,repeat});return sequence;};
  const surface={hidden:false,addEventListener:(name,fn)=>globals[name]=fn};
  const context=vm.createContext({state,Date:{now:()=>now},notice:(text,error)=>notices.push({text,error:!!error}),ensureOnline:async()=>state.online,OFFLINE_NOTICE:'offline',root:{querySelectorAll:()=>[button]},window:surface,document:surface,
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
  return {event,advance,flush,calls,notices,state,timers,surface,
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
// Only IR has a held transmission: holding a Bluetooth or Roku button is one tap on release.
for(const transport of ['bluetooth','roku']){
  t=setup();t.state.devices[0].transport=transport;t.event('pointerdown');await t.advance(1600);t.event('pointerup');t.event('click');await t.flush();
  assert.deepEqual(t.calls.filter(c=>c.path==='commands/send').map(c=>[c.mode,c.transport]),[['tap',transport]],transport+' hold sends a single tap');
  assert.equal(t.state.hold,null);
}
if(name==='go.js'){
  // A press that works says nothing; a stale message is cleared, and failures still show.
  t=setup();t.event('pointerdown');await t.advance(100);t.event('pointerup');t.event('click');await t.flush();await t.finish();
  assert.deepEqual(t.notices.filter(n=>n.text),[],'a tap that completes shows no message');
  t=setup();t.event('pointerdown');await t.advance(1600);t.event('pointerup');t.event('click');await t.flush();await t.finish();
  assert.deepEqual(t.notices.filter(n=>n.text),[],'a hold that completes shows no message');
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
ui.window={addEventListener:(name,handler)=>ui.onHash=handler};
vm.runInContext(source.slice(source.indexOf("window.addEventListener('hashchange'"),source.indexOf("$('connection').addEventListener")),ui);
ui.onHash();assert.equal(routed,'settings');
ui.location.hash='#devices';ui.onHash();assert.equal(routed,'devices');
console.log('Power labels, imported device types, activity fields, manual codes and keyboard skip navigation passed');

vm.runInContext("state.devices[0].commands=['VOL+','VOL-','UP_ARROW','DN_ARROW','LEFT_ARROW','RIGHT_ARROW','ENTER','HOME_MENU','PLAY PAUSE','INPUT-','INPUT+'].map(name=>({name}))",remote);
const layout=JSON.parse(vm.runInContext('JSON.stringify(defaultLayout(activeDevice().commands))',remote));
for(const [slot,name] of [['volumeup','VOL+'],['volumedown','VOL-'],['up','UP_ARROW'],['down','DN_ARROW'],['menu','HOME_MENU'],['play','PLAY PAUSE'],['input','INPUT+']])assert.equal(layout.find(b=>b.slot===slot).command,name);
vm.runInContext('state.config.layouts={tv:[]}',remote);
assert.equal(vm.runInContext('remoteButton("volumeup",activeDevice())',remote),'','explicitly hidden controls must stay hidden');
vm.runInContext(source.slice(source.indexOf('const profileNorm='),source.indexOf('let profileIndex,')),remote);
const IR=path=>({type:'blob',path});
const pioneer=[IR('Air_Conditioners/Pioneer/Pioneer_AC.ir'),IR('Audio_and_Video_Receivers/Pioneer/Pioneer_VSX_LX52.ir'),IR('_Converted_/Pronto/P/Pioneer/VSX-52.ir'),IR('_Converted_/CSV/P/Pioneer/Projector/134_-1.ir')];
const search=(files,filters)=>JSON.parse(vm.runInContext(`JSON.stringify(findProfiles(${JSON.stringify(files)},${JSON.stringify(filters)}))`,remote));
let matches=search(pioneer,{brand:'Pioneer',model:'VSX-LX52'});
assert.equal(matches.length,1);assert.equal(matches[0].exact,true);assert.equal(matches[0].brand,'Pioneer');assert.equal(matches[0].model,'VSX LX52');assert.equal(matches[0].deviceType,'Audio');
matches=search(pioneer,{brand:'pioneer'});assert.equal(matches.length,4);assert.ok(matches[0].curated,'curated profiles rank before converted ones');
assert.deepEqual(search(pioneer,{brand:'Pioneer',type:'Audio'}).map(f=>f.path),['Audio_and_Video_Receivers/Pioneer/Pioneer_VSX_LX52.ir','_Converted_/Pronto/P/Pioneer/VSX-52.ir'],'a type keeps that type, then the profiles that do not say; other types are dropped');
assert.deepEqual(search(pioneer,{type:'Television'}).map(f=>f.path),['_Converted_/CSV/P/Pioneer/Projector/134_-1.ir','_Converted_/Pronto/P/Pioneer/VSX-52.ir'],'a converted CSV profile gets its type from its device folder, and comes before the profile that does not say');
assert.deepEqual(search(pioneer,{}),[],'an empty search matches nothing');
assert.equal(search([IR('SoundBars/Bose/Bose_Solo_5.ir')],{model:'Solo-5'}).length,1);
const vizio=['TVs/Vizio/Vizio.ir','TVs/Vizio/Vizio_D43-C1.ir','TVs/Vizio/Vizio_M70Q6-J03.ir','TVs/Vizio/Vizio_XRT122.ir','SoundBars/Vizio/Vizio_SB4551.ir','TVs/Samsung/Samsung_UN55.ir'].map(IR);
const closest=filters=>JSON.parse(vm.runInContext(`JSON.stringify(similarProfiles(${JSON.stringify(vizio)},${JSON.stringify(filters)}))`,remote));
assert.deepEqual(search(vizio,{brand:'Vizio',model:'M55-C2'}),[],'an unknown model has no exact match');
let near=closest({brand:'Vizio',type:'Television',model:'M55-C2'});
assert.deepEqual(near.map(f=>f.path.split('/').pop()),['Vizio.ir','Vizio_D43-C1.ir','Vizio_M70Q6-J03.ir','Vizio_XRT122.ir'],'the brand generic profile first, then the same generation, then the rest; only that brand and type');
assert.equal(near[0].model,'','a brand\'s generic profile has no model of its own');assert.equal(near[0].generic,true);assert.equal(near[1].sameGeneration,true);
assert.equal(closest({brand:'Vizio',model:'M55-C2'}).length,5,'without a type the soundbar is offered too');
assert.equal(closest({brand:'Nobody',model:'X1'}).length,0);
// A converted profile with no device folder may say what it is in its file name; the rest stay untyped.
const typeOf=path=>JSON.parse(vm.runInContext(`JSON.stringify(profileMeta(${JSON.stringify(path)}))`,remote)).deviceType;
assert.equal(typeOf('_Converted_/IR_Plus/V/VIZIO/TV-Generic.ir'),'Television');
assert.equal(typeOf('_Converted_/Pronto/S/Samsung/SOUNDBAR-HW.ir'),'Audio');
assert.equal(typeOf('_Converted_/Pronto/M/Marantz/RECEIVER.ir'),'Audio');
assert.equal(typeOf('_Converted_/Pronto/P/Panasonic/VCR_VTR_2.ir'),'Media Player');
assert.equal(typeOf('_Converted_/Pronto/Y/Yamaha/DVD-C900.ir'),'Media Player');
assert.equal(typeOf('_Converted_/Pronto/V/ViZIO/VO42LFHDTV.ir'),'','a model number that merely contains letters is not a word');
assert.equal(typeOf('_Converted_/Pronto/S/Samsung/PN64D8000.ir'),'');
assert.equal(typeOf('TVs/Samsung/Samsung_UN55.ir'),'Television','curated profiles still take their folder\'s type');
assert.equal(typeOf('_Converted_/CSV/P/Pioneer/Projector/AV_DVD_9.ir'),'Television','the device folder is checked before the file name');
const meta=path=>JSON.parse(vm.runInContext(`JSON.stringify(profileMeta(${JSON.stringify(path)}))`,remote));
assert.deepEqual(meta('TVs/Samsung/Samsung_UN55.ir'),{brand:'Samsung',model:'UN55',deviceType:'Television',curated:true});
assert.deepEqual(meta('Car_Multimedia/CD_Players/JVC/JVC_RM-RK50.ir'),{brand:'JVC',model:'RM-RK50',deviceType:'Audio',curated:true});
assert.deepEqual(meta('_Converted_/Pronto/S/Samsung/PN64D8000.ir'),{brand:'Samsung',model:'PN64D8000',deviceType:'',curated:false});
assert.deepEqual(meta('Fans/Generic_Fan_HS95104SK.ir'),{brand:'',model:'Generic Fan HS95104SK',deviceType:'Other',curated:true});
console.log('Profile search by brand, model and type, path-derived details, ranking, receiver aliases and hidden controls passed');

// ---- Search sources: the built-in Flipper-IRDB plus repositories the user adds ----
{
  const J=value=>JSON.parse(JSON.stringify(value));
  const run=(code,context=remote)=>J(vm.runInContext(code,context));
  const spec=input=>run(`parseSourceSpec(${JSON.stringify(input)})`);
  // What may be added: owner/name (or a github.com link), an optional branch and folder, one of three layouts.
  assert.deepEqual(spec({repo:'Someone/My-Remotes'}).source,{id:'someone/my-remotes||',name:'Someone/My-Remotes',repo:'Someone/My-Remotes',branch:'',folder:'',layout:'brand'});
  assert.equal(spec({repo:'https://github.com/Someone/My-Remotes.git/'}).source.repo,'Someone/My-Remotes','a pasted link and a .git ending are accepted');
  const full=spec({repo:'a/b',branch:'dev/v2',folder:'/Remotes/TVs/',layout:'category'}).source;
  assert.deepEqual([full.branch,full.folder,full.layout,full.name],['dev/v2','Remotes/TVs','category','a/b / Remotes/TVs']);
  assert.equal(spec({repo:'a/b',layout:'nonsense'}).source.layout,'brand','an unknown layout falls back to Brand/Model');
  for(const bad of [{repo:''},{repo:'justaname'},{repo:'a/b/c'},{repo:'-a/b'},{repo:'a/..'},{repo:'a b/c'},{repo:'a/b',branch:'x..y'},{repo:'a/b',branch:'/x'},{repo:'a/b',branch:'x y'},{repo:'a/b',folder:'../etc'},{repo:'a/b',folder:'a/./b'},{repo:'a/b',folder:'a;b'}])
    assert.equal(spec(bad).ok,false,'rejects '+JSON.stringify(bad));
  assert.match(spec({repo:'nope'}).error,/owner\/name/);

  // A source's own files: its folder, readable formats only, no tooling files; each remembers where it came from.
  const src=spec({repo:'a/b',folder:'Remotes',layout:'category'}).source;
  const tree=['Remotes/TVs/Sony/Bravia_X90.ir','Remotes/Audio/Bose/Solo_5.csv','Remotes/README.md','Remotes/Fans/fan.json','Remotes/package.json','Remotes/.github/x.json','Other/TVs/LG/LG_C1.ir','Remotes/notes.txt'].map(path=>({type:'blob',path}));
  tree.push({type:'tree',path:'Remotes/TVs'});
  const entries=run(`profileEntries(${JSON.stringify(src)},${JSON.stringify(tree)})`);
  assert.deepEqual(entries.map(e=>e.path),['Remotes/TVs/Sony/Bravia_X90.ir','Remotes/Audio/Bose/Solo_5.csv','Remotes/Fans/fan.json'],'only readable formats under the folder');
  assert.deepEqual(entries.map(e=>e.rel),['TVs/Sony/Bravia_X90.ir','Audio/Bose/Solo_5.csv','Fans/fan.json'],'details are read relative to the folder');
  assert.deepEqual([entries[0].repo,entries[0].sourceName,entries[0].key],['a/b','a/b / Remotes','a/b/Remotes/TVs/Sony/Bravia_X90.ir']);
  const builtin=run(`profileEntries(BUILTIN_SOURCE,${JSON.stringify([{type:'blob',path:'TVs/Vizio/Vizio.ir'},{type:'blob',path:'Notes/x.csv'}])})`);
  assert.equal(builtin.length,1,'the built-in source still lists only .ir files');assert.equal(builtin[0].key,'TVs/Vizio/Vizio.ir','and keeps its plain path as the key, so "already tried" is unchanged');

  // Brand, model and type from the folders, by the layout chosen for the source.
  const m=(path,layout)=>run(`profileMeta(${JSON.stringify(path)},${JSON.stringify(layout)})`);
  assert.deepEqual(m('Sony/Sony_Bravia_X90.ir','brand'),{brand:'Sony',model:'Bravia X90',deviceType:'',curated:true});
  assert.deepEqual(m('TVs/Sony/Bravia_X90.ir','category'),{brand:'Sony',model:'Bravia X90',deviceType:'Television',curated:true});
  assert.equal(m('Soundbars/Bose/Solo_5.csv','category').deviceType,'Audio');
  assert.equal(m('Sony/Bravia_TV_X90.ir','brand').deviceType,'Television','a type word in the file name counts when the folders say nothing');
  assert.deepEqual(m('Bravia_X90.ir','brand'),{brand:'',model:'Bravia X90',deviceType:'',curated:true},'a file with no folder has no brand and shows its path');
  assert.deepEqual(m('TVs/Vizio/Vizio_D43-C1.ir','flipper'),meta('TVs/Vizio/Vizio_D43-C1.ir'),'the Flipper layout is unchanged');

  // Searching merges the sources; the same profile in two sources is listed once, from the first.
  const fromFlipper=run(`profileEntries(BUILTIN_SOURCE,${JSON.stringify(['TVs/Sony/Sony_Bravia_X90.ir','TVs/Sony/Sony_KD55.ir'].map(path=>({type:'blob',path})))})`);
  const fromMine=run(`profileEntries(${JSON.stringify(src)},${JSON.stringify(['Remotes/TVs/Sony/Sony_Bravia_X90.ir','Remotes/TVs/Sony/Sony_A80J.ir'].map(path=>({type:'blob',path})))})`);
  const merged=run(`mergeProfiles([${JSON.stringify(fromFlipper)},${JSON.stringify(fromMine)}])`);
  assert.deepEqual(merged.map(e=>e.source+':'+e.path),['builtin:TVs/Sony/Sony_Bravia_X90.ir','builtin:TVs/Sony/Sony_KD55.ir',src.id+':Remotes/TVs/Sony/Sony_A80J.ir']);
  assert.deepEqual(run(`mergeProfiles([${JSON.stringify(fromMine)}])`).length,2,'one source needs no merging');
  const found=run(`findProfiles(${JSON.stringify(merged)},{brand:'Sony'})`);
  assert.equal(found.length,3);assert.ok(found.every(f=>f.brand==='Sony'));
  assert.equal(found.find(f=>f.path.endsWith('A80J.ir')).sourceName,'a/b / Remotes','each result says which source it is from');
  assert.equal(found.find(f=>f.path.endsWith('A80J.ir')).model,'A80J');
  assert.equal(run(`similarProfiles(${JSON.stringify(merged)},{brand:'Sony',model:'ZZ9',type:'',})`).length,3,'the closest-profiles fallback covers every source');

  // Where a file is fetched from, and how it is read.
  assert.equal(run(`rawUrl(${JSON.stringify(fromFlipper[0])})`),'https://raw.githubusercontent.com/Lucaslhm/Flipper-IRDB/main/TVs/Sony/Sony_Bravia_X90.ir');
  assert.equal(run(`rawUrl({repo:'a/b',branch:'dev/v2',path:'My Remotes/TV #1.ir'})`),'https://raw.githubusercontent.com/a/b/dev%2Fv2/My%20Remotes/TV%20%231.ir');
  assert.deepEqual(['x.ir','x.CSV','x.lircd','x.conf','x.json','x.girr'].map(f=>run(`profileHint(${JSON.stringify(f)})`)),['flipper','irdb','lirc','lirc','smartir','']);
  assert.equal(run(`profileTitle('a/b/Vizio_D43.json')`),'Vizio D43');
}

// The loader: sources kept on the phone, read one at a time, and a source that fails does not stop the others.
{
  const J=value=>JSON.parse(JSON.stringify(value));
  const pure=source.slice(source.indexOf('const profileNorm='),source.indexOf('let profileIndex,'));
  const loader=source.slice(source.indexOf('let profileIndex,'),source.indexOf('function renderSearch('));
  const make=(routes,stored={})=>{
    const store=new Map(Object.entries(stored)),calls=[];
    const context=vm.createContext({readLocal:(k,f='')=>store.get(k)||f,writeLocal:(k,v)=>store.set(k,v),AbortSignal,Error,JSON,
      fetch:async url=>{calls.push(url.replace('https://api.github.com/',''));
        const hit=Object.entries(routes).find(([key])=>url.endsWith(key));
        if(!hit)return {ok:false,status:404,json:async()=>({})};
        const [status,body]=typeof hit[1]==='function'?hit[1]():hit[1];
        if(status==='offline')throw new TypeError('offline');
        return {ok:status<300,status,json:async()=>body};}});
    vm.runInContext(pure+loader,context);context.calls=calls;context.store=store;return context;
  };
  const tree=(...paths)=>[200,{tree:paths.map(path=>({type:'blob',path}))}];
  const flipper=tree('TVs/Sony/Sony_X90.ir');
  const listed=ctx=>J(vm.runInContext('profileSources().map(({id,enabled,builtin})=>({id,enabled,builtin:!!builtin}))',ctx));
  let c=make({'repos/Lucaslhm/Flipper-IRDB/git/trees/main?recursive=1':flipper});
  assert.deepEqual(listed(c),[{id:'builtin',enabled:true,builtin:true}],'a fresh phone has just the built-in source');
  assert.equal((await vm.runInContext('loadProfileIndex()',c)).length,1);
  await vm.runInContext('loadProfileIndex()',c);assert.equal(c.calls.length,1,'the second search reuses what was read');

  const stored={'harmony-sources':JSON.stringify({builtinOff:false,custom:[{repo:'a/b',folder:'Remotes',layout:'category',enabled:true},{repo:'bad',enabled:true},{repo:'c/d',enabled:false}]})};
  const routes={'repos/Lucaslhm/Flipper-IRDB/git/trees/main?recursive=1':flipper,'repos/a/b':[200,{default_branch:'trunk'}],'repos/a/b/git/trees/trunk?recursive=1':tree('Remotes/TVs/LG/LG_C1.ir','Remotes/README.md')};
  c=make(routes,stored);
  assert.deepEqual(listed(c).map(x=>x.id),['builtin','a/b||remotes','c/d||'],'an invalid stored source is dropped; a turned-off one stays in the list');
  let index=await vm.runInContext('loadProfileIndex()',c);
  assert.deepEqual(J(index).map(f=>f.sourceName),['Flipper-IRDB','a/b / Remotes'],'the sources are merged in order');
  assert.deepEqual(c.calls,['repos/Lucaslhm/Flipper-IRDB/git/trees/main?recursive=1','repos/a/b','repos/a/b/git/trees/trunk?recursive=1'],'a repository added without a branch asks for its default; the turned-off one is not read');
  assert.equal(index.length,2);assert.equal(vm.runInContext('profileProblems.length',c),0);

  // A failing source is reported, the rest still search.
  c=make({...routes,'repos/a/b':[404,{}]},stored);
  index=await vm.runInContext('loadProfileIndex()',c);
  assert.equal(index.length,1);assert.match(J(vm.runInContext('profileProblems',c))[0].message,/not found, or it is private/);
  c=make({...routes,'repos/a/b/git/trees/trunk?recursive=1':[200,{truncated:true,tree:[]}]},stored);
  await vm.runInContext('loadProfileIndex()',c);assert.match(J(vm.runInContext('profileProblems',c))[0].message,/too large to read completely/);
  c=make({...routes,'repos/a/b':[403,{}]},stored);
  await vm.runInContext('loadProfileIndex()',c);assert.match(J(vm.runInContext('profileProblems',c))[0].message,/limiting requests/);
  c=make({...routes,'repos/a/b':['offline',{}]},stored);
  await vm.runInContext('loadProfileIndex()',c);assert.match(J(vm.runInContext('profileProblems',c))[0].message,/could not be reached/);
  // With only one source on, its own message is shown as before; with none on, the person is told what to do.
  c=make({},{});await assert.rejects(()=>vm.runInContext('loadProfileIndex()',c),/Community search is unavailable/);
  c=make({'repos/Lucaslhm/Flipper-IRDB/git/trees/main?recursive=1':[200,{truncated:true,tree:[]}]});await assert.rejects(()=>vm.runInContext('loadProfileIndex()',c),/Community index is incomplete/);
  c=make(routes,{'harmony-sources':JSON.stringify({builtinOff:true,custom:[]})});await assert.rejects(()=>vm.runInContext('loadProfileIndex()',c),/turned off/);
  c=make({},stored);await assert.rejects(()=>vm.runInContext('loadProfileIndex()',c),/No search source could be read/);

  // Adding checks that the repository exists and has profiles; saving keeps the list on the phone.
  c=make(routes);
  const added=await vm.runInContext(`fetchSource(parseSourceSpec({repo:'a/b',folder:'Remotes',layout:'category'}).source)`,c);
  assert.deepEqual([added.source.branch,added.entries.length],['trunk',1]);
  vm.runInContext(`saveProfileSources([...profileSources(),{...parseSourceSpec({repo:'a/b',folder:'Remotes',layout:'category'}).source,enabled:true}])`,c);
  assert.deepEqual(listed(c).map(x=>x.id),['builtin','a/b||remotes']);
  vm.runInContext(`{const l=profileSources();l[0].enabled=false;saveProfileSources(l);}`,c);
  assert.deepEqual(listed(c).map(x=>x.enabled),[false,true],'the built-in source can be turned off and the choice is kept');
  assert.equal(JSON.parse(c.store.get('harmony-sources')).custom[0].branch,'','the default branch is looked up each time, not frozen');
  await assert.rejects(()=>vm.runInContext(`fetchSource({repo:'x/y',branch:'main'})`,make({})),/branch was not found/);
}

// The Search sources panel in the wizard: list, turn on/off, remove, add (with the repository checked first).
{
  const pure=source.slice(source.indexOf('const profileNorm='),source.indexOf('let profileIndex,'));
  const loader=source.slice(source.indexOf('let profileIndex,'),source.indexOf('function renderDraftLearn('));
  const store=new Map(),notices=[],fields={};
  const routes={'repos/o/r':[200,{default_branch:'main'}],'repos/o/r/git/trees/main?recursive=1':[200,{tree:[{type:'blob',path:'Sony/Bravia.ir'}]}],
    'repos/Lucaslhm/Flipper-IRDB/git/trees/main?recursive=1':[200,{tree:[{type:'blob',path:'TVs/Sony/Sony_X90.ir'}]}],'repos/o/empty':[200,{default_branch:'main'}],'repos/o/empty/git/trees/main?recursive=1':[200,{tree:[{type:'blob',path:'README.md'}]}]};
  const context=vm.createContext({state:{draft:null,editor:null},readLocal:(k,f='')=>store.get(k)||f,writeLocal:(k,v)=>store.set(k,v),AbortSignal,Error,JSON,escape:String,
    field:(label,id)=>`<input id="${id}">`,setupProgress:()=>'',returnToDevice(){},window:{scrollTo(){}},
    mount:html=>{context.html=html;},$:id=>fields[id]||(fields[id]={value:'',textContent:'',hidden:false,isConnected:true,focus(){}}),
    busy:async(button,label,task)=>{try{await task();}catch(error){notices.push({m:error.message,e:true});}},notice:(m,e)=>notices.push({m,e:!!e}),
    fetch:async url=>{const hit=Object.entries(routes).find(([key])=>url.endsWith(key));if(!hit)return {ok:false,status:404,json:async()=>({})};return {ok:true,status:hit[1][0],json:async()=>hit[1][1]};}});
  vm.runInContext(pure+loader,context);
  vm.runInContext('renderSearch()',context);
  const body=context.$('sources-body');
  assert.match(context.html,/<details id="sources" class="sources"><summary>Search sources<\/summary>/);
  assert.match(body.innerHTML,/Flipper-IRDB<\/strong>/);assert.match(body.innerHTML,/data-source-on="0" checked/);assert.doesNotMatch(body.innerHTML,/data-source-remove/,'the built-in source cannot be removed');
  assert.match(body.innerHTML,/belong to their owners/);assert.match(body.innerHTML,/id="source-form"/);
  const submit=async (repo,extra={})=>{context.$('source-repo').value=repo;context.$('source-branch').value=extra.branch||'';context.$('source-folder').value=extra.folder||'';context.$('source-layout').value=extra.layout||'brand';
    await body.onsubmit({preventDefault(){},submitter:{}});};
  await submit('nonsense');assert.match(notices.at(-1).m,/owner\/name/);
  await submit('o/missing');assert.match(notices.at(-1).m,/not found/);
  await submit('o/empty');assert.match(notices.at(-1).m,/No profile files were found in that repository/);
  assert.equal(store.has('harmony-sources'),false,'nothing is saved for a source that failed');
  await submit('o/r');assert.match(notices.at(-1).m,/Added o\/r: 1 profile file\./);
  assert.match(body.innerHTML,/o\/r<\/strong>/);assert.match(body.innerHTML,/data-source-remove="1"/);assert.match(body.innerHTML,/Brand\/Model/);
  await submit('O/R');assert.match(notices.at(-1).m,/already in the list/,'the same repository is not added twice');
  // Turn the built-in source off, then back on; remove the added one.
  body.onchange({target:{closest:sel=>sel==='[data-source-on]'?{dataset:{sourceOn:'0'},checked:false}:null}});
  assert.equal(JSON.parse(store.get('harmony-sources')).builtinOff,true);assert.doesNotMatch(body.innerHTML,/data-source-on="0" checked/);
  body.onchange({target:{closest:sel=>sel==='[data-source-on]'?{dataset:{sourceOn:'0'},checked:true}:null}});assert.equal(JSON.parse(store.get('harmony-sources')).builtinOff,false);
  body.onclick({target:{closest:sel=>sel==='[data-source-remove]'?{dataset:{sourceRemove:'1'}}:null}});
  assert.deepEqual(JSON.parse(store.get('harmony-sources')).custom,[]);assert.doesNotMatch(body.innerHTML,/data-source-remove/);
  // At the limit the form gives way to a note.
  for(let i=1;i<=5;i++){routes[`repos/o/r${i}`]=[200,{default_branch:'main'}];routes[`repos/o/r${i}/git/trees/main?recursive=1`]=[200,{tree:[{type:'blob',path:'A/B.ir'}]}];await submit('o/r'+i);}
  assert.doesNotMatch(body.innerHTML,/id="source-form"/);assert.match(body.innerHTML,/You can have 5 sources of your own/);
}
// The activity editor offers the volume-device choice only when there is something to choose.
{
  const code=source.slice(source.indexOf('function volumeChoiceHtml('),source.indexOf('function renderActivityEditor('));
  const dev=(id,names)=>({id,name:id.toUpperCase(),commands:names.map(name=>({name}))});
  const context=vm.createContext({escape:String,state:{devices:[dev('tv',['VolumeUp','VolumeDown','Mute']),dev('bar',['VolUp','VolDn']),dev('box',['Play']),dev('lamp',['VOL+'])]},matchCommand:(commands,aliases)=>aliases.map(a=>commands.find(c=>vm.runInContext('norm',context)(c.name)===a)).find(Boolean),
    norm:name=>String(name).toLowerCase().replace(/\+/g,'up').replace(/-\s*$/,'down').replace(/[^a-z0-9]/g,'')});
  vm.runInContext(code,context);
  const html=value=>vm.runInContext(`volumeChoiceHtml(${JSON.stringify(value)})`,context);
  const step=id=>({deviceId:id});
  const two={steps:[step('tv'),step('bar'),step('tv')],exitSteps:[]};
  assert.match(html(two),/<option value="">Automatic/);assert.match(html(two),/<option value="tv" >TV<\/option><option value="bar" >BAR<\/option>/,'each device with volume once, in step order');
  assert.match(html({...two,volumeDeviceId:'bar'}),/<option value="bar" selected>BAR<\/option>/,'the saved choice is selected');
  assert.equal(html({steps:[step('tv'),step('box')]}),'','one device with volume: nothing to choose');
  assert.equal(html({steps:[step('box')]}),'');
  assert.doesNotMatch(html({steps:[step('tv'),step('box'),step('lamp')]}),/value="box"/,'a device with no volume is not offered');
  assert.match(html({steps:[step('tv'),step('box'),step('lamp')]}),/value="lamp"/);
  // A choice that no longer fits is dropped and the editor says so.
  const stale={steps:[step('tv'),step('box')],volumeDeviceId:'bar'};
  context.value=stale;const out=vm.runInContext('volumeChoiceHtml(value)',context);
  assert.match(out,/no longer in this activity/);assert.equal(vm.runInContext('value.volumeDeviceId',context),undefined);
}
console.log('Search sources: spec checks, folder and format filtering, layouts, merging, duplicates, per-source failures and phone storage passed');

// A Roku is a kind of device: Add device offers it next to Infrared and Bluetooth and hands over to the Roku screen.
{
  const code=source.slice(source.indexOf('const ROKU_SCREEN'),source.indexOf('function profilePayload('));
  const fields={transport:{value:'ir'},'draft-learn':{}},assigned=[];
  const context=vm.createContext({state:{draft:{}},profileTitle:p=>p,$:id=>fields[id]||(fields[id]={}),escape:String,icon:()=>'',mount:html=>{context.html=html;},setupProgress:()=>'',
    location:{assign:url=>assigned.push(url)},window:{scrollTo(){}},field:()=>'',deviceTypeOptions:()=>'',busy(){},notice(){}});
  vm.runInContext(code+'\nrenderProfileChoice();',context);
  assert.match(context.html,/<option value="roku">Roku \(on your network\)<\/option>/,'Add device offers Roku');
  fields.transport.value='roku';fields.transport.onchange();
  assert.deepEqual(assigned,['/go/#/roku'],'choosing it opens the Roku screen');
  fields.transport.value='ir';fields.transport.onchange();assert.equal(assigned.length,1,'Infrared stays on this screen');
  // The list of devices lets the owner manage a Roku from its edit button.
  assert.match(source,/data-action="'\+\(d\.transport==='roku'\?'edit-roku':'edit-device'\)/);
  assert.match(source,/action==='edit-roku'\)location\.assign\(ROKU_SCREEN\)/);
  // After "Try another profile" a newly chosen profile does not overwrite what the user entered.
  context.state.draft={flow:'profile',detailsLocked:true,manufacturer:'Vizio',model:'M55-C2',type:'Television',nameInput:'Den TV',profilePath:'TVs/Vizio/Vizio.ir'};
  vm.runInContext("chooseProfile('text','TVs/Vizio/Vizio_D43-C1.ir','flipper',()=>{},{brand:'Vizio',model:'D43-C1',deviceType:'Television'})",context);
  assert.deepEqual([context.state.draft.manufacturer,context.state.draft.model,context.state.draft.nameInput,context.state.draft.profilePath],['Vizio','M55-C2','Den TV','TVs/Vizio/Vizio_D43-C1.ir'],'the details stay, the profile changes');
  assert.equal(context.state.draft.pending.path,'TVs/Vizio/Vizio_D43-C1.ir');
  context.state.draft={flow:'profile',manufacturer:'Vizio',model:'M55-C2',type:'Television',profilePath:'TVs/Vizio/Vizio.ir'};
  vm.runInContext("chooseProfile('text','TVs/Vizio/Vizio_D43-C1.ir','flipper',()=>{},{brand:'Vizio',model:'D43-C1',deviceType:'Television'})",context);
  assert.equal(context.state.draft.model,'D43-C1','without a retry a new profile still fills the details in');
  console.log('Add device offers Roku, and a Roku in the device list opens its screen');
}
// "Try another profile": only for the device just made, only while no activity uses it, and it keeps what was entered.
{
  const code=source.slice(source.indexOf('function deviceInUse('),source.indexOf('function updateLearnSave('));
  const calls=[],searches=[],notices=[];
  const mk=(config,retry)=>{
    const context=vm.createContext({state:{config,retry,devices:[{id:'7',name:'Den TV',transport:'ir'}],editor:{id:'7'},draft:null},
      mount:html=>{context.html=html;},$:id=>(context.fields||={})[id]||(context.fields[id]={}),escape:String,
      busy:async(button,label,fn)=>fn(),mutate:async(path,body)=>{calls.push({path,...body});},loadDevices:async()=>{},
      renderSearch:again=>searches.push(again),renderDeviceEditor(){},notice:(m,e)=>notices.push({m,e:!!e})});
    vm.runInContext(code,context);return context;
  };
  const retry={deviceId:'7',tried:['TVs/Vizio/Vizio.ir'],details:{nameInput:'Den TV',name:'Den TV',manufacturer:'Vizio',model:'M55-C2',type:'Television',typeKnown:false}};
  const device={id:'7',name:'Den TV',transport:'ir'};
  let c=mk({activities:[]},structuredClone(retry));
  assert.equal(vm.runInContext('retryAvailable({id:"7"})',c),true);
  assert.equal(vm.runInContext('retryAvailable({id:"8"})',c),false,'only the device just made');
  for(const [what,activity] of [['a start step',{steps:[{deviceId:'7'}]}],['an exit step',{exitSteps:[{deviceId:'7'}]}],['a button on its remote',{screen:{cells:[{deviceId:'7',command:'Up'}]}}],['its fixed row',{screen:{pinned:[{deviceId:'7',command:'Up'}]}}]]) {
    c=mk({activities:[activity]},structuredClone(retry));
    assert.equal(vm.runInContext('retryAvailable({id:"7"})',c),false,'not offered when an activity uses it as '+what);
    await assert.rejects(()=>vm.runInContext('tryAnotherProfile({id:"7"})',c),/activity uses this device/);
  }
  assert.equal(calls.length,0,'nothing is deleted when it is in use');
  c=mk({activities:[]},structuredClone(retry));
  await vm.runInContext('tryAnotherProfile({id:"7",transport:"ir"})',c);
  assert.deepEqual(calls,[{path:'devices',action:'delete',deviceId:'7',transport:'ir'}],'the unused device is removed');
  assert.deepEqual(JSON.parse(JSON.stringify(c.state.draft)),{flow:'profile',detailsLocked:true,...retry.details},'what was entered is kept for the next profile');
  assert.deepEqual(JSON.parse(JSON.stringify(c.state.retry)),{deviceId:null,tried:['TVs/Vizio/Vizio.ir'],details:retry.details},'the tried profiles are remembered');
  assert.deepEqual(searches,[true],'back to the same search, run again');assert.match(notices.at(-1).m,/Choose another profile/);
  await assert.rejects(()=>vm.runInContext('tryAnotherProfile({id:"7"})',c),/not just created/,'it cannot be done twice');
  c=mk({activities:[]},structuredClone(retry));vm.runInContext('renderTestFailed({id:"7",name:"Den <TV>"})',c);
  assert.match(c.html,/No response from Den &lt;TV&gt;|No response from Den <TV>/);assert.match(c.html,/id="try-another"/);assert.match(c.html,/id="keep-device"/);
  console.log('Try another profile: offered only for a new, unused device, it removes it and keeps the details and the tried profiles');
}
const setupCode=source.slice(source.indexOf('function renderSetupReview()'),source.indexOf('function renderDeviceTest('));
for(const failRefresh of [false,true]){
  const saveCalls=[],fields={'setup-review-back':{},'content':{querySelectorAll:()=>[]},'setup-review':{}};
  const setupState={config:{revision:7},devices:[{id:'2'}],draft:{name:'Receiver',nameInput:'Receiver',manufacturer:'Pioneer',model:'VSX-LX52',type:'Audio',typeKnown:true,flow:'profile',profilePath:'Audio/Pioneer/VSX.ir',commands:[{name:'VOL+'}],layout:[],source:'candidate.ir'},retry:{deviceId:'old',tried:['Audio/Pioneer/Older.ir']}};
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
  assert.deepEqual(JSON.parse(JSON.stringify(setupState.retry)),{deviceId:'2',tried:['Audio/Pioneer/Older.ir','Audio/Pioneer/VSX.ir'],details:{nameInput:'Receiver',name:'Receiver',manufacturer:'Pioneer',model:'VSX-LX52',type:'Audio',typeKnown:true}},'what "Try another profile" needs is kept, with every profile tried so far');
  assert.ok(!saveCalls.some(c=>c.path==='commands/send'),'saving never transmits');
}
console.log('Single-save setup, double-submit suppression and refresh-failure handling passed');
