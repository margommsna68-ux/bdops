import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const ORIGINS=new Set(['https://account.apple.com','https://idmsa.apple.com','https://appleid.apple.com','https://appleid.cdn-apple.com','https://www.apple.com']);
export function officialUrl(value){
  try{const u=new URL(value);return ORIGINS.has(u.origin)&&!u.username&&!u.password&&!/(?:otp|captcha|verify|recovery|iforgot)(?:[/?#]|$)/i.test(u.pathname);}catch{return false;}
}
export function interpretEvidence(e,email){
  if(e.captcha)return {result:'CHALLENGE_REQUIRED',explicit:true};
  if(Array.isArray(e.alerts))for(const alert of e.alerts){
    const checked=interpretEvidence({...e,alerts:undefined,alert,twoFactor:false,challenge:false},email);
    if(['APPLE_LOCKED','INVALID_CREDENTIALS'].includes(checked.result))return checked;
  }
  const alert=typeof e.alert==='string'?e.alert.trim().replaceAll('’',"'").replace(/\.$/,''):'';
  if(["Your Apple Account has been locked for security reasons","This Apple Account has been locked for security reasons","This Apple ID has been locked for security reasons","This Apple Account has been disabled for security reasons","You can't sign in because your account was disabled for security reasons","This Apple Account is locked and can't be used","This Apple Account is not active","Your Apple Account is not active"].includes(alert))return {result:'APPLE_LOCKED',explicit:true};
  if(['Your Apple Account or password was incorrect.','Your Apple ID or password was incorrect.'].includes(e.alert))return {result:'INVALID_CREDENTIALS',explicit:true};
  if(e.twoFactor&&e.passwordSubmitted&&officialUrl(e.url))return {result:'LIVE_2FA',explicit:true};
  if(e.challenge)return {result:'CHALLENGE_REQUIRED',explicit:true};
  let url;try{url=new URL(e.url);}catch{}
  const matches=value=>typeof value==='string'&&value.trim().toLowerCase()===email.trim().toLowerCase();
  if(url?.origin==='https://account.apple.com'&&/^\/account\/manage(?:\/|$)/.test(url.pathname)&&e.signedOutControl===true&&matches(e.identity)&&matches(e.apiIdentity))return {result:'LOGIN_SUCCESS',authenticated:true,identity:e.identity};
  return {result:'UNKNOWN'};
}
function validateProxy(proxy){
  let u;try{u=new URL(proxy.server);}catch{throw new Error('PROXY_INVALID');}
  if(!['http:','https:','socks5:'].includes(u.protocol)||!u.hostname||u.username||u.password||u.pathname&&u.pathname!=='/'||u.search||u.hash||typeof proxy.username!=='string'||typeof proxy.password!=='string')throw new Error('PROXY_INVALID');
  // Chromium does not support authenticated SOCKS5: refuse instead of falling back.
  if(u.protocol==='socks5:'&&(proxy.username||proxy.password))throw new Error('PROXY_UNSUPPORTED');
  return {server:proxy.server,username:proxy.username,password:proxy.password};
}
const loadModule=specifier=>import(path.isAbsolute(specifier)?pathToFileURL(specifier).href:specifier);
async function bounded(promise,ms,code){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(code)),ms);})]);}finally{clearTimeout(timer);}
}
export class CloakAdapter {
  constructor({executablePath,modulePath='playwright-core',loadModule:loader=loadModule,timeoutMs=20000,resultWaitMs=45000}){
    Object.assign(this,{executablePath,modulePath,loader,timeoutMs,resultWaitMs});
  }
  create(){return new CloakSession(this);}
}
class CloakSession {
  constructor(config){this.config=config;this.submitted=false;this.closing=false;this.context=null;}
  async open({profilePath,proxy,signal}){
    const validated=validateProxy(proxy);signal?.throwIfAborted();
    const {chromium}=await this.config.loader(this.config.modulePath);signal?.throwIfAborted();
    if(!chromium?.launchPersistentContext)throw new Error('PLAYWRIGHT_RUNTIME');
    this.launch=chromium.launchPersistentContext(profilePath,{
      executablePath:this.config.executablePath,headless:false,proxy:validated,
      serviceWorkers:'block',acceptDownloads:false,locale:'en-US',timeout:this.config.timeoutMs,
      args:['--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
    });
    this.context=await this.launch;
    if(this.closing||signal?.aborted){await this.close();throw new Error('BROWSER_ABORTED');}
    this.context.setDefaultTimeout?.(this.config.timeoutMs);
    this.context.setDefaultNavigationTimeout?.(this.config.timeoutMs);
    if(typeof this.context.routeWebSocket!=='function')throw new Error('PLAYWRIGHT_WEBSOCKET_GUARD_REQUIRED');
    await this.context.route('**/*',async route=>{
      if(!officialUrl(route.request().url()))return route.abort('blockedbyclient');
      try{
        // continue() follows 307/308 outside interception: never use it for credentials.
        const response=await route.fetch({maxRedirects:0,maxRetries:0,timeout:this.config.timeoutMs});
        if(response.status()>=300&&response.status()<400)return route.abort('blockedbyclient');
        return await route.fulfill({response});
      }catch{return route.abort('failed').catch(()=>{});}
    });
    await this.context.routeWebSocket('**/*',socket=>socket.close());
    this.context.on('page',page=>{if(this.page&&page!==this.page)void page.close().catch(()=>{});});
    this.page=await this.context.newPage();
    this.page.on?.('response',response=>this.observeResponse(response).catch(()=>{}));
    this.page.on?.('download',download=>{void download.cancel().catch(()=>{});});
    this.signal=signal;this.onAbort=()=>{void this.close().catch(()=>{});};signal?.addEventListener('abort',this.onAbort,{once:true});
    signal?.throwIfAborted();
  }
  async observeResponse(response){
    const url=new URL(response.url());
    if(url.origin!=='https://account.apple.com'||url.pathname!=='/account/manage'||url.search||url.hash||response.request().method()!=='GET')return;
    this.authenticatedIdentity=null;
    if(response.status()!==200||!/^application\/json(?:;|$)/i.test(response.headers()['content-type']??''))return;
    const payload=await response.json();const identity=payload?.account?.person?.formattedAccountName;
    // Never keep the full payload (it may include API keys or other private data).
    if(typeof identity==='string')this.authenticatedIdentity=identity;
  }
  async probe({signal}){
    signal?.throwIfAborted();
    const response=await this.page.goto('https://account.apple.com/sign-in',{waitUntil:'domcontentloaded',timeout:this.config.timeoutMs});
    signal?.throwIfAborted();
    if(!response?.ok()||!officialUrl(this.page.url())||new URL(this.page.url()).origin!=='https://account.apple.com')throw new Error('ROUTE_FAILED');
    const until=Date.now()+this.config.timeoutMs;
    while(Date.now()<until){
      signal?.throwIfAborted();
      if(!officialUrl(this.page.url()))throw new Error('ROUTE_FAILED');
      const evidence=await this.evidence('');
      if(evidence.result==='CHALLENGE_REQUIRED'){this.probed=true;return evidence;}
      if(await this.find('#account_name_text_field')){this.probed=true;return;}
      await delay(200,undefined,signal?{signal}:{});
    }
    throw new Error('ROUTE_FORM_NOT_READY');
  }
  async evidence(email){
    const state={url:this.page.url(),alerts:[],challenge:false,twoFactor:false,captcha:false,passwordSubmitted:this.passwordSubmitted===true,apiIdentity:this.authenticatedIdentity,signedOutControl:false,identity:null};
    if(!officialUrl(state.url))return {result:'UNKNOWN'};
    for(const frame of this.page.frames()){
      if(!officialUrl(frame.url()))continue;
        const anyVisible=async selector=>{const list=frame.locator(selector);for(let i=0;i<await list.count();i++)if(await list.nth(i).isVisible())return true;return false;};
      if(await anyVisible('input[autocomplete="one-time-code"], input.form-security-code-input, input[id^="char"]'))state.twoFactor=true;
      if(await anyVisible('iframe[title*="CAPTCHA" i]')||await anyVisible('[data-testid="captcha"]'))state.captcha=true;
      state.challenge=state.twoFactor||state.captcha;
      // The current Apple widget uses #errMsg and #alertInfo, without role=alert.
      const alerts=frame.locator('[role="alert"], #errMsg, #alertInfo');for(let i=0;i<await alerts.count();i++)if(await alerts.nth(i).isVisible())state.alerts.push((await alerts.nth(i).innerText()).trim().replace(/\s+/g,' '));
      if(new URL(frame.url()).origin==='https://account.apple.com'){
        const signout=frame.locator('a.ac-localnav-action, button.ac-localnav-action');
        for(let i=0;i<await signout.count();i++){
          const control=signout.nth(i);
          if(await control.isVisible()&&((await control.getAttribute('title'))?.trim()==='Sign Out'||(await control.innerText()).trim()==='Sign Out'))state.signedOutControl=true;
        }
        const identity=frame.locator('[class*="formatted-account-name"]');
        for(let i=0;i<await identity.count();i++)if(await identity.nth(i).isVisible()){
          const text=(await identity.nth(i).innerText()).trim();
          if(text.toLowerCase()===email.trim().toLowerCase())state.identity=text;
        }
      }
    }
    return interpretEvidence(state,email);
  }
  async find(selector){
    const matches=[];
    for(const frame of this.page.frames())if(officialUrl(frame.url())){
      const locator=frame.locator(selector);if(await locator.count()===1&&await locator.isVisible())matches.push(locator);
    }
    return matches.length===1?matches[0]:null;
  }
  async submit({email,password},{signal}){
    if(!this.probed||this.submitted)throw new Error('SUBMIT_ONCE');this.submitted=true;signal?.throwIfAborted();
    let operation='EMAIL_ENTRY_FAILED';
    try {
    let evidence=await this.evidence(email);if(evidence.result!=='UNKNOWN')return evidence;
    const account=await this.find('#account_name_text_field');if(!account)return {result:'UNKNOWN',reasonCode:'EMAIL_FORM_MISSING'};
    signal?.throwIfAborted();await account.fill(email);
    let pw=await this.find('#password_text_field');
    let button=await this.find('#sign-in');if(!button)return {result:'UNKNOWN',reasonCode:'SUBMIT_BUTTON_MISSING'};
    const label=async control=>typeof control.innerText==='function'?(await control.innerText()).trim().replace(/\s+/g,' ').toLowerCase():null;
    const passwordPhase=async control=>['sign in','sign in with password'].includes(await label(control));
    // Apple's current page renders a visible password textbox BEFORE the email
    // Continue step. Visibility alone is not evidence of the password phase.
    if(!pw||await label(button)==='continue'){const next=button;
      signal?.throwIfAborted();await next.click({noWaitAfter:true});
      // Wait for the next phase without clicking again or fetching any challenge link.
      const until=Date.now()+this.config.timeoutMs;
      while(Date.now()<until){signal?.throwIfAborted();evidence=await this.evidence(email);if(evidence.result!=='UNKNOWN')return evidence;
        pw=await this.find('#password_text_field');button=await this.find('#sign-in');
        if(pw&&button&&await passwordPhase(button))break;await delay(200,undefined,signal?{signal}:{});}
    }
    if(!pw)return {result:'UNKNOWN',reasonCode:'PASSWORD_FORM_MISSING'};
    evidence=await this.evidence(email);if(evidence.result!=='UNKNOWN')return evidence;
    button=await this.find('#sign-in');if(!button||!await passwordPhase(button))return {result:'UNKNOWN',reasonCode:'SUBMIT_BUTTON_MISSING'};
    operation='PASSWORD_SUBMIT_FAILED';
    signal?.throwIfAborted();await pw.fill(password);signal?.throwIfAborted();
    // Exactly one password-bearing submit, never a retry on navigation or network error.
    this.passwordSubmitted=true;
    await button.click({noWaitAfter:true});
    operation='RESPONSE_READ_FAILED';
    const until=Date.now()+this.config.resultWaitMs;
    while(Date.now()<until){signal?.throwIfAborted();evidence=await this.evidence(email);if(evidence.result!=='UNKNOWN')return evidence;await delay(250,undefined,signal?{signal}:{});}
    return {result:'UNKNOWN',reasonCode:'RESPONSE_UNRECOGNIZED'};
    }catch(error){signal?.throwIfAborted();return {result:'UNKNOWN',reasonCode:operation};}
  }
  async close(){
    this.closing=true;this.signal?.removeEventListener('abort',this.onAbort);
    if(this.closePromise)return this.closePromise;
    this.closePromise=bounded((async()=>{const context=this.context??(this.launch?await this.launch:null);if(context)await context.close();})(),this.config.timeoutMs,'CLEANUP_TIMEOUT');
    return this.closePromise;
  }
}
