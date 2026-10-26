import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import './support.mjs';
const {makeVbox}=await import('../.work/engine/vbox.mjs');
test('opt-in VBox timeout kills but retains promise until close, preserving one real guest slot',async()=>{let child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();let killed=false;child.kill=()=>{killed=true;};let settled=false;const call=makeVbox('fixture','',{awaitCloseOnTimeout:true,spawnProcess:()=>child})(['guestcontrol','uuid','run'],5).then(r=>{settled=true;return r;});await new Promise(r=>setTimeout(r,15));assert.equal(killed,true);assert.equal(settled,false);child.emit('close',null);const r=await call;assert.equal(r.timedOut,true);});
