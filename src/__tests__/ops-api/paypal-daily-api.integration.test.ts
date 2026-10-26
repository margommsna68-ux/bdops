import {afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {api,db,setup,prepareBody} from './ops-fixture';
import {expectConforms} from './openapi-conform';

afterAll(()=>db.$disconnect());
it('web and API share daily reservations, schema and stable same-key replay',async()=>{
 const f=await setup();try{
  const token=await f.token(f.ai,['READ','PAYOUT']),pp=await f.pp('pp-82');
  const key=randomUUID(),body=await prepareBody(f,0,pp.emails[0].id);
  const first=await api('POST','withdrawals/prepare',{token,key,body});expect(first.status).toBe(200);
  expect((await api('POST','withdrawals/prepare',{token,body:await prepareBody(f,1,pp.emails[1].id)})).status).toBe(200);
  const blocked=await api('POST','withdrawals/prepare',{token,body:await prepareBody(f,2,pp.emails[2].id)});
  expect(blocked.status).toBe(409);expect(blocked.json.error).toMatchObject({code:'PAYPAL_DAILY_LIMIT',details:{limit:2,reserved:2,remaining:0,timeZone:'Asia/Ho_Chi_Minh'}});
  const again=await api('POST','withdrawals/prepare',{token,key,body});expect(again.status).toBe(200);expect(again.json.data.replay).toBe(true);expect(again.json.data.recorded).toEqual(first.json.data.recorded);
  const v=await f.vmNow(2),suggest=await api('GET',`paypal/suggest?projectId=${f.projectId}&earnAppAccountId=${v.earnAppId}&amount=10&currency=USD`,{token});
  expect(suggest.status).toBe(200);expect(suggest.json.data.candidates.find((p:{paypalId:string})=>p.paypalId===pp.id)).toMatchObject({usable:false,daily:{remaining:0}});
  expectConforms('GET','paypal/suggest',suggest);expectConforms('POST','withdrawals/prepare',blocked);
  const other=await f.pp('pp-60');expect((await api('POST','withdrawals/prepare',{token,body:await prepareBody(f,2,other.emails[0].id)})).status).toBe(200);
  expect(await db.fundTransaction.count({where:{projectId:f.projectId}})).toBe(0);
 }finally{await f.cleanup();}
});
