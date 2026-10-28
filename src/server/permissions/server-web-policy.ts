import type {ScopeDB} from './server-scope';
import {assertScopedTargets,assertScopedLoginIds,assertScopedVmIds,hasServerScope} from './server-scope';
import {loadInfrastructureScope} from './infrastructure';
import {ProxyDomainError} from '../proxy-management/types';
// Explicit surfaces: a new project-wide procedure is closed until its server ownership is defined.
export const SERVER_SCOPE_SELF_ROUTES=new Set(['project.list','project.myPinStatus','project.verifyPin','user.hasPin','user.securityStatus','user.verifyPin','user.setPin','user.setOwnPassword','user.changePassword','user.totpBegin','user.totpConfirm','user.heartbeat']);
export const SERVER_SCOPE_GLOBAL_ROUTES=new Set(['project.create','project.listAll','project.allSystemUsers','proxyManagement.backups','proxyManagement.createBackup']);
const PROJECT_READ=new Set(['project.myMembership','project.getById','notification.alerts','businessManagement.access','businessManagement.cashAccess','accountStore.vmAccounts']);
const VM=new Set(['access','workspace','detail','orphanTasks','closeTask','updateVM','updateServer','addVMs','deleteVMs','restoreVMs','deleteServer','restoreServer','copyProxies','proxyCheck','changeProxy','eligible','sdkPreview','sdkApply','sdkHistory','sdkListAdd','sdkUsed','sdkListRemove','sdkPastePreview','sdkPasteApply','sdkSave','sdkLink','sdkConfirm','sdkInfo','sdkStore','sdkDetail','bulkPreview','bulkApply']);
const OPS=new Set(['board','history','setStatus','recreate','balanceHistory','balancePreview','balanceRecord']);
const PROXY=new Set(['access','list','copyEndpoint','copyEndpoints','copyFiltered','copyBlockedEndpoints','copyBlockedFiltered','exportBlocked']);
export async function assertServerWebRequest(db:ScopeDB,userId:string,path:string,rawInput:unknown){
 if(SERVER_SCOPE_SELF_ROUTES.has(path))return;
 if(SERVER_SCOPE_GLOBAL_ROUTES.has(path)){
  if(await db.projectMember.findFirst({where:{userId,serverScope:'SELECTED'},select:{id:true}}))throw new ProxyDomainError('FORBIDDEN','Dữ liệu quản trị toàn hệ thống không thuộc phạm vi server được giao');return;
 }
 const input=rawInput&&typeof rawInput==='object'?rawInput as Record<string,unknown>:{};
 if(typeof input.projectId!=='string'){
  if(await db.projectMember.findFirst({where:{userId,serverScope:'SELECTED'},select:{id:true}}))throw new ProxyDomainError('FORBIDDEN','Chỉ thao tác trong server được giao');return;
 }
 const member=await db.projectMember.findUnique({where:{userId_projectId:{userId,projectId:input.projectId}},select:{serverScope:true}});
 // Preserve existing endpoint rules for non-members (e.g. an ADMIN removing an orphan project).
 if(!member||member.serverScope==='ALL')return;
 const current=await loadInfrastructureScope(db,userId,input.projectId);if(!hasServerScope(current))return;
 if(path==='appleCheck.overview')return; // service filters jobs by current assigned account/server; no configuration or common-stock secrets.
 if(path==='accountStore.store'||path==='businessManagement.copyAccount'||path==='businessManagement.copyVmAccount'){
  if(!['ADMIN','MODERATOR'].includes(current.role)||!current.allowedModules?.includes('INFRASTRUCTURE'))throw new ProxyDomainError('FORBIDDEN');
  if(path==='businessManagement.copyAccount'||path==='businessManagement.copyVmAccount'){
   if(path==='businessManagement.copyAccount'&&input.kind!=='GMAIL'||typeof input.id!=='string')throw new ProxyDomainError('FORBIDDEN','Chỉ thông tin Gmail / Apple ID đang gán trong phạm vi server');
   await assertScopedLoginIds(db,current,[input.id]);
   if(path==='businessManagement.copyVmAccount'){
    const binding=input.vmBinding as {vmId?:unknown}|undefined;
    if(!binding||typeof binding.vmId!=='string')throw new ProxyDomainError('FORBIDDEN');
    await assertScopedVmIds(db,current,[binding.vmId]);
   }
  }
  return;
 }
 const [area,action]=path.split('.');
 // These services resolve stored operation IDs and recheck their server inside the transaction.
 if(area==='fleetCommands'&&['control','create','detail','list','cancel'].includes(action)){
  await assertScopedTargets(db,current,input);return;
 }
 if(!PROJECT_READ.has(path)&&!(area==='vmManagement'&&VM.has(action))&&!(area==='vmOps'&&OPS.has(action))&&!(area==='proxyManagement'&&PROXY.has(action)))throw new ProxyDomainError('FORBIDDEN','Thao tác kho chung hoặc toàn dự án không thuộc phạm vi server được giao');
 if(area==='vmManagement'&&['bulkPreview','bulkApply'].includes(action)&&!['SDK','NOTE'].includes(String(input.kind)))throw new ProxyDomainError('FORBIDDEN','Kho chung do ADMIN cấp vào server trước');
 await assertScopedTargets(db,current,input,{write:!(area==='proxyManagement'&&/^(copy|export)/.test(action))});
}
