import test from 'node:test';
import assert from 'node:assert/strict';
import './support.mjs';
const mod=await import('../.work/engine/native-monitor-guest-transport.mjs').catch(()=>({}));
test('guestcontrol timeout prevents even readiness/internal helper retries from launching another guest command; inventory remains available',async()=>{assert.equal(typeof mod.createCanaryGuestTransport,'function');let calls=0;const vbox=mod.createCanaryGuestTransport(async args=>{calls++;return args[0]==='guestcontrol'?{code:20,out:'',err:'',guestControlRun:true}:{code:0,out:''};});await vbox(['guestcontrol','vm','run'],1);await vbox(['guestcontrol','vm','run'],1);assert.equal(calls,1);assert.equal(vbox.guestCleanupUnverified,true);await vbox(['list','vms','-l'],1);assert.equal(calls,2);});
