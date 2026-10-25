import {parseLoginLines,parsePaypalLines,type LoginFormat} from '@/server/account-store/parse';
// Provisional quantity comes from distinct valid pasted identities while money-free classification loads.
// ImportPanel then uses the exact matching classification to exclude EXISTS/ADD from new purchases.
// An explicit actual-quantity override still supports partially delivered purchases.
export function countAccountPurchaseQuantity(text:string,kind:'LOGIN'|'PAYPAL',format:LoginFormat='STANDARD'):number{
 const keys=kind==='PAYPAL'?parsePaypalLines(text).filter(r=>!r.error).map(r=>r.code.toLowerCase()):parseLoginLines(text,format).filter(r=>!r.error).map(r=>r.email);
 return new Set(keys).size;
}
