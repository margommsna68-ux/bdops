import {z} from 'zod';
import {createHash} from 'node:crypto';
import {ProxyDomainError} from '../proxy-management/types';
const id=z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const TelegramOwner=z.object({bindingId:z.string().uuid(),bridgeId:id,tokenId:id,bridgeUserId:id,ownerUserId:id,projectId:id,chatId:z.string().regex(/^-?\d{1,20}$/),senderId:z.string().regex(/^\d{1,20}$/)}).strict().refine(b=>b.bridgeUserId!==b.ownerUserId);
export type TelegramBinding=z.infer<typeof TelegramOwner>;
export const telegramBindingHash=(b:TelegramBinding)=>createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(TelegramOwner.parse(b)).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
export function telegramOwner(){
 try{return TelegramOwner.parse(JSON.parse(process.env.FLEET_TELEGRAM_OWNER??''));}
 catch{throw new ProxyDomainError('FORBIDDEN','Chưa có ánh xạ chủ Telegram tin cậy');}
}
export function assertTelegramOwner(identity:{tokenId:string;userId:string;projectId:string}){
 const b=telegramOwner();if(b.tokenId!==identity.tokenId||b.bridgeUserId!==identity.userId||b.projectId!==identity.projectId)throw new ProxyDomainError('FORBIDDEN','Thông tin chủ Telegram không khớp');return b;
}
