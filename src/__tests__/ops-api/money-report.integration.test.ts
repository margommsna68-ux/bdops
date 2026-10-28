import {afterAll,it,expect} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {businessDB as db,businessFixture} from '../proxy-management/business-fixture';
import {hashToken} from '@/server/ops-api/tokens';
import {api} from './ops-fixture';
afterAll(()=>db.$disconnect());
it('GET money-report answers the 24 h grouped report for a token with money rights and refuses without READ',async()=>{
 const f=await businessFixture(),token='mth_'+randomBytes(32).toString('base64url');
 try{
  await db.user.updateMany({where:{id:f.scope.userId},data:{password:'fixture-only-no-login'}});
  await db.opsToken.create({data:{userId:f.scope.userId,name:'fixture-money-report',prefix:randomUUID(),tokenHash:hashToken(token),projectIds:[f.scope.projectId],scopes:['READ'],expiresAt:new Date(Date.now()+3600000),createdById:f.scope.userId}});
  const r=await api('GET','money-report?projectId='+f.scope.projectId,{token});
  expect(r.status).toBe(200);expect(r.json.data).toMatchObject({hours:24,totals:{active:expect.any(Number),flat:0,decreased:0}});
  expect(Array.isArray(r.json.data.servers)).toBe(true);
  expect(Date.parse(r.json.data.generatedAt)-Date.parse(r.json.data.windowStart)).toBe(24*3600e3);
  expect((await api('GET','money-report?projectId='+f.scope.projectId,{token:null})).status).toBe(401);
 }finally{await db.opsAudit.deleteMany({where:{projectId:f.scope.projectId}});await db.opsToken.deleteMany({where:{userId:f.scope.userId}});await f.cleanup();}
});
