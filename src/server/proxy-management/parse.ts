import {ProxyDomainError, type IssueCode, type ParsedProxy} from './types';
export const INVALID_LINE='Dòng không phải IP hoặc IP:port:user:pass hợp lệ';
const invalid=()=>{throw new ProxyDomainError('INVALID_INPUT',INVALID_LINE);};
// One pasted line after presentation cleanup. proxy is null when the line could not be read (issue says why) or when it is missing.
export interface InputLine {row:number;raw:string;proxy:ParsedProxy|null;issue?:{code:IssueCode;message:string}}
// Line N of the Removed box with line N of the Added box. A side is null when that box has no line at this position (blank or shorter list).
export interface ReplacementPairInput {row:number;old:InputLine|null;next:InputLine|null}
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
  let value=line.replace(/[​-‍﻿]/g,'').trim();
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
const isBlank=(value:string)=>!value||/^[:\-|\s]+$/.test(value);
// Every line in order, blanks kept, so positions stay meaningful for pairing.
function rawLines(text:string){
  if(text.length>300000) invalid();
  return text.split(/\r?\n/).map(clean).map(v=>isBlank(v)?'':v);
}
function toLine(row:number,raw:string):InputLine{
  try{return {row,raw,proxy:parseProxy(raw)};}catch{return {row,raw,proxy:null,issue:{code:'INVALID_INPUT',message:INVALID_LINE}};}
}
function bounded(values:string[]){if(!values.length||values.length>1000) invalid();return values;}
// Purchase / BLOCKED lists: blank lines carry nothing, so rows are numbered over the non-blank lines. Malformed lines stay in place with an issue.
export function parseProxyRows(text:string):InputLine[]{return bounded(rawLines(text).filter(v=>v)).map((v,i)=>toLine(i+1,v));}
function trimBlank(values:string[]){let start=0,end=values.length;while(start<end&&!values[start]) start++;while(end>start&&!values[end-1]) end--;return values.slice(start,end);}
// A box optionally starts with its heading; a second heading anywhere means the boxes were pasted in the wrong order.
function section(values:string[],expected:'removed'|'added'){
  const trimmed=trimBlank(values);const h=heading(trimmed[0]||'');
  if(h){if(h[1].toLowerCase()!==expected) invalid();trimmed.shift();}
  if(trimmed.some(v=>heading(v))) invalid();
  return trimBlank(trimmed);
}
export function pairReplacementRows(removed:string,added:string):ReplacementPairInput[]{
  let old:string[], next:string[];
  const values=rawLines(removed);
  if(values.some(v=>heading(v)?.[1].toLowerCase()==='added')){
    // Provider message pasted whole into the first box: "Removed IPs … Added IPs …".
    if(added.trim()) invalid();
    const body=trimBlank(values);
    if(/^updated\.\s*check please\.?$/i.test(body[0]||'')) body.shift();
    if(heading(body[0]||'')?.[1].toLowerCase()!=='removed') invalid();
    const index=body.findIndex(v=>heading(v)?.[1].toLowerCase()==='added');
    old=section(body.slice(1,index),'removed');next=section(body.slice(index+1),'added');
  } else {old=section(values,'removed');next=section(rawLines(added),'added');}
  bounded(old);if(next.length>1000) invalid();
  const pairs:ReplacementPairInput[]=[];
  for(let i=0;i<Math.max(old.length,next.length);i++){
    const o=old[i]||'',n=next[i]||'';if(!o&&!n) continue;
    pairs.push({row:i+1,old:o?toLine(i+1,o):null,next:n?toLine(i+1,n):null});
  }
  return pairs;
}
export function resolvePair(old:ParsedProxy,next:ParsedProxy):ParsedProxy{
  if(next.format==='FULL') return {...next};
  if(old.format!=='FULL') return invalid();
  return {...old,ip:next.ip};
}
export function fullProxy(p:ParsedProxy){if(p.format!=='FULL') invalid();return `${p.ip}:${p.port}:${p.username}:${p.password}`;}
