import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../src/api.mjs';

test('parallel browser slots serialize API requests without cancelling a queued peer',async()=>{
 let active=0,peak=0,release;const entered=[];
 const api=new ApiClient({baseUrl:'https://worker.example',token:'private-token',transport:async(url,options)=>{
  active++;peak=Math.max(peak,active);const n=entered.push(JSON.parse(options.body));
  if(n===1)await new Promise(resolve=>{release=resolve;});active--;
  return {status:200,json:async()=>({ok:true,error:null,data:{workerId:'worker',enabled:true}})};
 }});
 const first=api.call('heartbeat',{state:'IDLE'}),stop=new AbortController();
 const aborted=api.call('heartbeat',{state:'BUSY'},{signal:stop.signal});const rejection=assert.rejects(aborted,/API_CANCELLED/);
 const third=api.call('heartbeat',{state:'IDLE'});await new Promise(r=>setTimeout(r,10));stop.abort();
 try{await new Promise(r=>setTimeout(r,10));assert.equal(entered.length,1);assert.equal(peak,1);}finally{release?.();}
 await Promise.all([first,rejection,third]);assert.equal(entered.length,2);
});

test('only dedicated POST actions carry the bearer and redirects are refused', async () => {
  const calls=[];
  const api=new ApiClient({baseUrl:'https://worker.example',token:'private-token',transport:async (url,options)=>{
    calls.push({url,options}); return {status:200,json:async()=>({ok:true,data:{workerId:'w',enabled:true},error:null})};
  }});
  assert.deepEqual(await api.call('heartbeat',{state:'IDLE'}),{workerId:'w',enabled:true});
  assert.equal(calls[0].url,'https://worker.example/api/apple-check/v1/heartbeat');
  assert.equal(calls[0].options.method,'POST'); assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.headers.Authorization,'Bearer private-token');
  await assert.rejects(api.call('../ops',{}),/ACTION/);
  assert.equal(calls.length,1);
});
test('rejects non-origin URLs and malformed, redirected, or secret-bearing errors',async()=>{
  for(const baseUrl of ['http://example.com','https://u:p@example.com','https://example.com/api','https://example.com/?x=1','https://example.com/#x'])
    assert.throws(()=>new ApiClient({baseUrl,token:'x'}),/ORIGIN/);
  for(const response of [
    {status:302,redirected:false,json:async()=>({})},
    {status:200,redirected:true,json:async()=>({})},
    {status:200,json:async()=>({ok:true,data:{enabled:'yes'}})},
    {status:401,json:async()=>({ok:false,error:{message:'password-secret'}})},
  ]){
    const api=new ApiClient({baseUrl:'https://example.com',token:'x',transport:async()=>response});
    await assert.rejects(api.call('heartbeat',{state:'IDLE'}),e=>!e.message.includes('password-secret'));
  }
});
test('transport errors are sanitized and bounded',async()=>{
  const api=new ApiClient({baseUrl:'https://example.com',token:'x',timeoutMs:20,transport:async()=>{throw new Error('email password proxy');}});
  await assert.rejects(api.call('claim',{}),/API_NETWORK/);
});
test('deadline bounds a hung transport even if it ignores AbortSignal',async()=>{
  const api=new ApiClient({baseUrl:'https://example.com',token:'x',timeoutMs:10,transport:async()=>new Promise(()=>{})});
  await assert.rejects(api.call('claim',{key:'claim-key'}),/API_TIMEOUT/);
});
test('response URL must remain the exact dedicated action',async()=>{
  const api=new ApiClient({baseUrl:'https://example.com',token:'x',transport:async()=>({status:200,url:'https://other.test/api/apple-check/v1/heartbeat',json:async()=>({ok:true,data:{workerId:'w',enabled:true}})})});
  await assert.rejects(api.call('heartbeat',{state:'IDLE'}),/API_ORIGIN/);
});
