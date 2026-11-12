import test from 'node:test';
import assert from 'node:assert/strict';
import {initCoreState} from '../assets/core-state.js';
test('core states reflect events, priority, cancellation and page visibility',()=>{
 const element={dataset:{},classList:{toggle(k,v){element[k]=v;}}},doc={hidden:false,addEventListener(k,fn){this[k]=fn;}};
 const c=initCoreState(element,doc);assert.equal(element.dataset.state,'idle');
 const old={},current={};c.trackSpeech(old);old.onstart();assert.equal(element.dataset.state,'speaking');
 c.stopSpeech();c.trackSpeech(current);current.onstart();old.onend();assert.equal(element.dataset.state,'speaking');
 c.set('thinking',true);assert.equal(element.dataset.state,'thinking');c.set('listening',true);assert.equal(element.dataset.state,'listening');
 c.set('listening',false);c.set('thinking',false);current.onend();assert.equal(element.dataset.state,'idle');
 doc.hidden=true;doc.visibilitychange();assert.equal(element['core-paused'],true);
});
test('temporary error returns to actual underlying state',async()=>{
 const el={dataset:{},classList:{toggle(){}}},c=initCoreState(el,{hidden:false,addEventListener(){}});
 c.set('thinking',true);c.error();assert.equal(el.dataset.state,'error');await new Promise(r=>setTimeout(r,1450));assert.equal(el.dataset.state,'thinking');
});
