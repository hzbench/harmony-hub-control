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

const elements={};
const el=id=>elements[id]||=({id,dataset:{},hidden:false,textContent:'',innerHTML:'',title:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},focus(){},addEventListener(){},querySelectorAll:()=>[]});
const context=vm.createContext({document:{getElementById:el,title:''},window:{addEventListener(){},scrollTo(){}},location:{hash:'',replace(url){context.replaced=url;}},history:{replaceState(){}},
  localStorage:{},setTimeout:()=>0,clearTimeout(){},fetch:async()=>{throw new TypeError('offline');},AbortController,URL});
const inert=source.replace(/\n  boot\(\);\n\}\s*$/,'\n}');assert.notEqual(inert,source,'boot() auto-run not found');
vm.runInContext(inert.replace('const state =','var state =')+'\nthis.exports={parseRoute,routeHash,connection,state,needsFullUi,api,show,screens};',context);
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
