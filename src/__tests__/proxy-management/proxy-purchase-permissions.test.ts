import {beforeEach,expect,it,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import {encrypt} from '@/lib/encryption';
import {createProxyBatchService} from '@/server/proxy-management/batches';
const mocks=vi.hoisted(()=>({load:vi.fn()}));
vi.mock('@/server/permissions/infrastructure',async importOriginal=>({...await importOriginal<typeof import('@/server/permissions/infrastructure')>(),loadInfrastructureScope:mocks.load}));
const scope={userId:'importer',projectId:'p',role:'MODERATOR' as const,capabilities:['PROXY_IMPORT'],allowedModules:['INFRASTRUCTURE'],businessMode:'PROXY_VM',teamCashEnabled:true};
const input={kind:'NEW' as const,text:'192.0.2.30:80:u:secret',purchase:{purchasedAt:'2026-10-25',priceMode:'UNIT' as const,amount:'25000',currency:'VND' as const,rate:'25000'},idempotencyKey:'purchase-key'};
beforeEach(()=>{vi.clearAllMocks();mocks.load.mockResolvedValue(scope);});
it('refuses purchase preview without COSTS write rights before refresh or saving any batch',async()=>{
 const db={proxyBatch:{findUnique:vi.fn(async()=>null)}} as unknown as PrismaClient,refresh=vi.fn(async()=>({id:'s',sourceKey:'GENJY',hash:'h',fetchedAt:new Date().toISOString(),scanSucceeded:true}));
 await expect(createProxyBatchService(db,{refreshSource:refresh}).preview(scope,input)).rejects.toMatchObject({code:'FORBIDDEN'});expect(refresh).not.toHaveBeenCalled();expect(db.proxyBatch.findUnique).not.toHaveBeenCalled();
});
it('rechecks COSTS rights before an APPLIED result is replayed after permissions were removed',async()=>{
 const original={id:'batch',projectId:'p',actorId:'importer',kind:'NEW',status:'APPLIED',idempotencyKey:input.idempotencyKey,encryptedPlan:encrypt(JSON.stringify({input,rows:[],items:[]})),result:{costId:'cost',amount:'25000',applied:1},expiresAt:new Date(Date.now()+60000)};
 const db={proxyBatch:{findFirst:vi.fn(async({where})=>where.kind?null:original)},operationJournal:{findUnique:vi.fn(async()=>null)}};
 await expect(createProxyBatchService(db as unknown as PrismaClient).commit(scope,'token',input.idempotencyKey)).rejects.toMatchObject({code:'FORBIDDEN'});expect(db.operationJournal.findUnique).not.toHaveBeenCalled();
});
