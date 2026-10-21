import type {Prisma,PrismaClient} from '@prisma/client';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
// Who may read / write the accumulated money of SDK codes (Tiền tích luỹ SDK), independent review 22/10/2026: ONE rule for the ops API
// and every web path (SDK cell, SDK frame, Kho SDK, Dán bảng, bulk, history). It is the EarnApp balance rule (vm-ops/balance.ts):
// write = ADMIN / MODERATOR with Server / VM write, or the capability EARN_BALANCE; read = the PayPal money rights or the write right.
// Codes, positions and notes keep their own rights (Server / VM ASSIGN); money is never silently dropped from a request.
type Db=PrismaClient|Prisma.TransactionClient;
export interface SdkMoneyRights {read:boolean;write:boolean}
export async function sdkMoneyRights(scope:ActorScope,db:Db):Promise<SdkMoneyRights>{
  // Loaded at call time (vm-ops/balance imports vm-ops/ops, which imports sdk-store): never at module load.
  const {balanceRights}=await import('../vm-ops/balance');
  const r=await balanceRights(scope,db);return {read:r.read,write:r.write};
}
/** A command that carries money (a figure or an explicit clear) needs the write right; checked inside the transaction. */
export const carriesMoney=(items:{amount?:string|null}[])=>items.some(i=>i.amount!==undefined);
export const SDK_MONEY_WRITE_REFUSAL='Ghi / sửa tiền tích luỹ SDK cần quyền "Ghi kiểm tra tiền EarnApp" (EARN_BALANCE) hoặc quản lý dự án; mã và ghi chú vẫn ghi được không kèm tiền';
export async function assertSdkMoneyWrite(scope:ActorScope,db:Db){
  if(!(await sdkMoneyRights(scope,db)).write)throw new ProxyDomainError('FORBIDDEN',SDK_MONEY_WRITE_REFUSAL);
}
/** Detail of an SDK event without the money it may carry (amount, before / after, source, evidence); other facts stay. */
export function maskSdkEventDetail(detail:Record<string,unknown>|null){
  if(!detail)return detail;
  const hidden=['amount','from','to','source','evidence'].filter(k=>k in detail);
  if(!hidden.length)return detail;
  const rest=Object.fromEntries(Object.entries(detail).filter(([k])=>!hidden.includes(k)));
  return {...rest,moneyHidden:true};
}
