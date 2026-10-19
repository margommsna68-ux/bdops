import type {PrismaClient} from '@prisma/client';
// Permanently removes one project and every row that belongs to it, in foreign-key order.
// Proxy identities are global (one per IP); only identities left without any endpoint, source reference or event are removed.
export async function destroyProject(db:PrismaClient,projectId:string){
  const project=await db.project.findUnique({where:{id:projectId},select:{code:true,name:true}});
  if(!project) throw new Error('PROJECT_NOT_FOUND');
  await db.$transaction(async tx=>{
    const where={projectId},vmWhere={server:{projectId}};
    const identityIds=(await tx.proxyIP.findMany({where:{projectId,identityId:{not:null}},select:{identityId:true},distinct:['identityId']})).map(r=>r.identityId!);
    await tx.vMTask.deleteMany({where:{vm:vmWhere}});
    await tx.vMProxyAllocation.deleteMany({where});
    await tx.virtualMachine.updateMany({where:vmWhere,data:{desiredConfigurationId:null,installedConfigurationId:null,proxyId:null,gmailId:null}});
    await tx.vMConfiguration.deleteMany({where});
    await tx.vMSdkHistory.deleteMany({where});
    await tx.sdkEvent.deleteMany({where});await tx.sdkRecord.deleteMany({where});
    await tx.proxyAssignmentHistory.deleteMany({where:{OR:[{proxy:{projectId}},{vm:vmWhere}]}});
    await tx.businessWorkItem.deleteMany({where});
    await tx.earnWithdrawal.deleteMany({where});
    await tx.fundTransaction.deleteMany({where});
    await tx.earnPayoutRequest.deleteMany({where});await tx.vmOperation.deleteMany({where});await tx.vmOpsEvent.deleteMany({where});await tx.vmCycle.deleteMany({where});
    await tx.agentSale.deleteMany({where});
    await tx.withdrawal.deleteMany({where});
    await tx.agentPaypalEmail.deleteMany({where});
    await tx.payPalEmail.deleteMany({where});
    await tx.holderMergeTarget.deleteMany({where});
    await tx.earnAppPayout.deleteMany({where});await tx.earnAppAccount.deleteMany({where});
    await tx.gmailAccount.updateMany({where,data:{batchId:null}});
    await tx.payPalAccount.updateMany({where,data:{batchId:null}});
    await tx.accountPurchaseBatch.deleteMany({where});
    await tx.costRecord.deleteMany({where});
    await tx.teamReceipt.deleteMany({where});
    await tx.collectorExpense.deleteMany({where});
    await tx.virtualMachine.deleteMany({where:vmWhere});
    await tx.gmailAccount.deleteMany({where});
    await tx.payPalAccount.deleteMany({where});
    await tx.proxyReplacement.deleteMany({where});
    await tx.proxyStatusEvent.deleteMany({where});
    await tx.proxySourceReference.deleteMany({where:{OR:[{snapshot:{projectId}},{endpoint:{projectId}}]}});
    await tx.proxyBatch.deleteMany({where});
    await tx.proxySourceSnapshot.deleteMany({where});
    await tx.proxyIP.deleteMany({where});
    await tx.proxyGroup.deleteMany({where});
    if(identityIds.length) await tx.proxyIdentity.deleteMany({where:{id:{in:identityIds},endpoints:{none:{}},sourceRefs:{none:{}},events:{none:{}}}});
    await tx.proxyProviderAccount.deleteMany({where});
    await tx.server.deleteMany({where});
    await tx.splitAllocation.deleteMany({where:{split:{projectId}}});
    await tx.profitSplit.deleteMany({where});
    await tx.partner.deleteMany({where});
    await tx.deleteRequest.deleteMany({where});
    await tx.auditLog.deleteMany({where});
    await tx.editHistory.deleteMany({where});
    await tx.operationJournal.deleteMany({where});
    await tx.projectMember.deleteMany({where});
    await tx.project.delete({where:{id:projectId}});
  },{timeout:120000,maxWait:10000});
  return {deleted:true as const,code:project.code,name:project.name};
}
