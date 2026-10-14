import type {PrismaClient} from '@prisma/client';
import {TRPCError} from '@trpc/server';
const denied=()=>{throw new TRPCError({code:'BAD_REQUEST',message:'Tài nguyên không thuộc dự án đang thao tác'});};
export async function assertLegacyInfrastructureTargets(db:PrismaClient,projectId:string,path:string,input:Record<string,unknown>){
  const ids=(...values:unknown[])=>Array.from(new Set(values.flatMap(v=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'):typeof v==='string'?[v]:[])));
  const own=async(values:string[],model:any,where:Record<string,unknown>)=>{if(values.length&&await model.count({where:{id:{in:values},...where}})!==values.length) denied();};
  const namespace=path.split('.')[0];
  await own(ids(input.serverId,namespace==='server'?input.id:undefined,namespace==='server'?input.ids:undefined),db.server,{projectId});
  await own(ids(input.vmId,input.vmIds,namespace==='vm'?input.id:undefined,namespace==='vm'?input.ids:undefined),db.virtualMachine,{server:{projectId},OR:[{proxyId:null},{proxy:{projectId,identityId:null}}]});
  await own(ids(input.proxyId,namespace==='proxy'?input.id:undefined,namespace==='proxy'?input.ids:undefined,input.field==='proxy'?input.itemIds:undefined),db.proxyIP,{projectId,identityId:null});
  await own(ids(input.gmailId,input.field==='gmail'?input.itemIds:undefined),db.gmailAccount,{projectId});
}
export async function assertDeleteTarget(db:PrismaClient,projectId:string,entity:string,entityId:string){
  const models:Record<string,any>={FundTransaction:db.fundTransaction,Withdrawal:db.withdrawal,PayPalAccount:db.payPalAccount,Server:db.server,VirtualMachine:db.virtualMachine,ProxyIP:db.proxyIP,GmailAccount:db.gmailAccount,CostRecord:db.costRecord,ProfitSplit:db.profitSplit,VMTask:db.vMTask};
  const model=models[entity];if(!model) denied();
  const scope=entity==='VirtualMachine'?{server:{projectId}}:entity==='VMTask'?{vm:{server:{projectId}}}:{projectId};
  if(!await model.findFirst({where:{id:entityId,...scope},select:{id:true}})) denied();
  if(entity==='Server'||entity==='VirtualMachine'){const item=await model.findFirst({where:{id:entityId,...scope},select:{managed:true}});if(item?.managed)throw new TRPCError({code:'PRECONDITION_FAILED',message:'Máy có cấu hình và lịch sử; dùng luồng ẩn máy mới thay vì xoá'});}
  if(['GmailAccount','PayPalAccount','CostRecord','FundTransaction','Withdrawal','ProfitSplit'].includes(entity)){const item=await model.findFirst({where:{id:entityId,...scope},select:{businessManaged:true}});if(item?.businessManaged||await db.operationJournal.findFirst({where:{projectId,kind:{startsWith:'BUSINESS_'}},select:{id:true}}))throw new TRPCError({code:'PRECONDITION_FAILED',message:'Dữ liệu business có lịch sử; dùng luồng ẩn/thu hồi thay vì xoá'});}
  if(entity==='VMTask'){const task=await db.vMTask.findFirst({where:{id:entityId,...scope},select:{configurationId:true,vm:{select:{managed:true}}}});if(task?.configurationId||task?.vm.managed)throw new TRPCError({code:'PRECONDITION_FAILED',message:'Việc cài có cấu hình và lịch sử; dùng luồng VM mới thay vì xoá'});}
}
export async function assertProjectCanBeDestroyed(db:PrismaClient,projectId:string){
  const [project,proxy,batch,source,account,managed,journal]=await Promise.all([
    db.project.findUnique({where:{id:projectId},select:{settings:true}}),
    db.proxyIP.findFirst({where:{projectId,identityId:{not:null}},select:{id:true}}),
    db.proxyBatch.findFirst({where:{projectId},select:{id:true}}),
    db.proxySourceSnapshot.findFirst({where:{projectId},select:{id:true}}),
    db.proxyProviderAccount.findFirst({where:{projectId},select:{id:true}}),
    db.server.findFirst({where:{projectId,managed:true},select:{id:true}}),
    db.operationJournal.findFirst({where:{projectId},select:{id:true}}),
  ]);
  if((project?.settings as {businessMode?:string}|null)?.businessMode==='PROXY_VM'||proxy||batch||source||account||managed||journal) throw new TRPCError({code:'PRECONDITION_FAILED',message:'Dự án có kho proxy, VM hoặc lịch sử. Cần quy trình lưu trữ; không xoá bằng luồng cũ.'});
}
