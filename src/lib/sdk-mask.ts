/** SDK codes never leave the web in full through the ops API (owner decision 23/10/2026): first 4 + "…" + last 4. */
export function maskSdk(code:string|null|undefined){
  if(!code)return null;
  if(code.length<12)return '…';
  return code.slice(0,4)+'…'+code.slice(-4);
}
