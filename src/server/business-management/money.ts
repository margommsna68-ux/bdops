import {Prisma} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
const invalid=()=>{throw new ProxyDomainError('INVALID_INPUT','Số tiền, ngày hoặc phần trăm chưa hợp lệ');};
export function money(text:string){if(!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(text))invalid();return new Prisma.Decimal(text);}
export function dayDate(text:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(text))invalid();const date=new Date(text+'T00:00:00+07:00');if(!Number.isFinite(date.getTime())||new Date(date.getTime()+7*3600000).toISOString().slice(0,10)!==text)invalid();return date;}
export function dayText(date:Date){return new Date(date.getTime()+7*3600000).toISOString().slice(0,10);}
export function period(start:string,end:string){const a=dayDate(start),b=dayDate(end);if(a>b||b.getTime()-a.getTime()>3660*86400000)invalid();return {start:a,end:new Date(b.getTime()+86400000)};}
export function allocateCents(net:string,partners:{name:string;percentage:string}[]){
  if(!partners.length||partners.length>100||new Set(partners.map(p=>p.name.trim())).size!==partners.length)invalid();
  const bps=partners.map(p=>{if(!p.name.trim())invalid();const pct=money(p.percentage);if(pct.gt(100))invalid();return BigInt(pct.mul(100).toFixed(0));});if(bps.reduce((a,b)=>a+b,BigInt(0))!==BigInt(10000))invalid();
  const negative=net.startsWith('-'),cents=BigInt(money(negative?net.slice(1):net).mul(100).toFixed(0)),shares=bps.map((bp,index)=>({index,value:cents*bp/BigInt(10000),remainder:cents*bp%BigInt(10000)}));
  const remainder=cents-shares.reduce((a,b)=>a+b.value,BigInt(0)),ordered=[...shares].sort((a,b)=>Number(b.remainder-a.remainder)||a.index-b.index);for(let i=0;i<Number(remainder);i++)ordered[i].value++;
  return partners.map((p,index)=>({name:p.name.trim(),percentage:new Prisma.Decimal(p.percentage).toFixed(2),amount:new Prisma.Decimal(shares[index].value.toString()).div(100).mul(negative?-1:1).toFixed(2)}));
}
