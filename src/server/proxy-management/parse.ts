import {ProxyDomainError, type ParsedProxy} from './types';
const invalid=()=>{throw new ProxyDomainError('INVALID_INPUT','Dòng không phải IP hoặc IP:port:user:pass hợp lệ');};
export function parseProxy(text:string):ParsedProxy {
  const value=text.trim();
  const match=/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+):([^:\s]+):(\S+))?$/.exec(value);
  if(!match) return invalid();
  const octets=match[1].split('.').map(Number);
  if(octets.some(n=>n>255)) return invalid();
  const ip=octets.join('.');
  if(!match[2]) return {ip,port:null,username:null,password:null,format:'BARE'};
  const port=Number(match[2]);
  if(!Number.isInteger(port)||port<1||port>65535) return invalid();
  return {ip,port,username:match[3],password:match[4],format:'FULL'};
}
function clean(line:string){
  let value=line.replace(/[\u200B-\u200D\uFEFF]/g,'').trim();
  // FULL tokens are recognized before presentation cleanup: suffix punctuation is credential data.
  try {if(parseProxy(value).format==='FULL') return value;} catch {}
  if(value.startsWith('|')&&value.endsWith('|')) value=value.slice(1,-1).trim();
  for(const marker of ['**','`']) if(value.startsWith(marker)&&value.endsWith(marker)&&value.length>marker.length*2) value=value.slice(marker.length,-marker.length).trim();
  try {if(parseProxy(value).format==='FULL') return value;} catch {}
  value=value.replace(/\\+$/,'').trim();
  for(const marker of ['**','`']) if(value.startsWith(marker)&&value.endsWith(marker)) value=value.slice(marker.length,-marker.length).trim();
  return value;
}
const heading=(value:string)=>/^(removed|added)\s+ips?\s*:??$/i.exec(value);
function lines(text:string){
  if(text.length>300000) invalid();
  return text.split(/\r?\n/).map(clean).filter(v=>v&&!/^[:\-|\s]+$/.test(v));
}
function unique(values:ParsedProxy[]){
  if(!values.length||values.length>1000) invalid();
  const seen=new Set<string>();for(const p of values){if(seen.has(p.ip)) throw new ProxyDomainError('DUPLICATE_INPUT');seen.add(p.ip);}return values;
}
export function parseProxyList(text:string):ParsedProxy[]{return unique(lines(text).map(parseProxy));}
function splitBox(text:string, expected:'removed'|'added'){
  const values=lines(text);const h=heading(values[0]||'');
  if(h){if(h[1].toLowerCase()!==expected) invalid();values.shift();}
  return unique(values.map(parseProxy));
}
export function parseReplacementLists(removed:string,added:string){
  let old:ParsedProxy[], next:ParsedProxy[];
  const values=lines(removed);
  if(values.some(v=>heading(v)?.[1].toLowerCase()==='added')){
    if(added.trim()) invalid();
    if(/^updated\.\s*check please\.?$/i.test(values[0]||'')) values.shift();
    if(heading(values.shift()||'')?.[1].toLowerCase()!=='removed') invalid();
    const index=values.findIndex(v=>heading(v)?.[1].toLowerCase()==='added');
    if(index<0) invalid();
    old=unique(values.slice(0,index).map(parseProxy));next=unique(values.slice(index+1).map(parseProxy));
  } else {old=splitBox(removed,'removed');next=splitBox(added,'added');}
  if(old.length!==next.length) throw new ProxyDomainError('COUNT_MISMATCH','Số dòng proxy cũ và mới phải bằng nhau');
  return old.map((p,i)=>({old:p,next:next[i],row:i+1}));
}
export function resolvePair(old:ParsedProxy,next:ParsedProxy):ParsedProxy{
  if(next.format==='FULL') return {...next};
  if(old.format!=='FULL') return invalid();
  return {...old,ip:next.ip};
}
export function fullProxy(p:ParsedProxy){if(p.format!=='FULL') invalid();return `${p.ip}:${p.port}:${p.username}:${p.password}`;}
