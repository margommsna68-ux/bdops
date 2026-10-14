import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {assertInfrastructureAction,loadInfrastructureScope} from '../permissions/infrastructure';
import {withProxyTransaction} from './transaction';
import {decodeEndpoint,loadCatalog} from './repository';
import {matchPackage} from './catalog';
import {ProxyDomainError,type ActorScope,type InventoryState} from './types';
import {recordOperation} from '../operation-history/journal';
import {captureAccount,captureEndpoint,endpointInclude,readImage,type ResourceImage} from '../operation-history/snapshot';
export async function saveProviderAccount(scope:ActorScope,input:{code:string;label:string;username:string;password:string},db:PrismaClient=prisma){
  return withProxyTransaction(async tx=>{
    const current=await loadInfrastructureScope(tx,scope.userId,scope.projectId);assertInfrastructureAction(current,'MANAGE');
    if(current.businessMode!=='PROXY_VM') throw new ProxyDomainError('FORBIDDEN');
    if(!input.code.trim()||!input.label.trim()||!input.username||!input.password) throw new ProxyDomainError('INVALID_INPUT');
    const previous=await loadCatalog(scope.projectId,tx);
    if(previous.some(a=>a.code!==input.code&&a.username===input.username&&a.password===input.password)) throw new ProxyDomainError('DUPLICATE_INPUT','Thông tin này đã thuộc một gói khác');
    const oldAccount=await tx.proxyProviderAccount.findUnique({where:{projectId_code:{projectId:scope.projectId,code:input.code}}});
    const account=await tx.proxyProviderAccount.upsert({where:{projectId_code:{projectId:scope.projectId,code:input.code}},create:{projectId:scope.projectId,code:input.code,label:input.label,credentialCipher:encrypt(JSON.stringify({username:input.username,password:input.password}))},update:{label:input.label,credentialCipher:encrypt(JSON.stringify({username:input.username,password:input.password})),disabled:false}});
    const resources:ResourceImage[]=[{resource:'ACCOUNT',id:account.id,before:oldAccount?captureAccount(oldAccount):null,after:captureAccount(account)}];
    const catalog=await loadCatalog(scope.projectId,tx),rows=await tx.proxyIP.findMany({where:{projectId:scope.projectId,identityId:{not:null},credentialCipher:{not:null}},include:endpointInclude});
    let resolved=0;
    for(const row of rows){
      const proxy=decodeEndpoint(row);if(!proxy) continue;
      const packageCode=matchPackage(proxy,catalog);let inventoryState:InventoryState=row.inventoryState,notes:Record<string,unknown>={};
      if(row.notesCipher){try{notes=JSON.parse(decrypt(row.notesCipher));}catch{}}
      if(!packageCode&&['NEW','LIVE'].includes(inventoryState)){
        notes={...notes,quarantineReason:'UNKNOWN_PACKAGE',intendedState:inventoryState};inventoryState='QUARANTINED';
      }else if(packageCode&&inventoryState==='QUARANTINED'&&notes.quarantineReason==='UNKNOWN_PACKAGE'&&['NEW','LIVE'].includes(String(notes.intendedState))&&row.identity?.owner!=='UNKNOWN'){
        inventoryState=notes.intendedState as 'NEW'|'LIVE';delete notes.quarantineReason;delete notes.intendedState;resolved++;
      }
      if(packageCode!==row.packageCode||inventoryState!==row.inventoryState){await tx.proxyIP.update({where:{id:row.id},data:{packageCode,inventoryState,notesCipher:Object.keys(notes).length?encrypt(JSON.stringify(notes)):null,revision:{increment:1}}});resources.push({resource:'ENDPOINT',id:row.id,before:captureEndpoint(row),after:await readImage(tx,scope.projectId,'ENDPOINT',row.id)} as ResourceImage);}
    }
    resources[0].endpointGuard=await tx.proxyIP.findMany({where:{projectId:scope.projectId},select:{id:true,revision:true},orderBy:{id:'asc'}});
    resources[0].accountGuard=await tx.proxyProviderAccount.findMany({where:{projectId:scope.projectId},select:{id:true,revision:true},orderBy:{id:'asc'}});
    await recordOperation(tx,{scope:current,kind:'CATALOG',summary:{code:input.code,resolved},snapshot:{version:1,resources,eventIds:[],replacementIds:[]}});
    await tx.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'PROXY_CATALOG',entity:'ProxyProviderAccount',entityId:input.code,changes:{code:input.code,resolved}}});
    return {saved:true,resolved};
  },db);
}
