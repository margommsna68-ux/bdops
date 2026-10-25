import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {terminateOwnedBrowser,noOwnedBrowser} from './platform.mjs';

const ORIGINS=new Set(['https://account.apple.com','https://idmsa.apple.com','https://appleid.apple.com','https://appleid.cdn-apple.com','https://www.apple.com']);
function visibleAlertResult(text){
  const value=typeof text==='string'?text.trim().replaceAll('’',"'").replace(/^(?:Verification Failed|Sign In Failed)\s*[:.]?\s*/,'').replace(/\s+/g,' ').replace(/\.$/,''):'';
  const sentence=message=>value===message||value.startsWith(message+'. ');
  if(["Your Apple Account has been locked for security reasons","This Apple Account has been locked for security reasons","This Apple ID has been locked for security reasons","This Apple Account has been disabled for security reasons","You can't sign in because your account was disabled for security reasons","This Apple Account is locked and can't be used","This Apple Account is not active","Your Apple Account is not active"].some(sentence))return 'APPLE_LOCKED';
  if(['Your Apple Account or password was incorrect','Your Apple ID or password was incorrect','Your Apple Account or password is incorrect','Your Apple ID or password is incorrect'].some(sentence))return 'INVALID_CREDENTIALS';
  return 'UNRECOGNIZED';
}
export function safeDiagnostics(value){
  const number=x=>Number.isInteger(x)&&x>=0?Math.min(9999,x):0,n=value?.network??{};
  const l=value?.launch??{};
  return {launch:{phase:['MODULE','LAUNCH','GUARDS','PAGE','READY'].includes(l.phase)?l.phase:'NOT_STARTED',failure:['TIMEOUT','EXITED','MEMORY','ACCESS','OTHER'].includes(l.failure)?l.failure:'NONE',exitCode:Number.isInteger(l.exitCode)&&l.exitCode>=-2147483648&&l.exitCode<=4294967295?l.exitCode:null},serviceErrorCodes:[...new Set((Array.isArray(value?.serviceErrorCodes)?value.serviceErrorCodes:[]).filter(x=>Number.isInteger(x)&&Math.abs(x)<=999999999))].slice(0,8),passwordSubmitClicked:value?.passwordSubmitClicked===true,network:Object.fromEntries(['authPosts','lastAuthStatus','passwordVerifyPosts','blockedChallenge','blockedRedirects','failedRequests','blockedVerifyRead','blockedVerifyWrite','blockedCaptcha','blockedOtp'].map(k=>[k,number(n[k])])),frames:(Array.isArray(value?.frames)?value.frames:[]).slice(0,10).map(f=>({
    kind:['SIGNIN','VERIFY','ACCOUNT','OTHER_OFFICIAL'].includes(f.kind)?f.kind:'OTHER',buttonPhase:['CONTINUE','SIGN_IN'].includes(f.buttonPhase)?f.buttonPhase:'OTHER',
    inputKinds:[...new Set((Array.isArray(f.inputKinds)?f.inputKinds:[]).filter(k=>['EMAIL','PASSWORD','OTP','TEXT','TEL','OTHER'].includes(k)))],errorVisible:f.errorVisible===true,alertKinds:[...new Set((Array.isArray(f.alertKinds)?f.alertKinds:[]).filter(k=>['APPLE_LOCKED','INVALID_CREDENTIALS','UNRECOGNIZED'].includes(k)))],twoFactorText:f.twoFactorText===true,connectionErrorText:f.connectionErrorText===true,
  }))};
}
export function officialUrl(value){
  try{const u=new URL(value);return ORIGINS.has(u.origin)&&!u.username&&!u.password&&!/(?:otp|captcha|verify|recovery|iforgot)(?:[/?#]|$)/i.test(u.pathname);}catch{return false;}
}
export function interpretEvidence(e,email){
  if(e.captcha)return {result:'CHALLENGE_REQUIRED',explicit:true};
  if(Array.isArray(e.alerts))for(const alert of e.alerts){
    const checked=interpretEvidence({...e,alerts:undefined,alert,twoFactor:false,challenge:false},email);
    if(['APPLE_LOCKED','INVALID_CREDENTIALS'].includes(checked.result))return checked;
  }
  const alertResult=visibleAlertResult(e.alert);
  if(alertResult!=='UNRECOGNIZED')return {result:alertResult,explicit:true};
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
  constructor({executablePath,modulePath='playwright-core',loadModule:loader=loadModule,timeoutMs=20000,resultWaitMs=45000,launchTimeoutMs=60000,terminateBrowser=terminateOwnedBrowser,verifyNoBrowser=noOwnedBrowser,headless=false}){
    if(typeof headless!=='boolean')throw new Error('CONFIG_HEADLESS');
    Object.assign(this,{executablePath,modulePath,loader,timeoutMs,resultWaitMs,launchTimeoutMs,terminateBrowser,verifyNoBrowser,headless});
  }
  create(){return new CloakSession(this);}
}
class CloakSession {
  constructor(config){this.config=config;this.submitted=false;this.passwordVerificationSent=false;this.closing=false;this.context=null;this.authResponseSequence=0;this.serviceErrorCodes=[];this.serviceErrorResults=[];this.network={authPosts:0,lastAuthStatus:0,passwordVerifyPosts:0,blockedChallenge:0,blockedRedirects:0,failedRequests:0,blockedVerifyRead:0,blockedVerifyWrite:0,blockedCaptcha:0,blockedOtp:0};}
  async open({profilePath,proxy,signal}){
    this.profilePath=profilePath;
    const validated=validateProxy(proxy);signal?.throwIfAborted();
    this.launchPhase='MODULE';
    const {chromium}=await this.config.loader(this.config.modulePath);signal?.throwIfAborted();
    if(!chromium?.launchPersistentContext)throw new Error('PLAYWRIGHT_RUNTIME');
    this.launchPhase='LAUNCH';
    try{this.launch=chromium.launchPersistentContext(profilePath,{
      executablePath:this.config.executablePath,headless:this.config.headless,proxy:validated,
      serviceWorkers:'block',acceptDownloads:false,locale:'en-US',timeout:this.config.launchTimeoutMs,
      args:['--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
    });
    this.context=await this.launch;
    }catch(error){
      const text=typeof error?.message==='string'?error.message:'',exit=/exitCode=(-?\d+)/.exec(text);
      this.launchFailure=/ENOMEM|out of memory/i.test(text)?'MEMORY':/EPERM|EACCES|access.*denied/i.test(text)?'ACCESS':error?.name==='TimeoutError'||/LAUNCH_TIMEOUT|timeout.*exceeded/i.test(text)?'TIMEOUT':/exitCode=|browser.*closed|has been closed/i.test(text)?'EXITED':'OTHER';
      this.launchExitCode=exit?Number(exit[1]):null;throw error;
    }finally{this.launchSettled=true;}
    if(this.closing||signal?.aborted){await this.close();throw new Error('BROWSER_ABORTED');}
    this.launchPhase='GUARDS';
    this.context.setDefaultTimeout?.(this.config.timeoutMs);
    this.context.setDefaultNavigationTimeout?.(this.config.timeoutMs);
    if(typeof this.context.routeWebSocket!=='function')throw new Error('PLAYWRIGHT_WEBSOCKET_GUARD_REQUIRED');
    await this.context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      // Apple's existing basic-auth flow calls verify/password after Sign In.
      // This is password verification, not an OTP endpoint. Permit exactly that
      // browser-generated POST once, only after the visible password click.
      const passwordVerification=request.url()==='https://idmsa.apple.com/appleauth/auth/verify/password'&&request.method?.()==='POST'&&this.passwordSubmitted===true&&!this.passwordVerificationSent;
      const authPost=passwordVerification||url.origin==='https://idmsa.apple.com'&&request.method?.()==='POST'&&/\/signin(?:\/|$)/.test(url.pathname);
      if(!officialUrl(request.url())&&!passwordVerification){
        if(ORIGINS.has(url.origin)&&/verify|otp|captcha/i.test(url.pathname)){
          this.network.blockedChallenge++;
          if(/verify/i.test(url.pathname))this.network[request.method?.()==='GET'?'blockedVerifyRead':'blockedVerifyWrite']++;
          if(/captcha/i.test(url.pathname))this.network.blockedCaptcha++;
          if(/otp/i.test(url.pathname))this.network.blockedOtp++;
        }
        return route.abort('blockedbyclient');
      }
      if(passwordVerification){this.passwordVerificationSent=true;this.network.passwordVerifyPosts++;}
      if(authPost)this.network.authPosts++;
      try{
        // continue() follows 307/308 outside interception: never use it for credentials.
        const response=await route.fetch({maxRedirects:0,maxRetries:0,timeout:this.config.timeoutMs});
        if(authPost)this.network.lastAuthStatus=response.status();
        if(response.status()>=300&&response.status()<400){this.network.blockedRedirects++;return route.abort('blockedbyclient');}
        return await route.fulfill({response});
      }catch{this.network.failedRequests++;return route.abort('failed').catch(()=>{});}
    });
    await this.context.routeWebSocket('**/*',socket=>socket.close());
    this.context.on('page',page=>{if(this.page&&page!==this.page)void page.close().catch(()=>{});});
    this.launchPhase='PAGE';this.page=await this.context.newPage();
    this.page.on?.('response',response=>this.observeResponse(response).catch(()=>{}));
    this.page.on?.('download',download=>{void download.cancel().catch(()=>{});});
    this.signal=signal;this.onAbort=()=>{void this.close().catch(()=>{});};signal?.addEventListener('abort',this.onAbort,{once:true});
    signal?.throwIfAborted();
    this.launchPhase='READY';
  }
  async observeResponse(response){
    const url=new URL(response.url());
    if(this.passwordSubmitted===true&&url.origin==='https://idmsa.apple.com'&&/^\/appleauth\/auth\/(?:signin(?:\/|$)|verify\/password$)/.test(url.pathname)&&response.request().method()==='POST'){
      const sequence=++this.authResponseSequence;this.serviceErrorCodes=[];this.serviceErrorResults=[];
      if(response.status()<400||response.status()>=500||!/^application\/json(?:;|$)/i.test(response.headers()['content-type']??''))return;
      const payload=await response.json();
      if(sequence!==this.authResponseSequence)return;
      const errors=['serviceErrors','service_errors','validationErrors'].flatMap(key=>Array.isArray(payload?.[key])?payload[key]:[]).slice(0,8);
      for(const item of errors){
        const code=Number.isInteger(item?.code)&&Math.abs(item.code)<=999999999?item.code:typeof item?.code==='string'&&/^-?\d{1,9}$/.test(item.code)?Number(item.code):null;
        if(code!==null)this.serviceErrorCodes=[...new Set([...this.serviceErrorCodes,code])].slice(0,8);
        const kind=visibleAlertResult(item?.message);if(kind!=='UNRECOGNIZED')this.serviceErrorResults=[...new Set([...this.serviceErrorResults,kind])];
      }
      return;
    }
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
      for(const selector of ['[role="alert"], #errMsg, #alertInfo','.idms-modal .app-dialog .body']){
        const alerts=frame.locator(selector);for(let i=0;i<await alerts.count();i++)if(await alerts.nth(i).isVisible())state.alerts.push((await alerts.nth(i).innerText()).trim().replace(/\s+/g,' '));
      }
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
    const visible=interpretEvidence(state,email);if(visible.result!=='UNKNOWN')return visible;
    if(this.passwordSubmitted===true&&state.alerts.length&&!state.captcha&&this.serviceErrorResults.length===1)return {result:this.serviceErrorResults[0],explicit:true};
    return visible;
  }
  async find(selector){
    const matches=[];
    for(const frame of this.page.frames())if(officialUrl(frame.url())){
      const locator=frame.locator(selector);if(await locator.count()===1&&await locator.isVisible())matches.push(locator);
    }
    return matches.length===1?matches[0]:null;
  }
  async diagnostics(){
    const frames=[];
    for(const frame of (this.page?.frames()??[]).slice(0,10)){
      let u;try{u=new URL(frame.url());}catch{continue;}if(!ORIGINS.has(u.origin))continue;
      const kind=/verify|otp|captcha/i.test(u.pathname)?'VERIFY':/signin/i.test(u.pathname)?'SIGNIN':/account\/manage/.test(u.pathname)?'ACCOUNT':'OTHER_OFFICIAL';
      const metadata=await frame.evaluate(()=>{
        const visible=e=>!!e.getClientRects().length,inputs=[...document.querySelectorAll('input')].filter(visible).slice(0,30),button=document.querySelector('#sign-in'),label=button?.innerText?.trim().toLowerCase();
        const body=document.body?.innerText??'';
        const alerts=[...document.querySelectorAll('#errMsg,#alertInfo,[role="alert"],.idms-modal .app-dialog .body')].filter(visible);
        return {buttonPhase:label==='continue'?'CONTINUE':label==='sign in'?'SIGN_IN':'OTHER',inputKinds:inputs.map(e=>e.autocomplete==='one-time-code'||/^char\d+$/.test(e.id)?'OTP':e.id==='account_name_text_field'?'EMAIL':e.type==='password'?'PASSWORD':['text','tel'].includes(e.type)?e.type.toUpperCase():'OTHER'),errorVisible:alerts.length>0,alerts:alerts.slice(0,5).map(e=>(e.innerText??'').slice(0,2048)),twoFactorText:/two.factor authentication|verification code|six.digit code/i.test(body),connectionErrorText:/unable to connect|could not connect|connection.*error|service.*unavailable/i.test(body)};
      }).catch(()=>({}));
      const {alerts,...safe}=metadata;
      frames.push({kind,...safe,alertKinds:(Array.isArray(alerts)?alerts:[]).map(visibleAlertResult)});
    }
    return safeDiagnostics({launch:{phase:this.launchPhase,failure:this.launchFailure,exitCode:this.launchExitCode},serviceErrorCodes:this.serviceErrorCodes,passwordSubmitClicked:this.passwordSubmitted,network:this.network,frames});
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
    this.closePromise=bounded((async()=>{
      try{await bounded((async()=>{const context=this.context??(this.launch?await this.launch:null);if(context)await context.close();})(),this.config.timeoutMs,'CLEANUP_TIMEOUT');}
      catch(error){
        if(!this.profilePath)throw error;
        try{await this.config.terminateBrowser(this.profilePath);}
        catch(terminationError){
          // A departing process may already be gone by the second inspection.
          // Never accept absence while launch can still create a late browser.
          if(!this.launchSettled||!await this.config.verifyNoBrowser(this.profilePath))throw terminationError;
        }
        if(!this.launchSettled)throw new Error('LAUNCH_UNRESOLVED');
      }
    })(),45000,'CLEANUP_TIMEOUT');
    return this.closePromise;
  }
}
