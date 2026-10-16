// Pure helpers shared by the server (create VMs) and the browser (live count before saving). No database access here.
export class VmCodeError extends Error {}
const TAIL=/^([a-zA-Z0-9_-]*?)(\d+)$/;
// "Từ"–"Đến": same prefix, numeric tail, start ≤ end, at most 500 codes; the start code's zero padding is kept (VM_001 → VM_012).
export function expandVmRange(from:string,to:string):string[]{
  const a=TAIL.exec(from.trim()),b=TAIL.exec(to.trim());
  if(!a||!b||a[1]!==b[1]) throw new VmCodeError('Hai mã phải cùng tiền tố và kết thúc bằng số, ví dụ VM_001 → VM_080');
  const start=Number(a[2]),end=Number(b[2]),width=a[2].length;
  if(start>end) throw new VmCodeError('Mã đầu phải nhỏ hơn hoặc bằng mã cuối');
  if(end-start+1>500) throw new VmCodeError('Tối đa 500 VM mỗi lần');
  return Array.from({length:end-start+1},(_,i)=>a[1]+String(start+i).padStart(width,'0'));
}
// Pasted list of codes that are not consecutive: split on spaces, commas, semicolons or new lines.
export function splitVmCodes(text:string){return Array.from(new Set(text.split(/[\s,;]+/).map(s=>s.trim()).filter(Boolean)));}
export const validVmCode=(code:string)=>/^[a-zA-Z0-9_-]{1,64}$/.test(code);
// Next code when every code on the server follows one clear pattern (same prefix and digit width); otherwise no suggestion.
export function suggestNextVmCode(codes:string[]):string|null{
  const parts=codes.map(c=>TAIL.exec(c)).filter((m):m is RegExpExecArray=>!!m);
  if(!parts.length||parts.length!==codes.length) return null;
  const prefix=parts[0][1],width=parts[0][2].length;
  if(parts.some(m=>m[1]!==prefix||m[2].length!==width)) return null;
  const next=Math.max(...parts.map(m=>Number(m[2])))+1;
  return prefix+String(next).padStart(width,'0');
}
