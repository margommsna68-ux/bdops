// A canary-only decorator, sharing the existing guest semaphore/password-file path.
// A guestcontrol timeout may leave a guest child alive even after the HOST process exits.
import { normalizeGuestTransport } from './guest.mjs';
export function createCanaryGuestTransport(raw){
  let uncertain=false;
  const transport=async(args,timeoutMs)=>{
    const guest=args?.[0]==='guestcontrol';
    if(guest&&uncertain)return {code:20,out:'',err:'',timedOut:true,guestControlRun:args[2]==='run'};
    const result=await raw(args,timeoutMs);
    if(guest&&normalizeGuestTransport(result)?.timedOut)uncertain=true;
    return result;
  };
  Object.defineProperty(transport,'guestCleanupUnverified',{get:()=>uncertain});
  return transport;
}
