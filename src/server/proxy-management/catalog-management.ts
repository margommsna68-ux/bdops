import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {assertInfrastructureAction,loadInfrastructureScope} from '../permissions/infrastructure';
import {withProxyTransaction} from './transaction';
import {decodeEndpoint,loadCatalog} from './repository';
import {matchPackage} from './catalog';
import {Prisma} from '@prisma/client';
import {ProxyDomainError,type ActorScope,type InventoryState} from './types';
import {compareCodes,dueState} from './package-terms';
export interface PackageTermsInput {site?:string|null;note?:string|null;price?:string|null;priceCurrency?:string|null;cycleMonths?:number|null;nextDueDate?:string|null}
const text=(v:string|null|undefined,max:number)=>{const t=v?.trim()||null;if(t&&t.length>max)throw new ProxyDomainError('INVALID_INPUT');return t;};
export function packageTerms(input:PackageTermsInput,old?:{cycleMonths:number}|null){
  const price=input.price===undefined?undefined:input.price===null||input.price.trim()===''?null:input.price.trim();
  if(price&&!/^\d{1,15}(\.\d{1,8})?$/.test(price))throw new ProxyDomainError('INVALID_INPUT','Giá gói không hợp lệ');
  const currency=input.priceCurrency===undefined?undefined:text(input.priceCurrency?.toUpperCase(),8);
  if(currency&&!/^[A-Z]{3,8}$/.test(currency))throw new ProxyDomainError('INVALID_INPUT','Đồng tiền không hợp lệ');
  const cycle=input.cycleMonths===undefined||input.cycleMonths===null?old?.cycleMonths??1:input.cycleMonths;
  if(!Number.isInteger(cycle)||cycle<1||cycle>60)throw new ProxyDomainError('INVALID_INPUT','Chu kỳ tính theo tháng (1–60)');
  let nextDueDate:Date|null|undefined;
  if(input.nextDueDate!==undefined){if(!input.nextDueDate)nextDueDate=null;else{if(!/^\d{4}-\d{2}-\d{2}$/.test(input.nextDueDate))throw new ProxyDomainError('INVALID_INPUT','Ngày đến hạn dùng YYYY-MM-DD');nextDueDate=new Date(input.nextDueDate+'T00:00:00.000Z');if(Number.isNaN(nextDueDate.getTime())||nextDueDate.toISOString().slice(0,10)!==input.nextDueDate)throw new ProxyDomainError('INVALID_INPUT','Ngày đến hạn không hợp lệ');}}
  return {site:input.site===undefined?undefined:text(input.site,120),note:input.note===undefined?undefined:text(input.note,500),price:price===undefined?undefined:price===null?null:new Prisma.Decimal(price),priceCurrency:currency,cycleMonths:cycle,nextDueDate};
}
import {recordOperation} from '../operation-history/journal';
import {captureAccount,captureEndpoint,endpointInclude,readImage,type ResourceImage} from '../operation-history/snapshot';
export async function saveProviderAccount(scope:ActorScope,input:{code:string;label:string;username?:string|null;password?:string|null}&PackageTermsInput,db:PrismaClient=prisma){
  return withProxyTransaction(async tx=>{
    const current=await loadInfrastructureScope(tx,scope.userId,scope.projectId);assertInfrastructureAction(current,'MANAGE');
    if(current.businessMode!=='PROXY_VM') throw new ProxyDomainError('FORBIDDEN');
    if(!input.code.trim()||!input.label.trim()||input.code.length>80||input.label.length>100) throw new ProxyDomainError('INVALID_INPUT');
    const previous=await loadCatalog(scope.projectId,tx);
    const oldAccount=await tx.proxyProviderAccount.findUnique({where:{projectId_code:{projectId:scope.projectId,code:input.code}}});
    const credentials=input.username&&input.password?{username:input.username,password:input.password}:null;
    if(!oldAccount&&!credentials) throw new ProxyDomainError('INVALID_INPUT','Gói mới cần user/pass');
    if(credentials&&previous.some(a=>a.code!==input.code&&a.username===credentials.username&&a.password===credentials.password)) throw new ProxyDomainError('DUPLICATE_INPUT','Thông tin này đã thuộc một gói khác');
    const terms=packageTerms(input,oldAccount);
    const account=await tx.proxyProviderAccount.upsert({where:{projectId_code:{projectId:scope.projectId,code:input.code}},create:{projectId:scope.projectId,code:input.code,label:input.label,credentialCipher:encrypt(JSON.stringify(credentials)),...terms},update:{label:input.label,...(credentials?{credentialCipher:encrypt(JSON.stringify(credentials))}:{}),disabled:false,...terms}});
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
    if(resources[0].resource==='ACCOUNT'){resources[0].endpointGuard=await tx.proxyIP.findMany({where:{projectId:scope.projectId},select:{id:true,revision:true},orderBy:{id:'asc'}});resources[0].accountGuard=await tx.proxyProviderAccount.findMany({where:{projectId:scope.projectId},select:{id:true,revision:true},orderBy:{id:'asc'}});}
    await recordOperation(tx,{scope:current,kind:'CATALOG',summary:{code:input.code,resolved},snapshot:{version:1,resources,eventIds:[],replacementIds:[]}});
    await tx.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'PROXY_CATALOG',entity:'ProxyProviderAccount',entityId:input.code,changes:{code:input.code,resolved}}});
    return {saved:true,resolved};
  },db);
}
export async function listPackages(scope:ActorScope,db:PrismaClient=prisma,today:Date=new Date()){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);assertInfrastructureAction(current,'READ');
  const [accounts,counts]=await Promise.all([
    db.proxyProviderAccount.findMany({where:{projectId:scope.projectId}}),
    db.proxyIP.groupBy({by:['packageCode'],where:{projectId:scope.projectId,packageCode:{not:null},inventoryState:{in:['NEW','LIVE','BLOCKED']}},_count:{_all:true}}),
  ]);
  const byCode=new Map(counts.map(c=>[c.packageCode,c._count._all]));
  const rank=(code:string)=>/^\d+$/.test(code)?0:1;
  return accounts.sort((a,b)=>rank(a.code)-rank(b.code)||compareCodes(a.code,b.code)).map(a=>({id:a.id,code:a.code,label:a.label,site:a.site,note:a.note,price:a.price?.toString()??null,priceCurrency:a.priceCurrency,cycleMonths:a.cycleMonths,nextDueDate:a.nextDueDate?.toISOString().slice(0,10)??null,lastPaidAt:a.lastPaidAt?.toISOString()??null,disabled:a.disabled,revision:a.revision,proxyCount:byCode.get(a.code)||0,due:dueState(a.nextDueDate,today)}));
}
