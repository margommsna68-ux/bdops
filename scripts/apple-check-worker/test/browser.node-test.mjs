import test from 'node:test';import assert from 'node:assert/strict';
import {CloakAdapter,interpretEvidence,officialUrl} from '../src/browser.mjs';
import * as Browser from '../src/browser.mjs';

test('diagnostics retain only bounded phases/counts and never raw DOM/URLs/secrets',()=>{
 const safeDiagnostics=Browser.safeDiagnostics;assert.equal(typeof safeDiagnostics,'function');
 const d=safeDiagnostics({passwordSubmitClicked:true,network:{authPosts:1,lastAuthStatus:409,blockedChallenge:2,raw:'password-secret'},frames:[{kind:'VERIFY',buttonPhase:'OTHER',inputKinds:['PASSWORD','OTP','email-secret@example.test'],errorVisible:true,twoFactorText:true,body:'password-secret',url:'https://secret.test/token'}],raw:'password-secret'});
 assert.equal(d.network.lastAuthStatus,409);assert.deepEqual(d.frames[0].inputKinds,['PASSWORD','OTP']);assert.equal(JSON.stringify(d).includes('secret'),false);
});

test('only a post-password Apple two-factor prompt means Live; CAPTCHA and pre-login OTP do not',()=>{
  const base={url:'https://idmsa.apple.com/appleauth/auth/authorize/signin',twoFactor:true};
  assert.equal(interpretEvidence({...base,passwordSubmitted:true},'me@test').result,'LIVE_2FA');
  assert.notEqual(interpretEvidence(base,'me@test').result,'LIVE_2FA');
  assert.equal(interpretEvidence({...base,passwordSubmitted:true,captcha:true},'me@test').result,'CHALLENGE_REQUIRED');
  assert.equal(interpretEvidence({...base,url:'https://evil.test',passwordSubmitted:true},'me@test').result,'UNKNOWN');
  assert.equal(interpretEvidence({...base,passwordSubmitted:true,alerts:['Your Apple Account has been locked for security reasons.']},'me@test').result,'APPLE_LOCKED');
  assert.equal(interpretEvidence({...base,passwordSubmitted:true,alerts:['Your Apple ID or password was incorrect.']},'me@test').result,'INVALID_CREDENTIALS');
});

test('only explicit outcomes count; success needs official authenticated matching identity',()=>{
  assert.equal(interpretEvidence({url:'https://account.apple.com/account/manage',signedOutControl:true,identity:'me@example.test',apiIdentity:'me@example.test',alerts:['An unrelated notice']},'me@example.test').result,'LOGIN_SUCCESS');
  assert.equal(interpretEvidence({url:'https://account.apple.com/account/manage',signedOutControl:true,identity:'me@example.test'},'me@example.test').result,'UNKNOWN');
  assert.equal(interpretEvidence({url:'https://account.apple.com/account/manage/section/sign-in-security',signedOutControl:true,identity:'me@example.test',apiIdentity:'me@example.test'},'me@example.test').result,'LOGIN_SUCCESS');
  assert.equal(interpretEvidence({url:'https://account.apple.com/account/manage',signedOutControl:true,identity:'me@example.test',apiIdentity:'other@example.test'},'me@example.test').result,'UNKNOWN');
  for(const e of [{url:'https://evil.test',signedOutControl:true,identity:'me@example.test'},{url:'https://account.apple.com/sign-in',signedOutControl:true,identity:'me@example.test'},{url:'https://account.apple.com/account/manage',identity:'me@example.test'},{url:'https://account.apple.com/account/manage',signedOutControl:true,identity:'other@example.test'},{}])assert.equal(interpretEvidence(e,'me@example.test').result,'UNKNOWN');
  assert.equal(interpretEvidence({challenge:true},'a').result,'CHALLENGE_REQUIRED');
  assert.equal(interpretEvidence({alert:'Your Apple Account has been locked for security reasons.'},'a').result,'APPLE_LOCKED');
  assert.equal(interpretEvidence({alert:'Something locked?'},'a').result,'UNKNOWN');
  for(const alert of ['This Apple Account has been disabled for security reasons','You can’t sign in because your account was disabled for security reasons','This Apple Account is locked and can’t be used','This Apple Account is not active'])assert.equal(interpretEvidence({alert},'a').result,'APPLE_LOCKED');
  assert.equal(interpretEvidence({alert:'Your Media & Purchases account has been disabled'},'a').result,'UNKNOWN');
  for(const url of ['https://account.apple.com.evil.test/sign-in','http://account.apple.com/sign-in','https://u:p@account.apple.com/sign-in','https://account.apple.com/verify/otp'])assert.equal(officialUrl(url),false);
});

