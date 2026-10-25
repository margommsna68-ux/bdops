const ACTIONS=new Set(['heartbeat','claim','route','submit','heartbeat-job','result','cleanup-recovered']);
const text=v=>typeof v==='string' && v.length>0;
const record=v=>v!==null && typeof v==='object' && !Array.isArray(v);
const valid={
  heartbeat:d=>record(d)&&text(d.workerId)&&typeof d.enabled==='boolean',
  claim:d=>record(d)&&(d.job===null||(record(d.job)&&Object.keys(d.job).every(k=>['id','leaseToken','accountId','accountRevision','expiresAt','recoveryOnly'].includes(k))&&['id','leaseToken','accountId'].every(k=>text(d.job[k]))&&Number.isInteger(d.job.accountRevision)&&Number.isFinite(Date.parse(d.job.expiresAt))&&(d.job.recoveryOnly===undefined||typeof d.job.recoveryOnly==='boolean'))),
  route:d=>record(d)&&record(d.proxy)&&text(d.proxy.server)&&typeof d.proxy.username==='string'&&typeof d.proxy.password==='string',
  submit:d=>record(d)&&text(d.email)&&text(d.password),
  'heartbeat-job':d=>record(d)&&typeof d.cancelRequested==='boolean',
  result:d=>record(d)&&text(d.id)&&text(d.phase),
  'cleanup-recovered':d=>record(d),
};
export class ApiError extends Error {constructor(code,status=0){super(code);this.code=code;this.status=status;}}
export class ApiClient {
  constructor({baseUrl,token,transport=fetch,timeoutMs=15000}){
    let url;try{url=new URL(baseUrl);}catch{throw new ApiError('API_ORIGIN');}
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new ApiError('API_ORIGIN');
    if(!text(token)||/[\r\n]/.test(token))throw new ApiError('API_TOKEN');
    this.origin=url.origin;this.token=token;this.transport=transport;this.timeoutMs=timeoutMs;
  }
  async call(action,body,{signal}={}){
    if(!ACTIONS.has(action))throw new ApiError('API_ACTION');
    const controller=new AbortController(),deadline=controller.signal;
    const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    const combined=signal?AbortSignal.any([signal,deadline]):deadline;
    let abortListener;
    const interrupted=new Promise((_,reject)=>{abortListener=()=>reject(new ApiError(deadline.aborted?'API_TIMEOUT':'API_CANCELLED'));combined.addEventListener('abort',abortListener,{once:true});});
    try{
      combined.throwIfAborted();
      const target=`${this.origin}/api/apple-check/v1/${action}`;
      const response=await Promise.race([this.transport(target,{
        method:'POST',redirect:'error',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify(body),signal:combined,
      }),interrupted]);
      if(response.url&&response.url!==target)throw new ApiError('API_ORIGIN');
      if(response.redirected||response.status>=300&&response.status<400)throw new ApiError('API_REDIRECT',response.status);
      if(response.status!==200)throw new ApiError('API_REJECTED',response.status);
      const envelope=await Promise.race([response.json(),interrupted]);
      if(!record(envelope)||envelope.ok!==true||envelope.error!==null||!valid[action](envelope.data))throw new ApiError('API_PROTOCOL');
      return envelope.data;
    }catch(e){if(e instanceof ApiError)throw e;throw new ApiError(deadline.aborted?'API_TIMEOUT':'API_NETWORK');}
    finally{clearTimeout(timer);combined.removeEventListener('abort',abortListener);}
  }
}
