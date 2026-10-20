// SDK cell summary (owner brief 20/10/2026, review fix): "chưa dùng" counts UNLINKED only; old codes not confirmed yet (UNCONFIRMED) are
// shown apart and never counted as unused; the representative code / quick copy prefers a truly unused code. Data is never re-stated.
type Item={code:string;state:'UNLINKED'|'LINKED'|'UNCONFIRMED'};
export function sdkSummary(list:Item[]){
  if(!list.length)return 'Chưa có SDK';
  const free=list.filter(s=>s.state==='UNLINKED').length,unconfirmed=list.filter(s=>s.state==='UNCONFIRMED').length;
  return `${list.length} SDK · ${free} chưa dùng`+(unconfirmed?` · ${unconfirmed} chưa xác nhận`:'');
}
export const sdkFirst=<T extends Item>(list:T[]):T|undefined=>list.find(s=>s.state==='UNLINKED')||list.find(s=>s.state==='UNCONFIRMED')||list[0];