test('visible Apple errors allow surrounding dialog headings and recovery links without guessing from HTTP status',()=>{
 for(const alert of ["Verification Failed\nYour Apple Account or password was incorrect. Forgot password?","Your Apple ID or password was incorrect","Your Apple Account or password is incorrect."]){
  assert.equal(interpretEvidence({alerts:[alert]},'me@example.test').result,'INVALID_CREDENTIALS');
 }
 assert.equal(interpretEvidence({alerts:["This Apple Account has been locked for security reasons. You must unlock your account before signing in."]},'me@example.test').result,'APPLE_LOCKED');
 for(const alert of ['Your Apple Account was not locked.','Your Media & Purchases account has been disabled','Unable to process your request. HTTP 403'])assert.equal(interpretEvidence({alerts:[alert]},'me@example.test').result,'UNKNOWN');
});
async function authenticatedFixture({apiEmail='me@example.test',visibleEmail='me@example.test',signout=true,response=true,method='GET',status=200,url='https://account.apple.com/account/manage',iframeOnly=false}={}){
  let responseHandler;const runtime=fakeRuntime();const original=runtime.chromium.launchPersistentContext;
  runtime.chromium.launchPersistentContext=async(...args)=>{
    const context=await original(...args);const control=(visible,text='',title=null)=>({isVisible:async()=>visible,innerText:async()=>text,getAttribute:async()=>title});
    const frame={url:()=>iframeOnly?'https://apps.apple.com/includes/commerce/logout':url,locator:selector=>{
      const controls=selector==='[class*="formatted-account-name"]'?[control(true,visibleEmail)]:selector==='a.ac-localnav-action, button.ac-localnav-action'?[control(signout,'Sign Out','Sign Out')]:[];
      return {count:async()=>controls.length,nth:i=>controls[i]};
    }};
    context.newPage=async()=>({url:()=>url,frames:()=>[frame],on:(event,h)=>{if(event==='response')responseHandler=h;}});return context;
  };
  const b=new CloakAdapter({executablePath:'C:/chrome.exe',loadModule:async()=>runtime}).create();await b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});
  if(response)await responseHandler({request:()=>({method:()=>method}),url:()=>url,status:()=>status,headers:()=>({'content-type':'application/json'}),json:async()=>({account:{person:{formattedAccountName:apiEmail},apiKey:'must-not-persist'}})});
  return b;
}
test('source-verified success needs same-context manage GET, exact identity, visible account name and Sign Out',async()=>{
  const b=await authenticatedFixture();assert.deepEqual(await b.evidence('me@example.test'),{result:'LOGIN_SUCCESS',authenticated:true,identity:'me@example.test'});
  assert.equal(JSON.stringify(b).includes('must-not-persist'),false);await b.close();
  for(const options of [{apiEmail:'wrong@example.test'},{visibleEmail:'wrong@example.test'},{signout:false},{response:false},{iframeOnly:true},{method:'POST'},{status:401},{url:'https://account.apple.com/account/manage?fake=1'}]){
    const item=await authenticatedFixture(options);assert.equal((await item.evidence('me@example.test')).result,'UNKNOWN');await item.close();
  }
});

