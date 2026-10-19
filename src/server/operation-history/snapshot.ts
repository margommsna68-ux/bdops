import type {Prisma,PrismaClient,ProxyIP,ProxyIdentity,ProxyProviderAccount,ProjectMember,ProxyGroup} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
import {readVMImage,type VMImage} from '../vm-management/operation-images';
import {isBusinessResource,readBusinessImage,describeBusinessImage} from '../business-management/operation-images';
import type {BusinessImage} from '../business-management/types';
type EndpointRow=ProxyIP&{identity:Pick<ProxyIdentity,'owner'|'subgroup'>|null;vm:{id:string}|null};
export const endpointInclude={identity:{select:{owner:true,subgroup:true}},vm:{select:{id:true}}} as const;
export function captureEndpoint(row:EndpointRow){
  return {address:row.address,host:row.host,port:row.port,subnet:row.subnet,status:row.status,outboundIP:row.outboundIP,blockReason:row.blockReason,identityId:row.identityId,owner:row.identity?.owner,subgroup:row.identity?.subgroup,groupId:row.groupId,credentialCipher:row.credentialCipher,packageCode:row.packageCode,inventoryState:row.inventoryState,inventoryKey:row.inventoryKey,revision:row.revision,statusAt:row.statusAt?.toISOString()||null,retiredAt:row.retiredAt?.toISOString()||null,notesCipher:row.notesCipher,hasManualMetadata:row.hasManualMetadata,vmId:row.vm?.id||null,updatedAt:row.updatedAt.toISOString()};
}
export function captureAccount(row:ProxyProviderAccount){return {code:row.code,label:row.label,credentialCipher:row.credentialCipher,disabled:row.disabled,site:row.site,note:row.note,price:row.price?.toString()??null,priceCurrency:row.priceCurrency,cycleMonths:row.cycleMonths,nextDueDate:row.nextDueDate?.toISOString()??null,lastPaidAt:row.lastPaidAt?.toISOString()??null,reminderDays:row.reminderDays,renewalStoppedAt:row.renewalStoppedAt?.toISOString()??null,renewalStopNote:row.renewalStopNote,revision:row.revision};}
export function captureGroup(row:ProxyGroup){return {name:row.name,normalizedName:row.normalizedName,archivedAt:row.archivedAt?.toISOString()??null,revision:row.revision};}
export function captureIdentity(row:ProxyIdentity){return {ip:row.ip,owner:row.owner,subgroup:row.subgroup,ownerDecidedAt:row.ownerDecidedAt?.toISOString()??null,ownerDecidedBy:row.ownerDecidedBy,revision:row.revision};}
export function captureMember(row:ProjectMember){return {role:row.role,capabilities:row.capabilities,allowedModules:row.allowedModules,accessRevision:row.accessRevision};}
type Image<T>={id:string;before:T|null;after:T;endpointGuard?:{id:string;revision:number}[];accountGuard?:{id:string;revision:number}[]};
export type ResourceImage=(Image<ReturnType<typeof captureEndpoint>>&{resource:'ENDPOINT'})|(Image<ReturnType<typeof captureAccount>>&{resource:'ACCOUNT'})|(Image<ReturnType<typeof captureGroup>>&{resource:'GROUP'})|(Image<ReturnType<typeof captureIdentity>>&{resource:'IDENTITY'})|(Image<ReturnType<typeof captureMember>>&{resource:'MEMBER'})|VMImage|BusinessImage;
export interface OperationSnapshot {version:1|2|3|4;resources:ResourceImage[];eventIds:string[];replacementIds:string[]}
export async function readImage(tx:Prisma.TransactionClient|PrismaClient,projectId:string,resource:ResourceImage['resource'],id:string){
  if(isBusinessResource(resource))return readBusinessImage(tx,projectId,resource,id);
  if(resource==='ENDPOINT'){const row=await tx.proxyIP.findFirst({where:{id,projectId},include:endpointInclude});return row?captureEndpoint(row):null;}
  if(resource==='ACCOUNT'){const row=await tx.proxyProviderAccount.findFirst({where:{id,projectId}});return row?captureAccount(row):null;}
  if(resource==='GROUP'){const row=await tx.proxyGroup.findFirst({where:{id,projectId}});return row?captureGroup(row):null;}
  // Identities are global; only one linked to this project (an endpoint or a source reference) is readable here.
  if(resource==='IDENTITY'){const row=await tx.proxyIdentity.findFirst({where:{id,OR:[{endpoints:{some:{projectId}}},{sourceRefs:{some:{snapshot:{projectId}}}}]}});return row?captureIdentity(row):null;}
  if(resource!=='MEMBER')return readVMImage(tx,projectId,resource,id);
  const row=await tx.projectMember.findFirst({where:{id,projectId}});return row?captureMember(row):null;
}
export async function assertImagesUnchanged(tx:Prisma.TransactionClient|PrismaClient,projectId:string,snapshot:OperationSnapshot){
  for(const image of snapshot.resources){
    const actual=await readImage(tx,projectId,image.resource,image.id);
    // Business images gained fields over time (account inventory, work kind): compare the fields the image recorded.
    const projected=actual&&(snapshot.version<4||isBusinessResource(image.resource))?Object.fromEntries(Object.keys(image.after).map(key=>[key,(actual as Record<string,unknown>)[key]])):actual;
    if(!actual||JSON.stringify(projected)!==JSON.stringify(image.after))throw new ProxyDomainError('STALE_PREVIEW','Dữ liệu đã được sửa tiếp hoặc gán VM. Không thể hoàn tác đè lên thay đổi mới.');
    if('endpointGuard' in image&&image.endpointGuard){const endpoints=await tx.proxyIP.findMany({where:{projectId},select:{id:true,revision:true},orderBy:{id:'asc'}});if(JSON.stringify(endpoints)!==JSON.stringify(image.endpointGuard))throw new ProxyDomainError('STALE_PREVIEW','Kho đã thay đổi sau khi sửa gói. Không thể hoàn tác gói cũ.');}
    if('accountGuard' in image&&image.accountGuard){const accounts=await tx.proxyProviderAccount.findMany({where:{projectId},select:{id:true,revision:true},orderBy:{id:'asc'}});if(JSON.stringify(accounts)!==JSON.stringify(image.accountGuard))throw new ProxyDomainError('STALE_PREVIEW','Các gói đã thay đổi; không thể hoàn tác làm trùng thông tin đăng nhập.');}
  }
}
export function describeImage(image:ResourceImage){
  if(isBusinessResource(image.resource))return describeBusinessImage(image as BusinessImage);
  if(image.resource==='VM')return {resource:'VM',label:image.after.code,before:image.before?.desiredConfigurationId?'Cấu hình #'+image.before.configurationSequence:'Chưa giao',after:'Cấu hình #'+image.after.configurationSequence,onUndo:'Khôi phục proxy trước đó của VM'};
  if(image.resource==='VM_CONFIG')return {resource:'Cấu hình VM',label:'#'+image.after.version,before:image.before?.status||'Chưa có',after:image.after.status,onUndo:'Khôi phục kế hoạch trước'};
  if(image.resource==='VM_ALLOCATION'){const roles={DESIRED:'Đang dùng',INSTALLED:'Đã cài trước đây',UNCERTAIN:'Giữ để kiểm tra'};return {resource:'Giữ proxy',label:[image.after.ip,image.after.location].filter(Boolean).join(' · '),before:image.before?roles[image.before.role]:'Chưa giữ',after:image.after.releasedAt?'Đã thả':roles[image.after.role],onUndo:'Thả / trả lại vị trí proxy'};}
  if(image.resource==='VM_TASK')return {resource:'Việc cài (dữ liệu cũ)',label:image.after.title,before:image.before?.status||'Chưa có',after:image.after.status,onUndo:'Huỷ việc mới chưa bắt đầu'};
  if(image.resource==='SERVER')return {resource:'Server',label:image.after.code,before:image.before?.code||'Chưa có',after:image.after.archivedAt?'Đã ẩn':image.after.code,onUndo:image.before?'Khôi phục thông tin trước':'Ẩn máy mới; giữ lịch sử'};
  if(image.resource==='ENDPOINT'){const owner=(v:ReturnType<typeof captureEndpoint>)=>v.owner==='SELF'?'TUT':v.owner==='GENJY'?'genjy':v.owner==='OTHER'?'nhóm riêng':'chưa xác định';const changed=!!image.before&&(image.before.owner!==image.after.owner||image.before.groupId!==image.after.groupId);return {resource:'Proxy',label:image.after.host||image.id,before:image.before?`${image.before.inventoryState} · ${image.before.packageCode||'Chưa rõ gói'}`+(changed?' · '+owner(image.before):''):'Chưa có trong kho',after:`${image.after.inventoryState} · ${image.after.packageCode||'Chưa rõ gói'}`+(changed?' · '+owner(image.after):''),onUndo:image.before?(changed?'Khôi phục nhóm và trạng thái trước':'Khôi phục trạng thái trước'):'Thu hồi khỏi kho khả dụng; giữ lịch sử IP'};}
  if(image.resource==='ACCOUNT'){const text=(v:ReturnType<typeof captureAccount>)=>v.label+(v.disabled?' (tắt nhập mới)':'')+(v.renewalStoppedAt?' · ngừng gia hạn':'')+' · nhắc trước '+v.reminderDays+' ngày';return {resource:'Gói proxy',label:image.after.code,before:image.before?text(image.before):'Chưa có',after:text(image.after),onUndo:image.before?'Khôi phục gói trước':'Tắt gói vừa tạo'};}
  if(image.resource==='IDENTITY'){const label=(v:ReturnType<typeof captureIdentity>)=>v.owner==='SELF'?'TUT':v.owner==='GENJY'?(v.subgroup==='PC_CHUNG'?'Chung mooon–Genjy':'Genjy riêng'):v.owner==='OTHER'?'nhóm riêng':'chưa xác định';return {resource:'Phân loại IP',label:image.after.ip,before:image.before?label(image.before):'Chưa có',after:label(image.after),onUndo:'Trả về phân loại trước'};}
  if(image.resource==='GROUP')return {resource:'Nhóm proxy',label:image.after.name,before:image.before?image.before.name+(image.before.archivedAt?' (lưu trữ)':''):'Chưa có',after:image.after.name+(image.after.archivedAt?' (lưu trữ)':''),onUndo:'Khôi phục tên / trạng thái nhóm trước'};
  if(image.resource!=='MEMBER')throw new ProxyDomainError('INVALID_INPUT');
  const format=(v:ReturnType<typeof captureMember>)=>[v.role,...v.allowedModules,...v.capabilities].join(', ');
  return {resource:'Quyền nhân viên',label:'Nhân viên được chỉnh quyền',before:image.before?format(image.before):'Chưa có',after:format(image.after),onUndo:'Khôi phục quyền trước'};
}
