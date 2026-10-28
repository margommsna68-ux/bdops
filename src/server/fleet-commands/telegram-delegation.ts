import {AsyncLocalStorage} from 'node:async_hooks';
import type {FleetCommand,Prisma} from '@prisma/client';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {assertOpsToken,currentOpsAuth,runWithOpsAuth} from '../ops-api/context';
import {authorizeVM} from '../vm-management/repository';
import {assertScopedTargets} from '../permissions/server-scope';
import {type InfrastructureAction} from '../permissions/infrastructure';
import {assertTelegramOwner,telegramOwner,telegramBindingHash,TelegramOwner,type TelegramBinding} from './telegram-binding';
const context=new AsyncLocalStorage<{binding:TelegramBinding;hash:string}>();
const transactionBindings=new WeakMap<object,string>();
const EVENT='telegram-binding-v1';
const forbidden=()=>new ProxyDomainError('FORBIDDEN','Uỷ quyền Telegram không còn hợp lệ');
export const currentTelegramDelegation=()=>context.getStore();
/** Server-only context. Actual authenticated USER bridge identity is never replaced in OpsAuth. */
export function withTelegramDelegation<T>(identity:{tokenId:string;userId:string;projectId:string;verifiedBindingHash:string},fn:(b:TelegramBinding)=>Promise<T>){
 const auth=currentOpsAuth();if(!auth||auth.tokenId!==identity.tokenId||auth.userId!==identity.userId||auth.operation!=='VM_OPS')throw forbidden();
 const b=assertTelegramOwner(identity),hash=telegramBindingHash(b);
 if(identity.verifiedBindingHash!==hash)throw forbidden();
 return context.run({binding:Object.freeze({...b}),hash},()=>fn(b));
}
export function assertTelegramContextCurrent(tx?:Prisma.TransactionClient){
 const d=context.getStore(),expected=tx?transactionBindings.get(tx):undefined;
 if((d||expected)&&((d&&telegramBindingHash(telegramOwner())!==d.hash)||(expected&&telegramBindingHash(telegramOwner())!==expected)))throw forbidden();
}
async function principals(tx:Prisma.TransactionClient,b:TelegramBinding,action:InfrastructureAction,targets:unknown){
 const hash=telegramBindingHash(b),prior=transactionBindings.get(tx);
 if(telegramBindingHash(telegramOwner())!==hash||prior&&prior!==hash)throw forbidden();transactionBindings.set(tx,hash);
 const bridge:ActorScope={userId:b.bridgeUserId,projectId:b.projectId,role:'USER',capabilities:[]},owner:ActorScope={...bridge,userId:b.ownerUserId};
 // Generic token validation keeps token.userId === auth.userId === bridge.userId.
 const bridgeScope=await runWithOpsAuth({tokenId:b.tokenId,userId:b.bridgeUserId,operation:'VM_OPS',targets},async()=>{await assertOpsToken(tx,bridge);return authorizeVM(bridge,'ASSIGN',tx);});
 if(bridgeScope.role!=='USER')throw forbidden();
 const ownerScope=await authorizeVM(owner,action,tx);if(ownerScope.role!=='ADMIN')throw forbidden();
 const person=await tx.user.findUnique({where:{id:b.ownerUserId},select:{password:true,loginLockedAt:true}});
 if(!person?.password||person.loginLockedAt&&person.loginLockedAt.getTime()+30*60000>Date.now())throw forbidden();
 await assertScopedTargets(tx,bridgeScope,targets);await assertScopedTargets(tx,ownerScope,targets);
 if(telegramBindingHash(telegramOwner())!==telegramBindingHash(b))throw forbidden();
 return {bridgeScope,ownerScope};
}
/** Only fleet-service transactions inside the explicit trusted adapter can use the two-principal path. */
export async function telegramTransaction(tx:Prisma.TransactionClient,scope:ActorScope,targets:unknown={}){
 const d=context.getStore();if(!d)return null;
 assertTelegramContextCurrent();if(scope.userId!==d.binding.ownerUserId||scope.projectId!==d.binding.projectId)throw forbidden();
 const auth=currentOpsAuth();if(!auth||auth.tokenId!==d.binding.tokenId||auth.userId!==d.binding.bridgeUserId)throw forbidden();
 return principals(tx,d.binding,'READ',targets);
}
type Requester=Pick<FleetCommand,'projectId'|'serverId'|'vmId'|'requesterId'|'requesterTokenId'|'action'>&{operationId?:string};
export async function assertTelegramProof(tx:Prisma.TransactionClient,c:Requester){
 const b=telegramOwner(),hash=telegramBindingHash(b);
 if(c.projectId!==b.projectId||c.requesterId!==b.ownerUserId||c.requesterTokenId!==b.tokenId||!c.operationId)throw forbidden();
 const event=await tx.fleetCommandEvent.findUnique({where:{operationId_eventId:{operationId:c.operationId,eventId:EVENT}}});
 const saved=TelegramOwner.safeParse(event?.detail);
 if(!event||event.kind!=='TELEGRAM_BINDING'||event.requestHash!==hash||!saved.success||telegramBindingHash(saved.data)!==hash)throw forbidden();
 return b;
}
export async function telegramRequesterAuth(tx:Prisma.TransactionClient,c:Requester,admission=false){
 let b:TelegramBinding;
 if(admission){const d=context.getStore();if(!d)throw forbidden();assertTelegramContextCurrent();b=d.binding;if(c.projectId!==b.projectId||c.requesterId!==b.ownerUserId||c.requesterTokenId!==b.tokenId)throw forbidden();}
 else b=await assertTelegramProof(tx,c);
 return (await principals(tx,b,c.action==='CHECK_HEALTH'?'ASSIGN':'MANAGE',{serverId:c.serverId,vmId:c.vmId})).ownerScope;
}
export async function recordTelegramProof(tx:Prisma.TransactionClient,c:FleetCommand){
 const d=context.getStore();if(!d)throw forbidden();assertTelegramContextCurrent();
 await tx.fleetCommandEvent.create({data:{operationId:c.operationId,eventId:EVENT,kind:'TELEGRAM_BINDING',requestHash:d.hash,detail:{...d.binding}}});
 await tx.auditLog.create({data:{projectId:c.projectId,userId:d.binding.ownerUserId,action:'FLEET_TELEGRAM_DELEGATE',entity:'FleetCommand',entityId:c.operationId,changes:{bindingHash:d.hash,bridgeUserId:d.binding.bridgeUserId,ownerUserId:d.binding.ownerUserId,tokenId:d.binding.tokenId}}});
}