test('an explicit same-context Apple API error needs post-password state and visible error UI',async()=>{
 for(const options of [{},{submitted:false},{visible:false},{origin:'https://foreign.test'},{method:'GET'}]){
  const runtime=fakeRuntime(),launch=runtime.chromium.launchPersistentContext;let responseHandler;
  runtime.chromium.launchPersistentContext=async(...args)=>{const context=await launch(...args);context.newPage=async()=>({on:(e,h)=>{if(e==='response')responseHandler=h;},url:()=>'https://account.apple.com/sign-in',frames:()=>[{url:()=>'https://idmsa.apple.com/appleauth/auth/authorize/signin',evaluate:async()=>({}),locator:selector=>({count:async()=>selector==='[role="alert"], #errMsg, #alertInfo'?1:0,nth:()=>({isVisible:async()=>options.visible!==false,innerText:async()=> 'Cannot Sign In'})})}]});return context;};
  const b=new CloakAdapter({executablePath:'C:/chrome.exe',loadModule:async()=>runtime}).create();await b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});b.passwordSubmitted=options.submitted!==false;
  await responseHandler({url:()=>`${options.origin??'https://idmsa.apple.com'}/appleauth/auth/signin/complete`,request:()=>({method:()=>options.method??'POST'}),status:()=>403,headers:()=>({'content-type':'application/json'}),json:async()=>({serviceErrors:[{code:'-24099',message:'This Apple Account has been locked for security reasons.'}],token:'secret-not-to-retain'})});
  assert.equal((await b.evidence('me@example.test')).result,Object.keys(options).length?'UNKNOWN':'APPLE_LOCKED');
  const d=await b.diagnostics();assert.equal(JSON.stringify(d).includes('secret'),false);if(!Object.keys(options).length)assert.deepEqual(d.serviceErrorCodes,[-24099]);await b.close();
 }
});

test('current visible errors win; latest conflicting or unknown API errors cannot reuse an older assertion',async()=>{
 const runtime=fakeRuntime(),launch=runtime.chromium.launchPersistentContext;let responseHandler,text='Cannot Sign In';
 runtime.chromium.launchPersistentContext=async(...args)=>{const context=await launch(...args);context.newPage=async()=>({on:(e,h)=>{if(e==='response')responseHandler=h;},url:()=>'https://account.apple.com/sign-in',frames:()=>[{url:()=>'https://idmsa.apple.com/appleauth/auth/authorize/signin',evaluate:async()=>({}),locator:selector=>({count:async()=>selector==='[role="alert"], #errMsg, #alertInfo'?1:0,nth:()=>({isVisible:async()=>true,innerText:async()=>text})})}]});return context;};
 const b=new CloakAdapter({executablePath:'C:/chrome.exe',loadModule:async()=>runtime}).create();await b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});b.passwordSubmitted=true;
 const send=errors=>responseHandler({url:()=>'https://idmsa.apple.com/appleauth/auth/signin/complete',request:()=>({method:()=> 'POST'}),status:()=>403,headers:()=>({'content-type':'application/json'}),json:async()=>({serviceErrors:errors})});
 await send([{code:'-1',message:'Your Apple Account or password was incorrect.'}]);text='This Apple Account has been locked for security reasons.';
 assert.equal((await b.evidence('me@example.test')).result,'APPLE_LOCKED');
 text='Cannot Sign In';await send([{code:'-2',message:'Your Apple Account or password was incorrect.'},{code:'-3',message:'This Apple Account has been locked for security reasons.'}]);
 assert.equal((await b.evidence('me@example.test')).result,'UNKNOWN');
 await send([{code:'-4',message:'Unable to process request.'}]);assert.equal((await b.evidence('me@example.test')).result,'UNKNOWN');assert.deepEqual((await b.diagnostics()).serviceErrorCodes,[-4]);await b.close();
});
function fakeRuntime({blocked=false,delayed=0}={}){
  let options,routeHandler,websocketHandler,closed=0,gotos=[],lookups=0;
  const frame={url:()=>'https://idmsa.apple.com/appleauth/auth/authorize/signin',locator:selector=>({count:async()=>selector==='#account_name_text_field'?1:0,isVisible:async()=>++lookups>delayed})};
  const page={goto:async url=>{gotos.push(url);return {ok:()=>true};},url:()=>blocked?'https://evil.test':'https://account.apple.com/sign-in',frames:()=>[frame]};
  const context={route:async(_,h)=>routeHandler=h,routeWebSocket:async(_,h)=>websocketHandler=h,
    on:()=>{},newPage:async()=>page,close:async()=>{closed++;}};
  const chromium={launchPersistentContext:async(_,o)=>{options=o;return context;}};
  return {chromium,get lookups(){return lookups;},get options(){return options;},get closed(){return closed;},get gotos(){return gotos;},get routeHandler(){return routeHandler;},get websocketHandler(){return websocketHandler;}};
}

