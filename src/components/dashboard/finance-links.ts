import {links} from '@/lib/links';
// Where each finance number of Tổng quan may lead. A number stays visible when the member may read the summary (PROFIT), but it only
// links to a list the member may open: USDT received → Nhận USDT về team (WITHDRAWALS), costs → Chi phí (COSTS), profit → Lợi nhuận
// (PROFIT). No right → null (shown as plain text). The month (and the day of a chart column) goes along.
export interface FinanceRights {withdrawals:boolean;costs:boolean;profit:boolean}
export function financeTargets(r:FinanceRights,month:string){
  return {
    received:r.withdrawals?links.teamReceipts({month}):null,
    cost:r.costs?links.costs({month}):null,
    profit:r.profit?links.profit({month}):null,
    unverified:r.withdrawals?links.teamReceipts({month,sources:true}):null,
    receivedDay:(date:string)=>r.withdrawals?links.teamReceipts({date}):null,
    costDay:(date:string)=>r.costs?links.costs({date}):null,
  };
}
export type FinanceTargets=ReturnType<typeof financeTargets>;
