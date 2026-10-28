import {z} from 'zod';
import type {PrismaClient} from '@prisma/client';
import {currentOpsAuth} from '../ops-api/context';
import {ProxyDomainError} from '../proxy-management/types';
import {assertTelegramOwner,TelegramOwner,telegramBindingHash} from './telegram-binding';
import {createTelegramFleetHandler,TelegramFleetCommand} from './telegram';
const Body=z.object({projectId:TelegramOwner.shape.projectId,bridgeId:TelegramOwner.shape.bridgeId,chatId:TelegramOwner.shape.chatId,senderId:TelegramOwner.shape.senderId,updateId:z.string().regex(/^\d{1,20}$/),command:TelegramFleetCommand}).strict();
/** Only called inside the existing authenticated ops route context; no caller identity fields. */
export async function telegramFleetTransport(raw:unknown,db:PrismaClient){
 const b=Body.parse(raw),auth=currentOpsAuth();if(!auth)throw new ProxyDomainError('FORBIDDEN');
 const binding=assertTelegramOwner({tokenId:auth.tokenId,userId:auth.userId,projectId:b.projectId});
 if(binding.bridgeId!==b.bridgeId||binding.chatId!==b.chatId||binding.senderId!==b.senderId)throw new ProxyDomainError('FORBIDDEN','Người gửi Telegram không khớp');
 const verifiedBindingHash=telegramBindingHash(binding);
 return createTelegramFleetHandler({authenticateAndResolve:async()=>({userId:auth.userId,projectId:b.projectId,tokenId:auth.tokenId,verifiedBindingHash})},db)(b,b.command);
}