test('reads Apple modal body, not only the generic Cannot Sign In heading',async()=>{
 const runtime=fakeRuntime(),launch=runtime.chromium.launchPersistentContext;
 runtime.chromium.launchPersistentContext=async(...args)=>{const context=await launch(...args);context.newPage=async()=>({on:()=>{},url:()=>'https://account.apple.com/sign-in',frames:()=>[{url:()=>'https://idmsa.apple.com/appleauth/auth/authorize/signin',locator:selector=>({count:async()=>selector==='.idms-modal .app-dialog .body'?1:0,nth:()=>({isVisible:async()=>true,innerText:async()=>"This Apple Account has been locked for security reasons. You must unlock it before signing in."})})}]});return context;};
 const b=new CloakAdapter({executablePath:'C:/chrome.exe',loadModule:async()=>runtime}).create();await b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});
 assert.equal((await b.evidence('me@example.test')).result,'APPLE_LOCKED');await b.close();
});
test('same proxied context probes official sign-in before submit; blocks foreign and challenge routes',async()=>{
  const runtime=fakeRuntime();const browser=new CloakAdapter({executablePath:'C:/existing/cloak.exe',modulePath:'playwright-core',loadModule:async()=>runtime}).create();
  await browser.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'u',password:'p'}});await browser.probe({});
  assert.deepEqual(runtime.options.proxy,{server:'http://proxy.test:80',username:'u',password:'p'});assert.equal(runtime.options.headless,false);assert.equal(runtime.options.serviceWorkers,'block');
  assert.equal(runtime.options.locale,'en-US');
  assert.deepEqual(runtime.gotos,['https://account.apple.com/sign-in']);
  let aborted=0,continued=0;
  for(const url of ['https://foreign.test/','https://account.apple.com/otp/link','https://account.apple.com/sign-in'])await runtime.routeHandler({request:()=>({url:()=>url}),abort:async()=>aborted++,fetch:async()=>({status:()=>200}),fulfill:async()=>continued++});
  assert.equal(aborted,2);assert.equal(continued,1);assert.equal(typeof runtime.websocketHandler,'function');
  await browser.close();assert.equal(runtime.closed,1);
});
test('credential POST foreign 307 is never automatically followed or fulfilled',async()=>{
  const runtime=fakeRuntime();const b=new CloakAdapter({executablePath:'C:/chrome.exe',loadModule:async()=>runtime}).create();
  await b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});
  let options,aborted=0,fulfilled=0,continued=0;
  await runtime.routeHandler({request:()=>({url:()=>'https://idmsa.apple.com/appleauth/auth/signin'}),
    fetch:async o=>{options=o;return {status:()=>307,headers:()=>({location:'https://foreign.test/steal'})};},
    abort:async()=>aborted++,fulfill:async()=>fulfilled++,continue:async()=>continued++});
  assert.equal(continued,0);assert.equal(options.maxRedirects,0);assert.equal(aborted,1);assert.equal(fulfilled,0);await b.close();
});

test('Apple basic password verification is allowed only once after the password click; OTP stays blocked',async()=>{
 const runtime=fakeRuntime(),b=new CloakAdapter({executablePath:'C:/chrome.exe',loadModule:async()=>runtime}).create();
 await b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});
 let sent=0,aborted=0;const request=async(url,method='POST')=>runtime.routeHandler({request:()=>({url:()=>url,method:()=>method}),fetch:async()=>{sent++;return {status:()=>200};},fulfill:async()=>{},abort:async()=>{aborted++;}});
 const target='https://idmsa.apple.com/appleauth/auth/verify/password';
 await request(target);assert.equal(sent,0);
 b.passwordSubmitted=true;await request(target);assert.equal(sent,1);
 await request(target);await request(target,'GET');
 for(const url of [target+'?extra=1','https://idmsa.apple.com.evil.test/appleauth/auth/verify/password','https://idmsa.apple.com/appleauth/auth/verify/trusteddevice/securitycode','https://idmsa.apple.com/appleauth/auth/verify/phone/securitycode'])await request(url);
 assert.equal(sent,1);assert.equal(aborted,7);await b.close();
});
test('probe redirect off official origin and invalid proxy fail before credentials',async()=>{
  const runtime=fakeRuntime({blocked:true});const b=new CloakAdapter({executablePath:'C:/cloak.exe',loadModule:async()=>runtime}).create();
  await assert.rejects(b.open({profilePath:'C:/owned/profile',proxy:{server:'http://u:p@proxy.test:80'}}),/PROXY/);
  await b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});
  await assert.rejects(b.probe({}),/ROUTE/);await b.close();
});
test('abort during launch still closes the late owned context',async()=>{
  const runtime=fakeRuntime();let complete;
  const launch=runtime.chromium.launchPersistentContext;runtime.chromium.launchPersistentContext=(...args)=>new Promise(resolve=>{complete=async()=>resolve(await launch(...args));});
  const b=new CloakAdapter({executablePath:'C:/cloak.exe',loadModule:async()=>runtime}).create();const controller=new AbortController();
  const opening=b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''},signal:controller.signal});
  while(!complete)await new Promise(resolve=>setImmediate(resolve));controller.abort();await complete();
  await assert.rejects(opening);await b.close();assert.equal(runtime.closed,1);
});

