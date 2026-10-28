// PayPal transaction id search (29/10/2026). The owner pastes the id as PayPal shows it ("Mã giao dịch: 8JR02442V10816200");
// a leading label without digits up to ":" is dropped, so "1.2.3.4:8080" (an IP:port) is never cut. Matching is exact and
// case-insensitive on FundTransaction.transactionId; internal ids of receipts recorded without a PayPal id ("OPS-…") only
// match when typed in full.
export function txQuery(raw:string|null|undefined):string{
  return (raw??'').trim().replace(/^[^:\d]{1,40}:\s*/u,'').trim();
}
/** Letters + digits, 12–20 characters, no spaces: what a PayPal transaction id looks like. */
export function looksLikeTxId(raw:string|null|undefined):boolean{
  const s=txQuery(raw);
  return /^[A-Za-z0-9]{12,20}$/.test(s)&&/\d/.test(s)&&/[A-Za-z]/.test(s);
}
/** The only shape a transaction-id lookup accepts (after the label is dropped): letters, digits and "-", 1–64 characters.
 * Prisma `equals`+`mode:'insensitive'` is an ILIKE, so "%" / "_" must never reach the database (review 29/10/2026). */
export const TX_ID_MAX=64;
export function validTxId(id:string):boolean{return /^[A-Za-z0-9-]{1,64}$/.test(id);}
/** Exact, case-insensitive comparison; a query that is not a valid id never matches. */
export function sameTx(id:string|null|undefined,raw:string|null|undefined):boolean{
  const q=txQuery(raw);
  return validTxId(q)&&!!id&&id.toLowerCase()===q.toLowerCase();
}
