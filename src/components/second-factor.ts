/** Input hints only. The server always verifies the signed-in person's factor and session. */
export const normalizeSecondFactor=(value:string)=>value.replace(/\s/g,'');
export function validSecondFactor(value:string,totpEnabled?:boolean){
  const code=normalizeSecondFactor(value),pin=/^\d{4,6}$/.test(code),totp=/^\d{6}$/.test(code)||/^[a-z2-7]{5}-?[a-z2-7]{5}$/i.test(code);
  return totpEnabled===true?totp:totpEnabled===false?pin:pin||totp;
}
export const OWN_FACTOR_LABEL='Mã Google Authenticator / PIN của bạn';