test('failed launch cleans only its owned profile browser through the verified fallback',async()=>{
 const cleaned=[];let launches=0;
 const b=new CloakAdapter({executablePath:'C:/cloak.exe',loadModule:async()=>({chromium:{launchPersistentContext:async()=>{launches++;throw Error('LAUNCH_TIMEOUT')}}}),terminateBrowser:async profile=>{cleaned.push(profile)}}).create();
 await assert.rejects(b.open({profilePath:'C:/owned/profiles/one',proxy:{server:'http://proxy.test:80',username:'',password:''}}),/LAUNCH_TIMEOUT/);
 await b.close();await b.close();assert.equal(launches,1);assert.deepEqual(cleaned,['C:/owned/profiles/one']);
});

test('a settled failed launch can finish cleanup after fresh proof that its browser has exited',async()=>{
 let probes=0;const b=new CloakAdapter({executablePath:'C:/cloak.exe',loadModule:async()=>({chromium:{launchPersistentContext:async()=>{throw Error('Target browser has been closed; exitCode=21; password-secret');}}}),terminateBrowser:async()=>{throw Error('termination could not inspect departing process');},verifyNoBrowser:async()=>{probes++;return true;}}).create();
 await assert.rejects(b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}}));
 await b.close();assert.equal(probes,1);
 const d=await b.diagnostics();assert.equal(d.launch.failure,'EXITED');assert.equal(d.launch.exitCode,21);assert.equal(JSON.stringify(d).includes('password-secret'),false);
});

test('a late unresolved browser launch cannot be declared clean by an empty process snapshot',async()=>{
 let resolve,probes=0;const b=new CloakAdapter({executablePath:'C:/cloak.exe',timeoutMs:5,loadModule:async()=>({chromium:{launchPersistentContext:()=>new Promise(r=>{resolve=r;})}}),terminateBrowser:async()=>{throw Error('not proven');},verifyNoBrowser:async()=>{probes++;return true;}}).create();
 const opening=b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});const rejected=assert.rejects(opening);
 while(!resolve)await new Promise(r=>setImmediate(r));
 await assert.rejects(b.close());assert.equal(probes,0);resolve({close:async()=>{}});await rejected;
});

