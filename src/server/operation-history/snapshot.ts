import type {Prisma,PrismaClient,ProxyIP,ProxyIdentity,ProxyProviderAccount,ProjectMember} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
type EndpointRow=ProxyIP&{identity:Pick<ProxyIdentity,'owner'|'subgroup'>|null;vm:{id:string}|null};
export const endpointInclude={identity:{select:{owner:true,subgroup:true}},vm:{select:{id:true}}} as const;
export function captureEndpoint(row:EndpointRow){
  return {address:row.address,host:row.host,port:row.port,subnet:row.subnet,status:row.status,outboundIP:row.outboundIP,blockReason:row.blockReason,identityId:row.identityId,owner:row.identity?.owner,subgroup:row.identity?.subgroup,credentialCipher:row.credentialCipher,packageCode:row.packageCode,inventoryState:row.inventoryState,inventoryKey:row.inventoryKey,revision:row.revision,statusAt:row.statusAt?.toISOString()||null,retiredAt:row.retiredAt?.toISOString()||null,notesCipher:row.notesCipher,hasManualMetadata:row.hasManualMetadata,vmId:row.vm?.id||null,updatedAt:row.updatedAt.toISOString()};
}
export function captureAccount(row:ProxyProviderAccount){return {code:row.code,label:row.label,credentialCipher:row.credentialCipher,disabled:row.disabled,revision:row.revision};}
export function captureMember(row:ProjectMember){return {role:row.role,capabilities:row.capabilities,allowedModules:row.allowedModules,accessRevision:row.accessRevision};}
type Image<T>={id:string;before:T|null;after:T;endpointGuard?:{id:string;revision:number}[]};
export type ResourceImage=(Image<ReturnType<typeof captureEndpoint>>&{resource:'ENDPOINT'})|(Image<ReturnType<typeof captureAccount>>&{resource:'ACCOUNT'})|(Image<ReturnType<typeof captureMember>>&{resource:'MEMBER'});
export interface OperationSnapshot {version:1;resources:ResourceImage[];eventIds:string[];replacementIds:string[]}
export async function readImage(tx:Prisma.TransactionClient|PrismaClient,projectId:string,resource:ResourceImage['resource'],id:string){
  if(resource==='ENDPOINT'){const row=await tx.proxyIP.findFirst({where:{id,projectId},include:endpointInclude});return row?captureEndpoint(row):null;}
  if(resource==='ACCOUNT'){const row=await tx.proxyProviderAccount.findFirst({where:{id,projectId}});return row?captureAccount(row):null;}
  const row=await tx.projectMember.findFirst({where:{id,projectId}});return row?captureMember(row):null;
}
export async function assertImagesUnchanged(tx:Prisma.TransactionClient|PrismaClient,projectId:string,snapshot:OperationSnapshot){
  for(const image of snapshot.resources){
    const actual=await readImage(tx,projectId,image.resource,image.id);
    if(!actual||JSON.stringify(actual)!==JSON.stringify(image.after))throw new ProxyDomainError('STALE_PREVIEW','Dữ liệu đã được sửa tiếp hoặc gán VM. Không thể hoàn tác đè lên thay đổi mới.');
    if(image.endpointGuard){const endpoints=await tx.proxyIP.findMany({where:{projectId},select:{id:true,revision:true},orderBy:{id:'asc'}});if(JSON.stringify(endpoints)!==JSON.stringify(image.endpointGuard))throw new ProxyDomainError('STALE_PREVIEW','Kho đã thay đổi sau khi sửa gói. Không thể hoàn tác gói cũ.');}
  }
}
export function describeImage(image:ResourceImage){
  if(image.resource==='ENDPOINT')return {resource:'Proxy',label:image.after.host||image.id,before:image.before?`${image.before.inventoryState} · ${image.before.packageCode||'Chưa rõ gói'}`:'Chưa có trong kho',after:`${image.after.inventoryState} · ${image.after.packageCode||'Chưa rõ gói'}`,onUndo:image.before?'Khôi phục trạng thái trước':'Thu hồi khỏi kho khả dụng; giữ lịch sử IP'};
  if(image.resource==='ACCOUNT')return {resource:'Gói proxy',label:image.after.code,before:image.before?image.before.label+(image.before.disabled?' (tắt)':''):'Chưa có',after:image.after.label,onUndo:image.before?'Khôi phục gói trước':'Tắt gói vừa tạo'};
  const format=(v:ReturnType<typeof captureMember>)=>[v.role,...v.allowedModules,...v.capabilities].join(', ');
  return {resource:'Quyền nhân viên',label:image.id,before:image.before?format(image.before):'Chưa có',after:format(image.after),onUndo:'Khôi phục quyền trước'};
}
