import {randomUUID} from 'node:crypto';
// Minimal ops-API client for the fleet worker: Bearer token, JSON envelope {ok,data,error}, one random Idempotency-Key per write
// (claim/renew are polling writes; step/complete carry their own stable ids and are de-duplicated server-side).
export class ApiError extends Error{constructor(code,status,message){super(message||code);this.code=code;this.status=status;}}
export function createOpsApi({baseUrl,token,fetchImpl=globalThis.fetch,timeoutMs=20000}){
 const u=new URL(baseUrl);
 if(u.username||u.password||u.search||u.hash||u.pathname.replace(/\/$/,'')!=='/api/ops/v1'||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new Error('INVALID_ORIGIN');
 if(typeof token!=='string'||!token)throw new Error('TOKEN_REQUIRED');
 const base=u.href.replace(/\/$/,'');
 async function request(method,route,body){
  const headers={authorization:'Bearer '+token,accept:'application/json'};
  const json=body===undefined?undefined:JSON.stringify(body);
  if(json){headers['content-type']='application/json';headers['idempotency-key']='fleetops-'+randomUUID();}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref?.();
  let r,text;
  try{r=await fetchImpl(base+'/'+route,{method,headers,body:json,signal:controller.signal,redirect:'error'});text=await r.text();}
  catch(e){throw new ApiError('BACKEND_OUTCOME_UNKNOWN',0,String(e?.message||e));}
  finally{clearTimeout(timer);}
  let v;try{v=JSON.parse(text);}catch{throw new ApiError('BACKEND_PROTOCOL_ERROR',r.status);}
  if(!r.ok||v.ok!==true){const code=v?.error?.code;throw new ApiError(typeof code==='string'&&/^[A-Z_]{2,48}$/.test(code)?code:'BACKEND_REFUSED',r.status,v?.error?.message);}
  return v.data;
 }
 return {
  request,
  claim:b=>request('POST','fleet-commands/claim',b),
  detail:(operationId,projectId)=>request('GET','fleet-commands/'+operationId+'?'+new URLSearchParams({projectId})),
  renew:(operationId,b)=>request('POST','fleet-commands/'+operationId+'/renew',b),
  step:(operationId,b)=>request('POST','fleet-commands/'+operationId+'/step',b),
  complete:(operationId,b)=>request('POST','fleet-commands/'+operationId+'/complete',b),
 };
}
