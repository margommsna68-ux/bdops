// SDK cell summary (owner brief 20/10/2026, review fix): "chưa dùng" counts UNLINKED only; old codes not confirmed yet (UNCONFIRMED) are
// shown apart and never counted as unused; the representative code / quick copy prefers a truly unused code. Data is never re-stated.
type Item={code:string;state:'UNLINKED'|'LINKED'|'UNCONFIRMED'};
export function sdkSummary(list:Item[]){
  if(!list.length)return 'Chưa có SDK';
  const free=list.filter(s=>s.state==='UNLINKED').length,unconfirmed=list.filter(s=>s.state==='UNCONFIRMED').length;
  return `${list.length} SDK · ${free} chưa dùng`+(unconfirmed?` · ${unconfirmed} chưa xác nhận`:'');
}
/** Money of the VM's CURRENT code only (22/10/2026): its own amount and when it was seen; never a sum of the codes of the VM. null when
 *  the VM has no current code. `other` = the current code is not the one the cell shows first (the line then names it). */
export function currentSdkMoney<T extends Item&{current:boolean;amount:string|null;amountObservedAt:string|null}>(list:T[],shown:T|undefined){
  const cur=list.find(s=>s.current);if(!cur)return null;
  return {code:cur.code,amount:cur.amount,at:cur.amountObservedAt,other:!!shown&&shown.code!==cur.code};
}
export const sdkFirst=<T extends Item>(list:T[]):T|undefined=>list.find(s=>s.state==='UNLINKED')||list.find(s=>s.state==='UNCONFIRMED')||list[0];
