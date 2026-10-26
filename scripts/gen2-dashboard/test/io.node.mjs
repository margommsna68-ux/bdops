import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../io.mjs';

test('reminders GET uses the fixed HTTPS origin and rejects alternate routes or redirects',async()=>{
 const calls=[];
 const api=createApi({token:'TEST_ONLY',fetchImpl:async(url,init)=>{
  calls.push({url,init});return new Response(JSON.stringify({ok:true,data:{items:[]}}),{status:200});
 }});
 assert.deepEqual(await api.get('/gen2-reminders?projectId=p'),{items:[]});
 assert.equal(calls[0].url,'https://wow.lalamail.sbs/api/ops/v1/gen2-reminders?projectId=p');
 assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.redirect,'error');
 await assert.rejects(()=>api.get('/gen2-reminders?projectId=p&redirect=https://other.invalid/'),/ENDPOINT_REFUSED/);
 await assert.rejects(()=>api.get('https://other.invalid/gen2-reminders?projectId=p'),/ENDPOINT_REFUSED/);
 await assert.rejects(()=>api.post('/gen2-reminders?projectId=p',{},'k'),/ENDPOINT_REFUSED/);
 assert.equal(calls.length,1);
});
