import assert from 'node:assert/strict';
import { catalog, makeState, reducer, visiblePlugins, isDirty, validationErrors } from './model.mjs';
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS: ' + name); }
const time = '2026-10-21T01:30:00.000Z';
const act = (s, type, extra = {}) => reducer(s, { type, time, ...extra });

test('initial catalog and default configs are independent', () => {
  const s = makeState();
  assert.equal(catalog.length, 6); assert.equal(Object.values(s.enabled).filter(Boolean).length, 5);
  assert.notEqual(s.drafts.rest, s.applied.rest); assert.notEqual(s.drafts.rest, catalog[0].defaults);
});
test('category and query are intersected', () => {
  assert.deepEqual(visiblePlugins(makeState({category:'health', query:'提醒'})).map(p=>p.id), ['rest','water','eye']);
  assert.deepEqual(visiblePlugins(makeState({category:'system', query:'Agent'})), []);
  assert.deepEqual(visiblePlugins(makeState({query:'  AGENT  '})).map(p=>p.id), ['agent']);
  assert.deepEqual(visiblePlugins(makeState({query:'衔接'})).map(p=>p.id), ['bt-music']);
});
test('filtering preserves current editing selection and draft', () => {
  let s = act(makeState(), 'edit', {field:'interval',value:'50'});
  s = act(s,'category',{value:'system'});
  assert.equal(s.selected,'rest'); assert.equal(s.drafts.rest.interval,'50');
  assert.equal(visiblePlugins(s).some(p=>p.id===s.selected),false);
});
test('row switch does not select another plugin or discard settings', () => {
  const s = act(makeState(),'enable',{id:'bt-music',value:true});
  assert.equal(s.selected,'rest'); assert.equal(s.enabled['bt-music'],true);
  assert.equal(Object.values(s.enabled).filter(Boolean).length,6);
  assert.equal(s.events[0].plugin,'bt-music');
});
test('master and detail use a single enable state; disabled plugins remain configurable', () => {
  let s=act(makeState(),'enable',{id:'rest',value:false});
  s=act(s,'edit',{field:'interval',value:'55'});
  s=act(s,'apply');
  assert.equal(s.enabled.rest,false); assert.equal(s.applied.rest.interval,'55');
  assert.equal(act(s,'preview'),s);
});
test('draft changes do not affect preview settings before apply', () => {
  const before=makeState(); const s=act(before,'edit',{field:'duration',value:'8'});
  assert.equal(s.applied.rest.duration,'5'); assert.equal(isDirty(s),true);
  assert.equal(before.drafts.rest.duration,'5');
});
test('valid apply updates only selected plugin and records local event', () => {
  let s=act(makeState(),'edit',{field:'interval',value:'90'});
  s=act(s,'apply');
  assert.equal(s.applied.rest.interval,'90'); assert.equal(isDirty(s),false);
  assert.equal(s.applied.water.interval,'60'); assert.equal(s.events[0].kind,'config');
});
test('invalid integer ranges block apply', () => {
  for(const value of ['', ' ', '0','-1','1.5','241','Infinity','NaN']) {
    let s=act(makeState(),'edit',{field:'interval',value});
    const invalid=s;
    s=act(s,'apply');
    assert.equal(s.applied.rest.interval,'45'); assert.equal(s.events.length,0);
    assert.equal(s.applied,invalid.applied); assert.ok(validationErrors(s.drafts.rest).interval);
  }
  assert.deepEqual(validationErrors({interval:'240',duration:'60'}),{});
  assert.ok(validationErrors({duration:'61'}).duration);
});
test('switching plugins preserves per-plugin drafts', () => {
  let s=act(makeState(),'edit',{field:'interval',value:'75'});
  s=act(s,'select',{id:'water'});
  assert.equal(s.drafts.water.interval,'60');
  s=act(s,'edit',{field:'interval',value:'80'});
  s=act(s,'select',{id:'rest'});
  assert.equal(s.drafts.rest.interval,'75'); assert.equal(s.drafts.water.interval,'80');
});
test('reset creates default draft without silently applying', () => {
  let s=act(makeState(),'edit',{field:'duration',value:'9'});
  s=act(s,'apply'); s=act(s,'reset');
  assert.equal(s.drafts.rest.duration,'5'); assert.equal(s.applied.rest.duration,'9');
  assert.equal(isDirty(s),true); s=act(s,'apply'); assert.equal(isDirty(s),false);
});
test('only enabled preview events count as simulated notifications', () => {
  let s=act(makeState(),'preview');
  assert.equal(s.events[0].kind,'preview');
  s=act(s,'select',{id:'bt-music'}); const before=s.events.length;
  s=act(s,'preview'); assert.equal(s.events.length,before);
  s=act(s,'ack',{id:'rest'}); assert.equal(s.events[0].plugin,'rest');
});
test('non-health plugins do not inherit reminder interval fields', () => {
  for(const id of ['timer','agent','bt-music']) assert.equal(makeState().drafts[id].interval,undefined);
});
test('mobile navigation and tabs are real state transitions', () => {
  let s=act(makeState(),'select',{id:'eye'}); assert.equal(s.mobileDetail,true);
  s=act(s,'back'); assert.equal(s.mobileDetail,false); assert.equal(s.selected,'eye');
  s=act(s,'tab',{value:'about'}); assert.equal(s.tab,'about');
});
console.log(`Passed ${checks} model tests.`);
