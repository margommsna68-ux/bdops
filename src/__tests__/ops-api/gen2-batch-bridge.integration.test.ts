import {afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';import bcrypt from 'bcryptjs';
import {businessDB as db,businessFixture} from '../proxy-management/business-fixture';
import {createOpsToken} from '@/server/ops-api/tokens';import {handleOpsRequest} from '@/server/ops-api/api';
import {Bridge} from '../../../scripts/gen2-dashboard/bridge.mjs';
import {createApi} from '../../../scripts/gen2-dashboard/io.mjs';
afterAll(()=>db.$disconnect());
it('real batch service accepts bridge records and replays after a committed response is lost',async()=>{
 const f=await businessFixture(),projectId=f.scope.projectId;
 try{
 await db.user.update({where:{id:f.worker.userId},data:{password:await bcrypt.hash('Synthetic bridge fixture only',4)}});
 const vm2=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_002',managed:true,proxySlotState:'BLANK'}});
 const machines=[f.vm,vm2],uuids=machines.map(()=>randomUUID());
 for(const [n,v] of machines.entries())await db.virtualMachine.update({where:{id:v.id},data:{notes:'UUID máy: '+uuids[n],createdAt:new Date(Date.now()-3600000)}});
 const token=await createOpsToken(f.scope.userId,{projectId,userId:f.worker.userId,name:'Synthetic bridge integration',scopes:['READ','VM_OPS'],expiresInDays:30,pin:'123456'},db);
 let lost=false;const posted:string[]=[];
 const api=createApi({token:token.token!, sleep:async()=>{},fetchImpl:async(input,init)=>{
 const request=input instanceof Request?new Request(input,init):new Request(String(input),init);
 const path=new URL(request.url).pathname.replace('/api/ops/v1/','');
 const r=await handleOpsRequest(request,path,db);
 if(request.method==='POST'){posted.push(String(request.headers.get('Idempotency-Key')));if(!lost){lost=true;throw Error('Synthetic response lost AFTER commit');}}
 return r;
 }});
 const observations=machines.map((v,n)=>({uuid:uuids[n],serverName:f.server.code,serverId:'source',vmCode:v.code,observedAt:new Date(Date.now()-1000).toISOString(),earning:null,problem:null,money:null}));
 const state={version:1,projectId,entries:{},pending:null};const saved:unknown[]=[];
 const bridge=new Bridge({state,projectId,api,batchSize:25,readCache:async()=>({observations}),persist:async(s:unknown)=>{saved.push(structuredClone(s));}});
 expect((await bridge.tick()).state).toBe('UNKNOWN');
 expect(await db.vmOpsEvent.count({where:{projectId,kind:'GEN2_SCAN'}})).toBe(2);
 expect((await bridge.tick()).saved).toBe(2);expect(posted).toHaveLength(2);expect(posted[0]).toBe(posted[1]);
 expect(await db.vmOpsEvent.count({where:{projectId,kind:'GEN2_SCAN'}})).toBe(2);
 expect(await db.fundTransaction.count({where:{projectId}})).toBe(0);expect(saved.length).toBeGreaterThan(2);
 }finally{await db.opsAudit.deleteMany({where:{projectId}});await db.opsBatchKey.deleteMany({where:{projectId}});await db.opsToken.deleteMany({where:{userId:{in:[f.scope.userId,f.worker.userId]}}});await f.cleanup();}
});
