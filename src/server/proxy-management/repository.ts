import type {Prisma,PrismaClient,ProxyIP} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {pairReplacementRows,parseProxy,parseProxyRows} from './parse';
import {withProxyTransaction} from './transaction';
import type {ActorScope,BatchInput,CatalogAccount,EligibleProxy,EndpointFact,HistoryFact,ParsedProxy,ProxyContext,SheetSnapshot} from './types';
type Reader=PrismaClient|Prisma.TransactionClient;
export function decodeEndpoint(row:Pick<ProxyIP,'address'|'host'|'port'|'credentialCipher'>):ParsedProxy|null{
  if(row.credentialCipher&&row.host&&row.port){const c=JSON.parse(decrypt(row.credentialCipher)) as {username:string;password:string};return {ip:row.host,port:row.port,...c,format:'FULL'};}
  try{return parseProxy(row.address);}catch{return null;}
}
// Imports and allocations see only enabled packages; pass includeDisabled to keep matching existing proxies to a disabled package.
export async function loadCatalog(projectId:string,db:Reader=prisma,includeDisabled=false):Promise<CatalogAccount[]>{
  const accounts=await db.proxyProviderAccount.findMany({where:{projectId,...(includeDisabled?{}:{disabled:false})}});
  return accounts.map(a=>({id:a.id,code:a.code,...JSON.parse(decrypt(a.credentialCipher))}));
}
function requestedIps(input:BatchInput,sheet?:SheetSnapshot):string[]|null{
  if(input.kind==='SHEET') return sheet?Array.from(new Set(sheet.rows.flatMap(r=>r.proxy?[r.proxy.ip]:[]))):null;
  const parsed=input.kind==='REPLACE'?pairReplacementRows(input.removedText||input.text||'',input.addedText||'').flatMap(p=>[p.old?.proxy,p.next?.proxy]):parseProxyRows(input.text||'').map(l=>l.proxy);
  return Array.from(new Set(parsed.flatMap(p=>p?[p.ip]:[])));
}
export async function loadProxyContext(scope:ActorScope,input:BatchInput,db:Reader=prisma,sheet?:SheetSnapshot):Promise<ProxyContext>{
  const ips=requestedIps(input,sheet);
  const identityWhere=ips?{ip:{in:ips}}:{};
  const endpointWhere:Prisma.ProxyIPWhereInput=ips?{OR:[{identity:{ip:{in:ips}}},...ips.map(ip=>({AND:[{identityId:null},{OR:[{address:ip},{address:{startsWith:ip+':'}}]}]}))]}:{};
  const [identities,rows,references,events,replacements,source]=await Promise.all([
    db.proxyIdentity.findMany({where:identityWhere}),
    db.proxyIP.findMany({where:endpointWhere,include:{vm:{include:{server:true}},allocations:{where:{releasedAt:null},include:{vm:{include:{server:true}}}}}}),
    db.proxySourceReference.findMany({where:{identity:identityWhere,snapshot:{scanSucceeded:true}},include:{identity:{select:{ip:true}},snapshot:{select:{projectId:true}}}}),
    db.proxyStatusEvent.findMany({where:ips?{ip:{in:ips}}:{}}),
    db.proxyReplacement.findMany({where:ips?{OR:[{oldEndpoint:{identity:identityWhere}},{newEndpoint:{identity:identityWhere}}]}:{},include:{oldEndpoint:{include:{identity:true}},newEndpoint:{include:{identity:true}}}}),
    db.proxySourceSnapshot.findFirst({where:{projectId:scope.projectId,sourceKey:'GENJY'},orderBy:{fetchedAt:'desc'}}),
  ]);
  const endpoints:EndpointFact[]=rows.flatMap(row=>{
    const parsed=decodeEndpoint(row);if(!parsed) return [];
    // Conflicts outside the caller's project retain only identity, never location/credentials.
    const proxy=row.projectId===scope.projectId?parsed:{ip:parsed.ip,port:parsed.port,username:null,password:null,format:'BARE' as const};
    return [{id:row.id,projectId:row.projectId,identityId:row.identityId||'legacy:'+row.id,proxy,inventoryState:row.inventoryState,retiredAt:row.retiredAt?.toISOString()||null,revision:row.revision,vmKeys:row.projectId===scope.projectId?Array.from(new Set([...(row.vm?[row.vm.server.code+'/'+row.vm.code]:[]),...row.allocations.map(a=>a.vm.server.code+'/'+a.vm.code)])):[]}];
  });
  const kinds=new Set(['RECEIVED','BLOCKED','DIE','REPLACED','VOID']);
  const history:HistoryFact[]=events.filter(e=>kinds.has(e.kind)).map(e=>({ip:e.ip,kind:e.kind as HistoryFact['kind'],occurredAt:e.occurredAt?.toISOString()||null,recordedAt:e.recordedAt.toISOString()}));
  return {
    identities:identities.map(i=>({id:i.id,ip:i.ip,owner:i.owner,subgroup:i.subgroup,revision:i.revision,allocationMode:i.allocationMode})),endpoints,history,
    evidence:references.map(r=>({sourceRef:r.snapshot.projectId===scope.projectId?r.sourceRef:'Nguồn khác đã giữ IP',ip:r.identity.ip,owner:r.owner,subgroup:r.subgroup,format:r.format as 'BARE'|'FULL',hasFullCredentials:r.hasFullCredentials,hasManualMetadata:r.hasManualMetadata})),
    receipts:replacements.flatMap(r=>r.oldEndpoint.identity&&r.newEndpoint.identity?[{oldIp:r.oldEndpoint.identity.ip,newIp:r.newEndpoint.identity.ip,status:r.status as 'APPLIED'|'VOID',oldEndpointId:r.oldEndpointId,newEndpointId:r.newEndpointId}]:[]),
    source:source?{id:source.id,sourceKey:source.sourceKey,hash:source.hash,fetchedAt:source.fetchedAt.toISOString(),scanSucceeded:source.scanSucceeded}:{id:'',sourceKey:'GENJY',hash:'UNAVAILABLE',fetchedAt:new Date(0).toISOString(),scanSucceeded:false},
  };
}
// Autofill pool: unused TUT NEW only. Chung mooon–Genjy never enters it; getManualInventory adds shared proxies for a hand-picked VM.
export async function getEligibleInventory(projectId:string,db:Reader=prisma):Promise<EligibleProxy[]>{return eligibleRows(projectId,db,false);}
export async function getManualInventory(projectId:string,db:Reader=prisma):Promise<EligibleProxy[]>{return eligibleRows(projectId,db,true);}
async function eligibleRows(projectId:string,db:Reader,withShared:boolean):Promise<EligibleProxy[]>{
  const held=new Set((await db.vMProxyAllocation.findMany({where:{releasedAt:null},select:{allocationKey:true}})).map(a=>a.allocationKey));
  const rows=await db.proxyIP.findMany({where:{projectId,inventoryState:'NEW',retiredAt:null,credentialCipher:{not:null},packageCode:{not:null},vm:null,identity:withShared?{OR:[{owner:'SELF'},{owner:'GENJY',subgroup:'PC_CHUNG'}]}:{owner:'SELF'}},include:{identity:{include:{events:true,endpoints:true,sourceRefs:true}}}});
  return rows.flatMap(r=>{
    const i=r.identity,shared=i?.owner==='GENJY'&&i.subgroup==='PC_CHUNG';if(!i||!r.port||!r.inventoryKey||held.has(r.inventoryKey)||(!shared&&!i.ownerDecidedAt&&i.sourceRefs.some(s=>s.owner==='GENJY'))||i.events.some(e=>!e.reversedAt&&['BLOCKED','DIE','REPLACED','VOID','INSTALL_STARTED','INSTALLED'].includes(e.kind))) return [];
    if(i.allocationMode==='SINGLE_IP'&&i.endpoints.filter(e=>!e.retiredAt).length!==1) return [];
    if(i.allocationMode==='APPROVED_PORT_STREAM'&&!i.policyEvidenceCipher) return [];
    return [{identityId:i.id,endpointId:r.id,ip:i.ip,port:r.port,revision:r.revision,allocationKey:r.inventoryKey,shared}];
  });
}
export async function backfillLegacyProject(projectId:string,db:PrismaClient=prisma){
  return withProxyTransaction(async tx=>{
    const rows=await tx.proxyIP.findMany({where:{projectId,identityId:null}});
    const report:{linked:number;quarantined:number;issues:{endpointId:string;ip:string|null;reason:string}[]}={linked:0,quarantined:0,issues:[]};
    for(const row of rows){
      const p=decodeEndpoint(row);
      if(!p){report.quarantined++;report.issues.push({endpointId:row.id,ip:null,reason:'INVALID_INPUT'});continue;}
      const identity=await tx.proxyIdentity.upsert({where:{ip:p.ip},create:{ip:p.ip,owner:'UNKNOWN'},update:{revision:{increment:1}}});
      await tx.proxyIP.update({where:{id:row.id},data:{identityId:identity.id,host:p.ip,port:p.port,address:`${p.ip}:${p.port||''}#legacy:${row.id}`,credentialCipher:p.format==='FULL'?encrypt(JSON.stringify({username:p.username,password:p.password})):null,notesCipher:encrypt(JSON.stringify({legacyAddress:row.address,blockReason:row.blockReason})),inventoryState:'QUARANTINED',revision:{increment:1},hasManualMetadata:!!row.blockReason}});
      await tx.proxyStatusEvent.create({data:{projectId,identityId:identity.id,endpointId:row.id,ip:p.ip,kind:'LEGACY_SNAPSHOT',occurredAt:null,reason:'Cần xác nhận owner, gói và đối chiếu dữ liệu cũ'}});
      report.linked++;report.quarantined++;report.issues.push({endpointId:row.id,ip:p.ip,reason:'UNRESOLVED_LEGACY'});
    }
    return report;
  },db);
}
