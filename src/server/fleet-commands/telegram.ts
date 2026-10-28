import {z} from 'zod';
import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError} from '../proxy-management/types';
import {withTelegramDelegation} from './telegram-delegation';
import {FleetCreate,FleetIdentity,FleetList,FleetControl} from './schema';
import {createFleetCommand,readFleetCommand,listFleetCommands,cancelFleetCommand,readFleetControl} from './service';

// Internal adapter only. The existing authenticated GEN2 bridge supplies this verifier,
// validates its transport/sender mapping on EVERY call and never takes identity from command text.
// No endpoint, bot token, second poller or caller-supplied role is introduced here.
export interface TelegramFleetBridge {
 authenticateAndResolve(envelope:unknown):Promise<{userId:string;projectId:string;tokenId:string;verifiedBindingHash:string}|null>;
}
export const TelegramFleetCommand=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('control'),serverId:FleetControl.shape.serverId,vmId:FleetControl.shape.vmId}).strict(),
 z.object({kind:z.literal('create'),command:FleetCreate.omit({projectId:true})}).strict(),
 z.object({kind:z.literal('detail'),operationId:FleetIdentity.shape.operationId}).strict(),
 z.object({kind:z.literal('cancel'),operationId:FleetIdentity.shape.operationId}).strict(),
 z.object({kind:z.literal('list'),serverId:FleetList.shape.serverId}).strict(),
]);
export function createTelegramFleetHandler(bridge:TelegramFleetBridge,db:PrismaClient=prisma){
 return async(envelope:unknown,raw:unknown)=>{
  const identity=await bridge.authenticateAndResolve(envelope);
  if(!identity)throw new ProxyDomainError('FORBIDDEN','Người gửi Telegram chưa được xác thực / gán người dùng dự án');
  const input=TelegramFleetCommand.parse(raw);
  return withTelegramDelegation(identity,async b=>{
  const scope={userId:b.ownerUserId,projectId:b.projectId,role:'USER' as const,capabilities:[] as string[]};
  if(input.kind==='control')return readFleetControl(scope,{projectId:identity.projectId,serverId:input.serverId,vmId:input.vmId},db);
  if(input.kind==='create')return createFleetCommand(scope,{...input.command,projectId:identity.projectId},db,{source:'TELEGRAM',tokenId:identity.tokenId});
  if(input.kind==='list')return listFleetCommands(scope,{projectId:identity.projectId,serverId:input.serverId},db);
  const target={projectId:identity.projectId,operationId:input.operationId};
  return input.kind==='cancel'?cancelFleetCommand(scope,target,db):readFleetCommand(scope,target,db);
  });
 };
}
