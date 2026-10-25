import test from 'node:test';import assert from 'node:assert/strict';
import {CloakAdapter,interpretEvidence,officialUrl} from '../src/browser.mjs';

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
function fakeRuntime({blocked=false,delayed=0}={}){
  let options,routeHandler,websocketHandler,closed=0,gotos=[],lookups=0;
  const frame={url:()=>'https://idmsa.apple.com/appleauth/auth/authorize/signin',locator:selector=>({count:async()=>selector==='#account_name_text_field'?1:0,isVisible:async()=>++lookups>delayed})};
  const page={goto:async url=>{gotos.push(url);return {ok:()=>true};},url:()=>blocked?'https://evil.test':'https://account.apple.com/sign-in',frames:()=>[frame]};
  const context={route:async(_,h)=>routeHandler=h,routeWebSocket:async(_,h)=>websocketHandler=h,
    on:()=>{},newPage:async()=>page,close:async()=>{closed++;}};
  const chromium={launchPersistentContext:async(_,o)=>{options=o;return context;}};
  return {chromium,get lookups(){return lookups;},get options(){return options;},get closed(){return closed;},get gotos(){return gotos;},get routeHandler(){return routeHandler;},get websocketHandler(){return websocketHandler;}};
}
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
