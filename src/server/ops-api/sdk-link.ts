import type {Prisma} from '@prisma/client';
import {maskSdk} from '@/lib/sdk-mask';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import type {BusinessCollector} from '../business-management/idempotency';
import {linkVmSdkIn} from '../vm-management/sdk-store';

/** The web writer's messages may name a full SDK. AI responses, including refusals, never do. */
export async function linkSdkForAi(tx:Prisma.TransactionClient,images:BusinessCollector,scope:ActorScope,input:Parameters<typeof linkVmSdkIn>[3]){
 const record=await tx.sdkRecord.findFirst({where:{id:input.sdkId,projectId:scope.projectId},select:{code:true}});
 const safe=(s:string)=>record?s.split(record.code).join(maskSdk(record.code)??'…'):s;
 const details=(x:unknown):unknown=>typeof x==='string'?safe(x):Array.isArray(x)?x.map(details):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,details(v)])):x;
 try{const r=await linkVmSdkIn(tx,images,scope,input);return {...r,message:safe(r.message)};}
 catch(e){if(e instanceof ProxyDomainError)throw new ProxyDomainError(e.code,safe(e.message),e.reason,e.details?details(e.details) as Record<string,unknown>:undefined);throw e;}
}
