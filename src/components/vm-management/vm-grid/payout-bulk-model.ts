import {compareCodes} from '@/server/proxy-management/package-terms';
import {refusedAnswer} from './payout-frame-model';
// Bulk actions (owner 28/10/2026): "Đã rút N dòng", "Tiền đã về N dòng", "Tạo lại N VM", "Ghi nhận đã tạo lại N VM". Pure rules, no
// React: which selected rows a bulk action takes (and why the others are skipped), the sequential run, and the per-row journal.
export type BulkKind='SEND'|'RECEIVE'|'RECREATE'|'RECORD_RECREATED';
export interface BulkRequest {id:string;state:string;submission:string;phase:string;money:unknown|null}
export interface BulkRow {vmId:string;serverId:string;server:string;code:string;fleetEnrolled?:boolean;
  ops:{cycle:number;milestone?:string|null;merge?:{role:string}|null;request:BulkRequest|null}|undefined}
export const MANUAL_RECREATE='Server chưa nối điều khiển: Tạo lại trên máy rồi bấm Ghi nhận đã tạo lại';
const NOT_RECREATE='Không ở mốc “Chờ tạo lại” (tiền chưa về đủ và EarnApp không SUS)';
/** Why a row is not taken by this bulk action; '' = ready. The server checks every rule again. */
export function bulkReason(r:BulkRow,kind:BulkKind):string{
  const o=r.ops;if(!o)return 'Chưa đọc được trạng thái tiền của VM';
  if(kind==='RECREATE'||kind==='RECORD_RECREATED'){
    if(o.milestone!=='RECREATE')return NOT_RECREATE;
    return kind==='RECREATE'&&!r.fleetEnrolled?MANUAL_RECREATE:'';
  }
  if(o.merge?.role==='MEMBER')return 'VM đã gộp: lệnh rút và tiền về ghi ở VM chính';
  const q=o.request;if(!q)return 'Chưa có yêu cầu rút';
  if(kind==='SEND'){
    if(q.state!=='REQUESTED')return 'Yêu cầu đã thất bại / huỷ / mất do SUS';
    if(q.submission==='SENT')return 'Đã rút (đã ghi trước đó)';
    if(q.submission==='UNKNOWN')return 'Chưa rõ đã rút chưa: xử lý ở khung tiền của VM';
    return '';
  }
  if(!q.money)return 'Cần quyền xem số tiền của yêu cầu';
  if(q.phase==='LOST'||q.state==='LOST_SUS')return ''; // late money after SUS
  if(q.state!=='REQUESTED')return 'Yêu cầu đã thất bại / huỷ';
  if(q.submission!=='SENT')return 'Chưa ghi "Đã rút" trên yêu cầu này';
  if(q.phase==='REVIEW')return 'Cần đối chiếu tiền ở Kho tài khoản';
  if(q.phase!=='WAITING')return 'Không còn tiền chờ về';
  return '';
}
export function bulkPlan<R extends BulkRow>(rows:R[],kind:BulkKind):{ready:R[];skipped:{row:R;why:string}[]}{
  const ready:R[]=[],skipped:{row:R;why:string}[]=[],seen=new Set<string>();
  for(const row of rows){
    let why=bulkReason(row,kind);
    const rid=kind==='SEND'||kind==='RECEIVE'?row.ops?.request?.id:undefined;
    if(!why&&rid){if(seen.has(rid))why='Cùng yêu cầu với dòng khác đã chọn';else seen.add(rid);}
    if(why)skipped.push({row,why});else ready.push(row);
  }
  return {ready,skipped};
}
export type RunResult<T,V>={item:T;ok:true;value:V}|{item:T;ok:false;error:unknown};
/** One row after the other; an error on one row (revision conflict, refusal, lost answer) never stops the next. */
export async function runSequential<T,V>(items:T[],fn:(item:T)=>Promise<V>,stop?:()=>boolean):Promise<RunResult<T,V>[]>{
  const out:RunResult<T,V>[]=[];
  for(const item of items){
    if(stop?.())break;
    try{out.push({item,ok:true,value:await fn(item)});}catch(error){out.push({item,ok:false,error});}
  }
  return out;
}
/** "Tạo lại N VM" confirmation: how many VMs on each server, servers in natural order. */
export function serverCounts(rows:{server:string}[]){
  const m=new Map<string,number>();for(const r of rows)m.set(r.server,(m.get(r.server)??0)+1);
  return [...m].sort((a,b)=>compareCodes(a[0],b[0])).map(([server,count])=>({server,count}));
}
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type JournalOutcome={outcome:'DONE'}|{outcome:'REFUSED'|'UNKNOWN'|'STUCK';error:unknown}|{outcome:'NOSTORE'};
/**
 * One row = one command with one key. The exact command is written to the tab before sending; success clears it. A definite refusal of
 * a first send recorded nothing (cleared); a lost answer keeps it (retry sends the same); a refused retry is an answer about the
 * current state, not about the lost first send: the command stays until the person drops it after reconciling ("STUCK").
 */
export async function runJournaled(store:Store|null,storageKey:string,command:unknown,retry:boolean,send:()=>Promise<unknown>):Promise<JournalOutcome>{
  if(!retry){try{if(!store)throw new Error();store.setItem(storageKey,JSON.stringify(command));}catch{return {outcome:'NOSTORE'};}}
  try{await send();}catch(error){
    if(refusedAnswer(error)){
      if(!retry){try{store?.removeItem(storageKey);}catch{/* a retained key only replays */}return {outcome:'REFUSED',error};}
      return {outcome:'STUCK',error};
    }
    return {outcome:'UNKNOWN',error};
  }
  try{store?.removeItem(storageKey);}catch{/* a retained key only replays */}
  return {outcome:'DONE'};
}
export function readJournal<T>(store:Store|null,storageKey:string):T|null{try{const s=store?.getItem(storageKey);return s?JSON.parse(s) as T:null;}catch{return null;}}
/**
 * Body of "Tiền đã về" from a checked entry (receiptCheck): the exact PayPal amount, today's moment or noon (Bangkok) of the chosen
 * day, an optional transaction id, and settleRemainder ("Chốt luôn, phần thiếu là phí") only while the amount is below what is open.
 */
export function receiptBody(c:{valid:boolean;amount:string|null;showSettle:boolean},o:{currency:string;date:string;today:string;txid:string;settle:boolean;now?:Date}){
  if(!c.valid||!c.amount||!o.date)return null;
  return {amount:c.amount,currency:o.currency,receivedAt:o.date===o.today?(o.now??new Date()).toISOString():o.date+'T12:00:00+07:00',transactionId:o.txid.trim()||null,...(c.showSettle?{settleRemainder:o.settle}:{})};
}