test('successful empty-process termination cannot release an unresolved future launch',async()=>{
 let resolve;const b=new CloakAdapter({executablePath:'C:/cloak.exe',timeoutMs:5,loadModule:async()=>({chromium:{launchPersistentContext:()=>new Promise(r=>{resolve=r;})}}),terminateBrowser:async()=>true,verifyNoBrowser:async()=>true}).create();
 const opening=b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});const rejected=assert.rejects(opening);
 while(!resolve)await new Promise(r=>setImmediate(r));await assert.rejects(b.close());resolve({close:async()=>{}});await rejected;
});
test('route probe waits for delayed official Apple iframe controls before revealing credentials',async()=>{
  const runtime=fakeRuntime({delayed:2});const b=new CloakAdapter({executablePath:'C:/cloak.exe',loadModule:async()=>runtime}).create();
  await b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});await b.probe({});
  assert.ok(runtime.lookups>=3);await b.close();
});
test('two-stage sign-in clicks password submit once and never follows a challenge link',async()=>{
  let phase='EMAIL',passwordClicks=0,emailClicks=0;const fills=[];
  const runtime=fakeRuntime();const original=runtime.chromium.launchPersistentContext;
  runtime.chromium.launchPersistentContext=async(...args)=>{
    const context=await original(...args);
    context.newPage=async()=>({
      goto:async()=>({ok:()=>true}),url:()=>'https://account.apple.com/sign-in',
      frames:()=>[{url:()=>'https://idmsa.apple.com/appleauth/auth/authorize/signin',locator:selector=>({
        count:async()=>['#account_name_text_field','#password_text_field','#sign-in','input[autocomplete="one-time-code"], input.form-security-code-input, input[id^="char"]'].includes(selector)?1:0,
        nth:()=>({isVisible:async()=>phase==='CHALLENGE'}),
        innerText:async()=>phase==='EMAIL'?'Continue':'Sign In',
        isVisible:async()=>selector==='#password_text_field'?phase==='PASSWORD':selector==='input[autocomplete="one-time-code"]'?phase==='CHALLENGE':true,
        fill:async value=>fills.push({selector,value}),click:async()=>{if(phase==='EMAIL'){emailClicks++;phase='PASSWORD';}else{passwordClicks++;phase='CHALLENGE';}},
      })}],
    });return context;
  };
  const b=new CloakAdapter({executablePath:'C:/cloak.exe',loadModule:async()=>runtime,resultWaitMs:1000}).create();
  await b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});await b.probe({});
  assert.deepEqual(await b.submit({email:'one@example.test',password:'secret'},{}),{result:'LIVE_2FA',explicit:true});
  await assert.rejects(b.submit({email:'one@example.test',password:'secret'},{}),/SUBMIT_ONCE/);
  assert.equal(emailClicks,1);assert.equal(passwordClicks,1);assert.deepEqual(fills,[{selector:'#account_name_text_field',value:'one@example.test'},{selector:'#password_text_field',value:'secret'}]);await b.close();
});

test('visible password field does not skip the Continue email phase',async()=>{
  let phase='EMAIL',emailClicks=0,passwordClicks=0;const fills=[];
  const runtime=fakeRuntime(),launch=runtime.chromium.launchPersistentContext;
  runtime.chromium.launchPersistentContext=async(...args)=>{const context=await launch(...args);context.newPage=async()=>({
    goto:async()=>({ok:()=>true}),url:()=>'https://account.apple.com/sign-in',
    frames:()=>[{url:()=>'https://idmsa.apple.com/appleauth/auth/authorize/signin',locator:selector=>({
      count:async()=>['#account_name_text_field','#password_text_field','#sign-in'].includes(selector)?1:selector==='[role="alert"], #errMsg, #alertInfo'&&phase==='RESULT'?1:0,
      nth:()=>({isVisible:async()=>true,innerText:async()=>"Your Apple Account or password was incorrect."}),
      isVisible:async()=>true,innerText:async()=>phase==='EMAIL'?'Continue':'Sign In',
      fill:async value=>{fills.push({selector,value,phase});},click:async()=>{if(phase==='EMAIL'){emailClicks++;phase='PASSWORD';}else{passwordClicks++;phase='RESULT';}},
    })}],
  });return context;};
  const b=new CloakAdapter({executablePath:'C:/cloak.exe',loadModule:async()=>runtime,resultWaitMs:1}).create();
  await b.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});await b.probe({});
  const outcome=await b.submit({email:'me@example.test',password:'secret'},{});
  assert.equal(outcome.result,'INVALID_CREDENTIALS');
  assert.equal(emailClicks,1);assert.equal(passwordClicks,1);
  assert.equal(fills.find(x=>x.selector==='#password_text_field').phase,'PASSWORD');
  await b.close();
});

