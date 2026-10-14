import {createHash,randomBytes} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {assertInfrastructureAction,loadInfrastructureScope,type InfrastructureAction} from '@/server/permissions/infrastructure';
import {fullProxy,parseProxyList,parseReplacementLists,resolvePair} from './parse';
import {decideBlock,decideNew,decideReplacement} from './policy';
import {matchPackage} from './catalog';
import {loadCatalog,loadProxyContext} from './repository';
import {refreshGenjy} from './sources';
import {buildReconciliation} from './reconcile';
import {withProxyTransaction} from './transaction';
import {recordOperation} from '../operation-history/journal';
import {captureEndpoint,endpointInclude,readImage,type ResourceImage} from '../operation-history/snapshot';
import {ProxyDomainError,type ActorScope,type BatchInput,type BatchPreview,type CatalogAccount,type CommitResult,type InventoryState,type Owner,type ParsedProxy,type PreviewRow,type ProxyContext,type ReconciliationPlan,type SheetSnapshot,type SourceSnapshotRef,type Subgroup} from './types';
export interface ResolvedItem {row:number;oldEndpointId?:string;next?:ParsedProxy;owner:Owner;subgroup:Subgroup;packageCode:string|null;state:InventoryState;sourceRef?:string;sourceSnapshotId?:string}
interface Planned {rows:PreviewRow[];items:ResolvedItem[];reconciliation?:ReconciliationPlan}
export function parseReceivedDate(value?:string|null):Date|null{
  if(!value) return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ProxyDomainError('INVALID_INPUT','Ngày nhận dùng YYYY-MM-DD');
  const date=new Date(value+'T00:00:00.000Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value) throw new ProxyDomainError('INVALID_INPUT','Ngày nhận không hợp lệ');return date;
}
function candidates(ctx:ProxyContext,p:ParsedProxy,projectId?:string){return ctx.endpoints.filter(e=>(!projectId||e.projectId===projectId)&&e.proxy.ip===p.ip&&(p.format==='BARE'||(e.proxy.format==='FULL'&&fullProxy(e.proxy)===fullProxy(p))));}
export function planBatch(input:BatchInput,ctx:ProxyContext,catalog:CatalogAccount[],projectId?:string,sheet?:SheetSnapshot):Planned{
  parseReceivedDate(input.receivedDate);
  const rows:PreviewRow[]=[],items:ResolvedItem[]=[];
  let reconciliation:ReconciliationPlan|undefined;
  const addNew=(row:number,p:ParsedProxy,owner:Owner,subgroup:Subgroup,state:InventoryState='NEW',sourceRef?:string)=>{
    const decision=decideNew(p,owner,ctx),code=matchPackage(p,catalog),resolvedState=code?state:'QUARANTINED';
    if(subgroup&&owner!=='GENJY') Object.assign(decision,{outcome:'ERROR',code:'OWNER_CONFLICT',message:'PC chung phải thuộc Genjy'});
    rows.push({...decision,row,newIp:p.ip,owner,subgroup,packageCode:code,sourceRefs:sourceRef?[sourceRef]:[],...(decision.outcome==='READY'&&!code?{code:'UNKNOWN_PACKAGE' as const,message:'Lưu để kiểm tra gói; chưa dùng để cấp VM'}:{})});
    if(decision.outcome==='READY') items.push({row,next:p,owner,subgroup,packageCode:code,state:resolvedState,sourceRef});
  };
  if(input.kind==='NEW') parseProxyList(input.text||'').forEach((p,i)=>addNew(i+1,p,input.owner||'SELF',input.subgroup||null));
  else if(input.kind==='BLOCKED') parseProxyList(input.text||'').forEach((p,i)=>{
    const found=candidates(ctx,p,projectId),decision=decideBlock(found),endpoint=found[0],identity=ctx.identities.find(v=>v.id===endpoint?.identityId);
    rows.push({...decision,row:i+1,oldIp:p.ip,endpointId:decision.outcome!=='ERROR'?endpoint?.id:undefined,owner:identity?.owner,sourceRefs:[]});
    if(decision.outcome==='READY') items.push({row:i+1,oldEndpointId:endpoint.id,owner:identity?.owner||'UNKNOWN',subgroup:identity?.subgroup||null,packageCode:null,state:'BLOCKED'});
  });
  else if(input.kind==='REPLACE') parseReplacementLists(input.removedText||input.text||'',input.addedText||'').forEach(pair=>{
    const found=candidates(ctx,pair.old,projectId),old=found[0]||null,identity=ctx.identities.find(i=>i.id===old?.identityId)||null;
    let next=pair.next;
    if(old&&old.proxy.format==='FULL') next=resolvePair(old.proxy,pair.next);
    const evidence=ctx.evidence.filter(e=>e.ip===next.ip);
    const exactReceiptReplay=!!old&&found.length===1&&next.format==='FULL'&&ctx.receipts.some(r=>r.status==='APPLIED'&&r.oldIp===pair.old.ip&&r.newIp===next.ip&&(!r.oldEndpointId||r.oldEndpointId===old.id)&&ctx.endpoints.some(e=>(!projectId||e.projectId===projectId)&&(!r.newEndpointId||e.id===r.newEndpointId)&&e.proxy.format==='FULL'&&fullProxy(e.proxy)===fullProxy(next)));
    const decision=decideReplacement({old,oldIdentity:identity,oldCandidates:found.length,next,nextEvidence:evidence,nextIdentities:ctx.identities.filter(i=>i.ip===next.ip),nextInInventory:ctx.endpoints.some(e=>e.proxy.ip===next.ip),nextInVmOrReservation:ctx.endpoints.some(e=>e.proxy.ip===next.ip&&e.vmKeys.length>0),nextHistory:ctx.history.filter(e=>e.ip===next.ip),exactReceiptReplay,sourceScanSucceeded:ctx.source.scanSucceeded});
    const packageCode=matchPackage(next,catalog);
    rows.push({...decision,row:pair.row,oldIp:pair.old.ip,newIp:next.ip,owner:identity?.owner,subgroup:identity?.subgroup,packageCode,endpointId:decision.outcome!=='ERROR'?old?.id:undefined,sourceRefs:evidence.map(e=>e.sourceRef),...(decision.outcome==='READY'&&!packageCode?{code:'UNKNOWN_PACKAGE' as const,message:'Nhận replace, cần xác định gói trước khi cấp VM'}:{})});
    if(decision.outcome==='READY'&&identity&&old) items.push({row:pair.row,oldEndpointId:old.id,next,owner:identity.owner,subgroup:identity.subgroup,packageCode,state:packageCode?'NEW':'QUARANTINED'});
  });
  else {
    if(!sheet) throw new ProxyDomainError('INVALID_INPUT','Cần snapshot Sheet đã lưu để đối chiếu');
    reconciliation=buildReconciliation(sheet,ctx);
    for(const result of reconciliation.rows){
      if(result.outcome!=='READY'){rows.push(result);continue;}
      const source=sheet.rows[result.row-1],p=source.proxy!,packageCode=matchPackage(p,catalog);
      rows.push({...result,packageCode,...(!packageCode?{code:'UNKNOWN_PACKAGE' as const,message:'Theo dõi từ Sheet; cần xác định gói trước khi cấp VM'}:{})});
      items.push({row:result.row,next:p,owner:result.owner!,subgroup:result.subgroup||null,packageCode,state:packageCode?'LIVE':'QUARANTINED',sourceRef:source.sourceRef,sourceSnapshotId:source.snapshotId});
    }
  }
  return {rows,items,...(reconciliation?{reconciliation}:{})};
}
function canonical(value:unknown):string{
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const action=(kind:string):InfrastructureAction=>kind==='BLOCKED'?'BLOCK':kind==='REPLACE'?'REPLACE':'IMPORT';
function revisionFacts(ctx:ProxyContext,catalog:CatalogAccount[]){return {identities:ctx.identities.map(i=>[i.id,i.revision]).sort(),endpoints:ctx.endpoints.map(e=>[e.id,e.revision]).sort(),catalog:hash(catalog)};}
function dto(batch:{token:string;kind:string;previewRows:Prisma.JsonValue;expiresAt:Date}):BatchPreview{
  const rows=batch.previewRows as unknown as PreviewRow[];
  return {token:batch.token,kind:batch.kind as BatchInput['kind'],rows,ready:rows.filter(r=>r.outcome==='READY').length,skipped:rows.filter(r=>r.outcome==='SKIP').length,errors:rows.filter(r=>r.outcome==='ERROR').length,expiresAt:batch.expiresAt.toISOString()};
}
export function createProxyBatchService(db:PrismaClient=prisma,deps:{refreshSource?:(projectId:string,db:PrismaClient)=>Promise<SourceSnapshotRef>;afterEvent?:(tx:Prisma.TransactionClient)=>void|Promise<void>}={}){
  const refresh=deps.refreshSource||refreshGenjy;
  const scoped=async(scope:ActorScope,operation:InfrastructureAction,reader:PrismaClient|Prisma.TransactionClient=db)=>{
    const current=await loadInfrastructureScope(reader,scope.userId,scope.projectId);assertInfrastructureAction(current,operation);
    if(current.businessMode!=='PROXY_VM') throw new ProxyDomainError('FORBIDDEN','Dự án chưa bật quản lý proxy/VM');return current;
  };
  async function loadSheet(scope:ActorScope,input:BatchInput,reader:PrismaClient|Prisma.TransactionClient=db):Promise<SheetSnapshot|undefined>{
    if(input.kind!=='SHEET') return;
    if(!input.snapshotIds?.length||new Set(input.snapshotIds).size!==input.snapshotIds.length) throw new ProxyDomainError('INVALID_INPUT');
    const records=await reader.proxySourceSnapshot.findMany({where:{projectId:scope.projectId,id:{in:input.snapshotIds},sourceKey:'PERSONAL_SHEET',scanSucceeded:true}});
    if(records.length!==input.snapshotIds.length) throw new ProxyDomainError('NOT_FOUND');
    const snapshots=input.snapshotIds.map(id=>{const r=records.find(v=>v.id===id)!;return r.encryptedPayload?{...JSON.parse(decrypt(r.encryptedPayload)) as SheetSnapshot,recordId:r.id}:null;});
    if(snapshots.some(s=>!s||!Array.isArray(s.rows)||!Array.isArray(s.snapshots))) throw new ProxyDomainError('INVALID_INPUT');
    return {rows:snapshots.flatMap(s=>s!.rows.map(row=>({...row,snapshotId:s!.recordId}))),snapshots:snapshots.flatMap(s=>s!.snapshots)};
  }
  async function preview(scope:ActorScope,input:BatchInput):Promise<BatchPreview>{
    const current=await scoped(scope,action(input.kind)),payloadHash=hash(input);
    const prior=await db.proxyBatch.findUnique({where:{projectId_idempotencyKey:{projectId:scope.projectId,idempotencyKey:input.idempotencyKey}}});
    if(prior){if(prior.actorId!==scope.userId) throw new ProxyDomainError('FORBIDDEN');if(prior.payloadHash!==payloadHash) throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');if(prior.status==='APPLIED') return dto(prior);}
    if(input.kind!=='BLOCKED') await refresh(scope.projectId,db);
    const sheet=await loadSheet(current,input);
    const [ctx,catalog]=await Promise.all([loadProxyContext(current,input,db,sheet),loadCatalog(scope.projectId,db)]);
    const planned=planBatch(input,ctx,catalog,scope.projectId,sheet);
    const data={actorId:scope.userId,kind:input.kind,payloadHash,token:randomBytes(32).toString('base64url'),encryptedPlan:encrypt(JSON.stringify({input,sheet,...planned})),sourceHash:ctx.source.hash,revisionFacts:revisionFacts(ctx,catalog) as Prisma.InputJsonValue,previewRows:planned.rows as unknown as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+600000)};
    const batch=prior?await db.proxyBatch.update({where:{id:prior.id},data}):await db.proxyBatch.create({data:{...data,projectId:scope.projectId,idempotencyKey:input.idempotencyKey}});
    return dto(batch);
  }
  async function commit(scope:ActorScope,token:string,idempotencyKey:string):Promise<CommitResult>{
    const vmBatch=await db.proxyBatch.findFirst({where:{token,projectId:scope.projectId,actorId:scope.userId,kind:'VM_ALLOCATION'},select:{id:true}});
    if(vmBatch)throw new ProxyDomainError('INVALID_INPUT','Đợt gán VM phải lưu qua luồng Server/VM');
    const original=await db.proxyBatch.findFirst({where:{token,projectId:scope.projectId,actorId:scope.userId}});if(!original) throw new ProxyDomainError('NOT_FOUND');
    await scoped(scope,action(original.kind));
    if(original.idempotencyKey!==idempotencyKey) throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');
    async function replayResult(reader:PrismaClient|Prisma.TransactionClient,batch:NonNullable<typeof original>){const journal=await reader.operationJournal.findUnique({where:{batchId:batch.id}});const undo=journal?await reader.operationJournal.findUnique({where:{undoOfId:journal.id}}):null;return {...batch.result as unknown as CommitResult,replay:true,undone:!!undo};}
    if(original.status==='APPLIED') return replayResult(db,original);
    if(original.expiresAt.getTime()<=Date.now()) throw new ProxyDomainError('STALE_PREVIEW','Bản kiểm tra đã hết hạn; kiểm tra lại');
    if(original.kind!=='BLOCKED') {const source=await refresh(scope.projectId,db);if(!source.scanSucceeded) throw new ProxyDomainError('SOURCE_UNAVAILABLE');}
    return withProxyTransaction(async tx=>{
      const batch=await tx.proxyBatch.findFirstOrThrow({where:{id:original.id,token,projectId:scope.projectId,actorId:scope.userId}});
      const current=await scoped(scope,action(batch.kind),tx);
      if(batch.status==='APPLIED') return replayResult(tx,batch);
      if(batch.expiresAt.getTime()<=Date.now()) throw new ProxyDomainError('STALE_PREVIEW');
      const saved=JSON.parse(decrypt(batch.encryptedPlan)) as Planned&{input:BatchInput;sheet?:SheetSnapshot};
      if(hash(saved.input)!==batch.payloadHash) throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');
      const currentSheet=await loadSheet(current,saved.input,tx);
      if(batch.kind==='SHEET'&&hash(currentSheet)!==hash(saved.sheet)) throw new ProxyDomainError('STALE_PREVIEW','Snapshot đối chiếu đã đổi; kiểm tra lại');
      const [ctx,catalog]=await Promise.all([loadProxyContext(current,saved.input,tx,currentSheet),loadCatalog(scope.projectId,tx)]);
      if(hash(revisionFacts(ctx,catalog))!==hash(batch.revisionFacts)||(batch.kind!=='BLOCKED'&&ctx.source.hash!==batch.sourceHash)) throw new ProxyDomainError('STALE_PREVIEW','Dữ liệu đã thay đổi; kiểm tra lại');
      const planned=planBatch(saved.input,ctx,catalog,scope.projectId,saved.sheet);
      if(hash(planned)!==hash({rows:saved.rows,items:saved.items,reconciliation:saved.reconciliation})) throw new ProxyDomainError('STALE_PREVIEW');
      const now=new Date(),receivedDate=parseReceivedDate(saved.input.receivedDate);
      const beforeImages=new Map<string,ReturnType<typeof captureEndpoint>|null>();
      for(const item of planned.items)if(item.oldEndpointId){const row=await tx.proxyIP.findFirstOrThrow({where:{id:item.oldEndpointId,projectId:scope.projectId},include:endpointInclude});beforeImages.set(row.id,captureEndpoint(row));}
      for(const item of planned.items){
        if(batch.kind==='BLOCKED'){
          const old=await tx.proxyIP.findFirstOrThrow({where:{id:item.oldEndpointId,projectId:scope.projectId}});
          if(!old.identityId) throw new ProxyDomainError('OWNER_CONFLICT','Proxy cũ cần được đối chiếu trước');
          await tx.proxyIP.update({where:{id:old.id},data:{inventoryState:'BLOCKED',status:'BLOCKED',statusAt:now,revision:{increment:1}}});
          await tx.proxyStatusEvent.create({data:{projectId:scope.projectId,identityId:old.identityId,endpointId:old.id,batchId:batch.id,ip:old.host!,kind:'BLOCKED',occurredAt:now,actorId:scope.userId}});
        }else{
          const p=item.next!;
          let identity=await tx.proxyIdentity.findUnique({where:{ip:p.ip}});
          if(identity){
            if(identity.owner!==item.owner||identity.subgroup!==item.subgroup||(batch.kind!=='SHEET'&&item.owner!=='GENJY')) throw new ProxyDomainError('STALE_PREVIEW');
            identity=await tx.proxyIdentity.update({where:{id:identity.id},data:{revision:{increment:1},lastSeenAt:now}});
          }else identity=await tx.proxyIdentity.create({data:{ip:p.ip,owner:item.owner,subgroup:item.subgroup}});
          const endpoint=await tx.proxyIP.create({data:{projectId:scope.projectId,identityId:identity.id,address:`${p.ip}:${p.port}`,host:p.ip,port:p.port,credentialCipher:encrypt(JSON.stringify({username:p.username,password:p.password})),packageCode:item.packageCode,inventoryState:item.state,status:item.owner==='GENJY'?'RESERVED':item.state==='BLOCKED'?'BLOCKED':'AVAILABLE',inventoryKey:identity.id,revision:1,statusAt:batch.kind==='SHEET'?null:now,notesCipher:!item.packageCode?encrypt(JSON.stringify({quarantineReason:'UNKNOWN_PACKAGE',intendedState:batch.kind==='SHEET'?'LIVE':'NEW'})):null}});
          beforeImages.set(endpoint.id,null);
          await tx.proxyStatusEvent.create({data:{projectId:scope.projectId,identityId:identity.id,endpointId:endpoint.id,batchId:batch.id,ip:p.ip,kind:batch.kind==='SHEET'?'SHEET_IMPORT':'RECEIVED',occurredAt:batch.kind==='SHEET'?null:receivedDate,actorId:scope.userId,sourceRef:item.sourceRef}});
          if(batch.kind==='SHEET'&&item.sourceSnapshotId) await tx.proxySourceReference.create({data:{snapshotId:item.sourceSnapshotId,identityId:identity.id,endpointId:endpoint.id,sourceRef:item.sourceRef!,format:p.format,owner:item.owner,subgroup:item.subgroup,hasFullCredentials:true,hasManualMetadata:false,dataCipher:encrypt(JSON.stringify(saved.sheet!.rows[item.row-1]))}});
          if(batch.kind==='REPLACE'){
            const old=await tx.proxyIP.findFirstOrThrow({where:{id:item.oldEndpointId,projectId:scope.projectId}});
            if(!old.identityId) throw new ProxyDomainError('OWNER_CONFLICT');
            await tx.proxyIP.update({where:{id:old.id},data:{inventoryState:'REPLACED',status:'RESERVED',retiredAt:now,statusAt:now,revision:{increment:1}}});
            await tx.proxyStatusEvent.create({data:{projectId:scope.projectId,identityId:old.identityId,endpointId:old.id,batchId:batch.id,ip:old.host!,kind:'REPLACED',occurredAt:receivedDate,actorId:scope.userId}});
            await tx.proxyReplacement.create({data:{projectId:scope.projectId,oldEndpointId:old.id,newEndpointId:endpoint.id,ownerSnapshot:item.owner,subgroupSnapshot:item.subgroup,receivedDate,actorId:scope.userId,batchId:batch.id}});
          }
        }
        await deps.afterEvent?.(tx);
      }
      const result:CommitResult={batchId:batch.id,replay:false,rows:planned.rows,applied:planned.items.length,skipped:planned.rows.filter(r=>r.outcome==='SKIP').length,errors:planned.rows.filter(r=>r.outcome==='ERROR').length};
      if(planned.items.length){
        const resources:ResourceImage[]=[];
        for(const [id,before] of Array.from(beforeImages))resources.push({resource:'ENDPOINT',id,before,after:await readImage(tx,scope.projectId,'ENDPOINT',id)} as ResourceImage);
        const [events,replacements]=await Promise.all([tx.proxyStatusEvent.findMany({where:{batchId:batch.id},select:{id:true}}),tx.proxyReplacement.findMany({where:{batchId:batch.id},select:{id:true}})]);
        await recordOperation(tx,{scope:current,kind:batch.kind,summary:{count:result.applied,skipped:result.skipped,errors:result.errors},batchId:batch.id,snapshot:{version:1,resources,eventIds:events.map(e=>e.id),replacementIds:replacements.map(r=>r.id)}});
      }
      await tx.proxyBatch.update({where:{id:batch.id},data:{status:'APPLIED',appliedAt:now,result:result as unknown as Prisma.InputJsonValue}});
      await tx.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'PROXY_BATCH',entity:'ProxyBatch',entityId:batch.id,changes:{kind:batch.kind,applied:result.applied,skipped:result.skipped,errors:result.errors}}});
      return result;
    },db);
  }
  return {preview,commit};
}
const defaultService=createProxyBatchService();
export const previewBatch=defaultService.preview;
export const commitBatch=defaultService.commit;
