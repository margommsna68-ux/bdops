import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {withProxyTransaction} from '../proxy-management/transaction';
import {recordOperation} from '../operation-history/journal';
import {readImage,type ResourceImage,type OperationSnapshot} from '../operation-history/snapshot';
import {authorizeBusiness} from './scope';
import type {BusinessArea} from './types';
import {authorizeTeamCash,type CashArea} from './team-cash-scope';
import {lockCashProject} from './cash-lock';
import {assertOpsToken} from '../ops-api/context';
export const businessHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function businessCollector(tx:Prisma.TransactionClient,scope:ActorScope,version:3|4=3){
 const before=new Map<string,{resource:ResourceImage['resource'];id:string;before:unknown}>();
 const remember=async(resource:ResourceImage['resource'],id:string,created=false)=>{const key=resource+'/'+id;if(!before.has(key))before.set(key,{resource,id,before:created?null:await readImage(tx,scope.projectId,resource,id)});};
 const finish=async():Promise<OperationSnapshot>=>{const resources:ResourceImage[]=[];for(const item of Array.from(before.values()))resources.push({...item,after:await readImage(tx,scope.projectId,item.resource,item.id)} as ResourceImage);return {version,resources,eventIds:[],replacementIds:[]};};return {remember,finish};
}
export type BusinessCollector=Awaited<ReturnType<typeof businessCollector>>;
// authorize: a command with its own narrow right (EARN_PAYOUT, PAYPAL_RECEIPT_RECORD, 21/10/2026) checks it here, inside the transaction and
// before a replay is returned, instead of the module's general write rule; `module` still decides who reads the journal.
export async function runBusinessCommand<T extends Record<string,unknown>>(scope:ActorScope,input:{key:string;payload:unknown;kind:string;module:BusinessArea;reversible?:boolean;cash?:boolean;skipJournalWhenUnchanged?:boolean;authorize?:(tx:Prisma.TransactionClient)=>Promise<ActorScope>},fn:(tx:Prisma.TransactionClient,images:BusinessCollector,current:ActorScope)=>Promise<T>,db:PrismaClient=prisma){
 if(input.key.length<8||input.key.length>100)throw new ProxyDomainError('INVALID_INPUT');const hash=businessHash({kind:input.kind,module:input.module,payload:input.payload});
 return withProxyTransaction(async tx=>{
  await lockCashProject(tx,scope.projectId);
  await assertOpsToken(tx,scope); // ops API only (no-op for the web): the token must still be valid, in this transaction
  const current=input.authorize?await input.authorize(tx):input.cash?await authorizeTeamCash(scope,input.module as CashArea,true,tx):await authorizeBusiness(scope,input.module,true,tx),prior=await tx.operationJournal.findUnique({where:{projectId_commandKey:{projectId:scope.projectId,commandKey:input.key}}});
  if(prior){if(prior.actorId!==scope.userId)throw new ProxyDomainError('FORBIDDEN');if(prior.requestHash!==hash)throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');const undo=await tx.operationJournal.findUnique({where:{undoOfId:prior.id}});return {...JSON.parse(decrypt(prior.resultCipher!)) as T,replay:true,undone:!!undo};}
  const images=await businessCollector(tx,current,input.cash||current.teamCashEnabled?4:3),result=await fn(tx,images,current),snapshot=await images.finish();
  if(input.skipJournalWhenUnchanged&&!snapshot.resources.length)return {...result,replay:false,undone:false};
  await recordOperation(tx,{scope:current,kind:input.kind,summary:{count:snapshot.resources.length},snapshot,reversible:input.reversible,accessModule:input.module,commandKey:input.key,requestHash:hash,resultCipher:encrypt(JSON.stringify(result))});
  await tx.auditLog.create({data:{projectId:scope.projectId,userId:scope.userId,action:input.kind,entity:'BusinessOperation',entityId:input.key,changes:{count:snapshot.resources.length}}});return {...result,replay:false,undone:false};
 },db);
}