// Both textboxes stay visible in every phase, matching the anonymous Apple DOM.
async function continueFixture(t,{loadingLabel='',stuck=false,challenge=false,throwPassword=false,passwordLabel='Sign In'}={}){
  let phase='EMAIL',emailClicks=0,passwordClicks=0,transition;
  const fills=[],runtime=fakeRuntime(),launch=runtime.chromium.launchPersistentContext;
  const otp='input[autocomplete="one-time-code"], input.form-security-code-input, input[id^="char"]';
  runtime.chromium.launchPersistentContext=async(...args)=>{
    const context=await launch(...args);
    context.newPage=async()=>({
      goto:async()=>({ok:()=>true}),url:()=>'https://account.apple.com/sign-in',
      frames:()=>[{url:()=>'https://idmsa.apple.com/appleauth/auth/authorize/signin',locator:selector=>({
        count:async()=>['#account_name_text_field','#password_text_field','#sign-in',otp].includes(selector)?1:0,
        isVisible:async()=>true,
        nth:()=>({isVisible:async()=>phase==='CHALLENGE'||phase==='RESULT'}),
        innerText:async()=>phase==='EMAIL'?'Continue':phase==='LOADING'?loadingLabel:passwordLabel,
        fill:async value=>{fills.push({selector,value,phase});},
        click:async()=>{
          if(phase==='EMAIL'){
            emailClicks++;
            if(challenge)phase='CHALLENGE';
            else if(!stuck){phase='LOADING';transition=setTimeout(()=>{phase='PASSWORD';},10);}
          }else{
            passwordClicks++;
            if(throwPassword)throw new Error('synthetic click failure');
            phase='RESULT';
          }
        },
      })}],
    });return context;
  };
  const browser=new CloakAdapter({executablePath:'C:/cloak.exe',loadModule:async()=>runtime,timeoutMs:50,resultWaitMs:50}).create();
  t.after(async()=>{clearTimeout(transition);await browser.close();});
  await browser.open({profilePath:'C:/owned/profile',proxy:{server:'http://proxy.test:80',username:'',password:''}});
  await browser.probe({});
  return {browser,fills,get emailClicks(){return emailClicks;},get passwordClicks(){return passwordClicks;}};
}

for(const [loadingLabel,passwordLabel] of [['','Sign In'],['Loading…','Sign in with password']]){
  test(`Continue waits through ${loadingLabel||'an empty label'} before filling or submitting the password`,async t=>{
    const f=await continueFixture(t,{loadingLabel,passwordLabel});
    assert.deepEqual(await f.browser.submit({email:'me@example.test',password:'secret'},{}),{result:'LIVE_2FA',explicit:true});
    assert.equal(f.emailClicks,1);assert.equal(f.passwordClicks,1);
    assert.deepEqual(f.fills,[
      {selector:'#account_name_text_field',value:'me@example.test',phase:'EMAIL'},
      {selector:'#password_text_field',value:'secret',phase:'PASSWORD'},
    ]);
  });
}

test('Continue that never transitions does not fill or submit a password',async t=>{
  const f=await continueFixture(t,{stuck:true});
  const result=await f.browser.submit({email:'me@example.test',password:'secret'},{});
  assert.equal(result.result,'UNKNOWN');
  assert.equal(f.emailClicks,1);assert.equal(f.passwordClicks,0);
  assert.deepEqual(f.fills,[{selector:'#account_name_text_field',value:'me@example.test',phase:'EMAIL'}]);
});

test('challenge after Continue stops before password fill or submit',async t=>{
  const f=await continueFixture(t,{challenge:true});
  assert.deepEqual(await f.browser.submit({email:'me@example.test',password:'secret'},{}),{result:'CHALLENGE_REQUIRED',explicit:true});
  assert.equal(f.emailClicks,1);assert.equal(f.passwordClicks,0);
  assert.deepEqual(f.fills,[{selector:'#account_name_text_field',value:'me@example.test',phase:'EMAIL'}]);
});

test('throwing password click is attempted once and a second submit is refused',async t=>{
  const f=await continueFixture(t,{throwPassword:true});
  assert.deepEqual(await f.browser.submit({email:'me@example.test',password:'secret'},{}),{result:'UNKNOWN',reasonCode:'PASSWORD_SUBMIT_FAILED'});
  await assert.rejects(f.browser.submit({email:'me@example.test',password:'secret'},{}),/SUBMIT_ONCE/);
  assert.equal(f.emailClicks,1);assert.equal(f.passwordClicks,1);
  assert.equal(f.fills.filter(item=>item.selector==='#password_text_field').length,1);
});
