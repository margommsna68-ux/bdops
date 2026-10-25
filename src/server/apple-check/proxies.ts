import type {Prisma,PrismaClient} from '@prisma/client';
import {getEligibleInventory} from '../proxy-management/repository';

type DB=PrismaClient|Prisma.TransactionClient;
/** Apple checks borrow a connection; they never allocate or detach a VM proxy. */
export async function checkProxyIds(projectId:string,db:DB,leaseJobId?:string,endpointId?:string){
  const live=await db.proxyIP.findMany({where:{projectId,...(endpointId?{id:endpointId}:{}),inventoryState:'LIVE',retiredAt:null,
    status:{notIn:['BLOCKED','RESERVED']},credentialCipher:{not:null},packageCode:{not:null},
    OR:[{vm:{managed:true,archivedAt:null,server:{projectId,managed:true,archivedAt:null}}},
      {allocations:{some:{projectId,releasedAt:null,role:{in:['DESIRED','INSTALLED']},vm:{managed:true,archivedAt:null,server:{projectId,managed:true,archivedAt:null}}}}}],
    identity:{owner:'SELF'}},include:{identity:{include:{events:true,endpoints:true,sourceRefs:true}}}});
  const usable=live.filter(p=>{
    const i=p.identity;
    return !!i&&!!p.host&&!!p.port&&!!p.inventoryKey&&(!p.appleCheckLeaseJobId||p.appleCheckLeaseJobId===leaseJobId)
      &&(!!i.ownerDecidedAt||!i.sourceRefs.some(s=>s.owner==='GENJY'))
      &&!i.events.some(e=>!e.reversedAt&&['BLOCKED','DIE','REPLACED','VOID'].includes(e.kind))
      &&(i.allocationMode!=='SINGLE_IP'||i.endpoints.filter(e=>!e.retiredAt).length===1)
      &&(i.allocationMode!=='APPROVED_PORT_STREAM'||!!i.policyEvidenceCipher);
  }).map(p=>p.id);
  // The common VM autofill pool stays unchanged: NEW and unassigned only.
  if(!endpointId||!usable.length){const unused=await getEligibleInventory(projectId,db,leaseJobId);usable.push(...unused.filter(p=>!endpointId||p.endpointId===endpointId).map(p=>p.endpointId));}
  return usable;
}
