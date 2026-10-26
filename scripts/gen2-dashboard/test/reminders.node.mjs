import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createReminderHook,saveReminderState} from '../reminders.mjs';

const HOUR=3600000,START=Date.parse('2026-10-26T01:00:00.000Z');
const item=(overrides={})=>({key:'project:package:2026-10-29T00:00:00.000Z',packageCode:'GEN-100',dueAt:'2026-10-29T00:00:00.000Z',daysLeft:3,amount:'12.3456',currency:'USD_PAYPAL',link:'/infrastructure/proxies?package=GEN-100',...overrides});
test('dead notification owner recovers without resending an uncertain delivery',async t=>{
 const h=await setup(t,{fetchImpl:async()=>{throw Error('lost');}});await h.hook();h.advance();
 const dir=path.join(h.dir,'state','notification-lock');await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,'bridge.lock'),JSON.stringify({pid:123456789,startedAt:new Date(START).toISOString()}));
 t.mock.method(process,'kill',()=>{throw Object.assign(Error('gone'),{code:'ESRCH'});});
 const result=await createReminderHook(h.options)();assert.equal(result.polled,true);assert.equal(result.unknown,1);assert.equal(result.sent,0);
});
async function setup(t,overrides={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mth-reminders-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let now=START,items=[item()];const requests=[],polls=[],writes=[];
 const options={projectId:'project',machineRoot:path.join(dir,'machine'),stateDir:path.join(dir,'state'),now:()=>now,
  api:{get:async route=>{polls.push(route);return {items};}},readToken:async()=>'SYNTHETIC_LOCAL_TOKEN',
  fetchImpl:async(url,init)=>{requests.push({url,init});writes.push(JSON.parse(await fs.readFile(path.join(dir,'state','reminders.json'),'utf8')));return new Response('{"ok":true}',{status:200});},...overrides};
 return {dir,options,hook:createReminderHook(options),requests,polls,writes,advance:(ms=HOUR)=>{now+=ms;},setItems:v=>{items=v;},state:async()=>JSON.parse(await fs.readFile(path.join(dir,'state','reminders.json'),'utf8'))};
}
test('afterSync persists UNKNOWN before fixed loopback POST, then DONE; only safe facts enter state and summary',async t=>{
 const h=await setup(t),result=await h.hook({projectId:'project'});
 assert.equal(result.sent,1);assert.equal(result.state,'DONE');assert.deepEqual(h.polls,['/gen2-reminders?projectId=project']);
 assert.equal(h.requests[0].url,'http://127.0.0.1:8768/notify');const init=h.requests[0].init;
 assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer SYNTHETIC_LOCAL_TOKEN');assert.ok(init.signal);
 const body=JSON.parse(init.body);assert.equal(body.server,'central');assert.equal(body.kind,'ALERT');assert.match(body.text,/\$12,35 PayPal/);assert.match(body.text,/Còn 3 ngày/);
 assert.match(body.text,/https:\/\/wow\.lalamail\.sbs\/infrastructure\/proxies/);
 assert.equal(h.writes[0].entries[item().key].status,'UNKNOWN');assert.equal((await h.state()).entries[item().key].status,'DONE');
 const durable=JSON.stringify(await h.state());assert.doesNotMatch(durable,/SYNTHETIC|Authorization|GEN-100|amount|currency|text|link/);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC|GEN-100/);
});
test('hourly poll throttle survives restart, due-key duplicates stay done, and a new due date is eligible',async t=>{
 const h=await setup(t);await h.hook();h.advance(HOUR-1);await createReminderHook(h.options)();assert.equal(h.polls.length,1);
 h.advance(1);await createReminderHook(h.options)();assert.equal(h.polls.length,2);assert.equal(h.requests.length,1);
 const dueAt='2026-11-01T00:00:00.000Z';h.setItems([item({dueAt,key:'project:package:'+dueAt})]);h.advance();await h.hook();assert.equal(h.requests.length,2);
});
for(const outcome of ['timeout','bad-json','false-ok','redirect','accepted','server-error','wrong-origin'])test(`${outcome} remains UNKNOWN across restart and is never auto-resent`,async t=>{
 let calls=0;const h=await setup(t,{fetchImpl:async()=>{calls++;if(outcome==='timeout')throw new Error('SYNTHETIC_LOCAL_TOKEN');
  if(outcome==='wrong-origin')return {status:200,redirected:true,url:'https://evil.invalid/notify',json:async()=>({ok:true})};
  return new Response(outcome==='bad-json'?'bad':JSON.stringify({ok:outcome!=='false-ok'}),{status:outcome==='redirect'?302:outcome==='accepted'?202:outcome==='server-error'?500:200});}});
 const result=await h.hook();assert.equal(result.state,'UNKNOWN');assert.equal((await h.state()).entries[item().key].status,'UNKNOWN');
 h.advance();await createReminderHook(h.options)();assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC/);
});
test('failed durable write before notification prevents all sends',async t=>{
 const h=await setup(t,{persist:async()=>{throw new Error('disk secret');}});const result=await h.hook();assert.equal(result.state,'STATE_UNAVAILABLE');assert.equal(h.requests.length,0);assert.equal(h.polls.length,0);
});
test('a failed UNKNOWN write prevents the notification, even after a successful hourly checkpoint',async t=>{
 const h=await setup(t);h.options.persist=async state=>{if(Object.keys(state.entries).length)throw new Error('disk full');await saveReminderState(h.options.stateDir,state);};
 const result=await createReminderHook(h.options)();assert.equal(result.state,'STATE_UNAVAILABLE');assert.equal(h.requests.length,0);assert.deepEqual((await h.state()).entries,{});
});
test('an acknowledgement commit failure leaves durable UNKNOWN and never repeats the delivered notification',async t=>{
 const h=await setup(t);h.options.persist=async state=>{if(Object.values(state.entries).some(e=>e.status==='DONE'))throw new Error('disk full');await saveReminderState(h.options.stateDir,state);};
 const result=await createReminderHook(h.options)();assert.equal(result.state,'STATE_UNAVAILABLE');assert.equal(result.unknown,1);assert.equal(h.requests.length,1);
 assert.equal((await h.state()).entries[item().key].status,'UNKNOWN');h.advance();await createReminderHook(h.options)();assert.equal(h.requests.length,1);
});
test('reads only the existing machine local-port token and never writes it into notification text or state',async t=>{
 const h=await setup(t);delete h.options.readToken;const tokenDir=path.join(h.options.machineRoot,'data','local-port');
 await fs.mkdir(tokenDir,{recursive:true});await fs.writeFile(path.join(tokenDir,'token'),'SYNTHETIC_FILE_TOKEN\r\n');
 await createReminderHook(h.options)();assert.equal(h.requests[0].init.headers.Authorization,'Bearer SYNTHETIC_FILE_TOKEN');
 assert.doesNotMatch(h.requests[0].init.body,/SYNTHETIC_FILE_TOKEN/);assert.doesNotMatch(JSON.stringify(await h.state()),/SYNTHETIC_FILE_TOKEN/);
});
test('missing local token has no send or delivery claim; malformed tokens are never used',async t=>{
 const h=await setup(t);delete h.options.readToken;assert.equal((await createReminderHook(h.options)()).state,'NOTIFY_UNAVAILABLE');
 assert.equal(h.requests.length,0);assert.deepEqual((await h.state()).entries,{});
 h.advance();h.options.readToken=async()=>'token\nAuthorization: another';assert.equal((await createReminderHook(h.options)()).state,'NOTIFY_UNAVAILABLE');assert.equal(h.requests.length,0);
});
test('missing COSTS uses xem web; no message earlier than three days; bad keys and foreign links refused',async t=>{
 const h=await setup(t);h.setItems([item({amount:null,currency:null}),item({key:'project:future:'+item().dueAt,daysLeft:4}),item({key:'other:package:'+item().dueAt}),item({key:'project:other:'+item().dueAt,link:'https://evil.invalid/'}),item({key:'project:bad-date:'+item().dueAt,dueAt:'2026-10-30T00:00:00.000Z'})]);
 const result=await h.hook();assert.equal(result.sent,1);assert.equal(result.rejected,3);assert.match(JSON.parse(h.requests[0].init.body).text,/Chi phí: xem web/);assert.doesNotMatch(JSON.parse(h.requests[0].init.body).text,/\$0/);
});
test('source outage is sanitized and throttled durably without sending',async t=>{
 let reads=0;const h=await setup(t,{api:{get:async()=>{reads++;throw new Error('SOURCE_TOKEN_PRIVATE');}}});
 const result=await h.hook();assert.equal(result.state,'SOURCE_UNAVAILABLE');h.advance(100);await createReminderHook(h.options)();assert.equal(reads,1);assert.equal(h.requests.length,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
test('corrupt or wrong-project state fails closed without resetting it or sending',async t=>{
 const h=await setup(t);await fs.mkdir(h.options.stateDir,{recursive:true});await fs.writeFile(path.join(h.options.stateDir,'reminders.json'),'{bad');
 assert.equal((await h.hook()).state,'STATE_UNAVAILABLE');assert.equal(h.polls.length,0);assert.equal(await fs.readFile(path.join(h.options.stateDir,'reminders.json'),'utf8'),'{bad');
 await fs.writeFile(path.join(h.options.stateDir,'reminders.json'),JSON.stringify({version:1,projectId:'other',lastPollAt:null,entries:{}}));
 assert.equal((await h.hook()).state,'STATE_UNAVAILABLE');assert.equal(h.requests.length,0);
});
test('duplicate due keys in one response send once; zero price is real; overdue uses the same due key',async t=>{
 const h=await setup(t);h.setItems([item({amount:'0',currency:'VND',daysLeft:0}),item({amount:'0',currency:'VND',daysLeft:0})]);
 const result=await h.hook();assert.equal(result.sent,1);assert.equal(result.skipped,1);assert.match(JSON.parse(h.requests[0].init.body).text,/Chi phí: 0 ₫/);
 h.advance();h.setItems([item({daysLeft:-1})]);await h.hook();assert.equal(h.requests.length,1);
 const files=await fs.readdir(h.options.stateDir);assert.deepEqual(files,['notification-lock','reminders.json']);
});
test('an unrelated project context cannot poll, and state cannot be put inside GEN2 machine data',async t=>{
 const h=await setup(t);assert.equal((await h.hook({projectId:'other'})).state,'PROJECT_MISMATCH');assert.equal(h.polls.length,0);
 assert.throws(()=>createReminderHook({...h.options,stateDir:path.join(h.options.machineRoot,'data','reminders')}),/STATE_INSIDE_GEN2/);
});
test('overlapping hooks sharing a project directory cannot notify twice',async t=>{
 let release,entered;const ready=new Promise(r=>{entered=r;});const wait=new Promise(r=>{release=r;});let sends=0;
 const h=await setup(t,{fetchImpl:async()=>{sends++;entered();await wait;return new Response('{"ok":true}');}});
 const first=h.hook();await Promise.race([ready,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('hook did not reach send')),1000);timer.unref();})]);
 assert.equal((await createReminderHook(h.options)()).state,'BUSY');release();await first;assert.equal(sends,1);
});
