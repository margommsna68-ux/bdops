import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {resourceGate,validateConfig} from '../src/platform.mjs';
import {CloakAdapter} from '../src/browser.mjs';

test('headless background work never probes a locked or absent desktop',async()=>{
  let probes=0;
  const desktopProbe=async()=>{probes++;throw new Error('no interactive session');};
  assert.equal(await resourceGate({platform:'win32',requireDesktop:false,desktopProbe,freeMemory:()=>8e9}),'IDLE');
  assert.equal(probes,0);
  assert.equal(await resourceGate({platform:'win32',requireDesktop:false,desktopProbe,freeMemory:()=>1}),'WAITING_RESOURCES');
  assert.equal(await resourceGate({platform:'win32',requireDesktop:false,desktopProbe,freeMemory:()=>1,checkMemory:false}),'IDLE');
  assert.equal(await resourceGate({platform:'linux',requireDesktop:false,desktopProbe,freeMemory:()=>8e9}),'WAITING_DESKTOP');
  assert.equal(probes,0);
});

test('visible work still waits when the desktop is unavailable',async()=>{
  assert.equal(await resourceGate({platform:'win32',desktopProbe:async()=>false,freeMemory:()=>8e9}),'WAITING_DESKTOP');
  assert.equal(await resourceGate({platform:'win32',requireDesktop:true,desktopProbe:async()=>false,checkMemory:false}),'WAITING_DESKTOP');
});

test('headless configuration is explicit and strictly boolean, with visible-mode compatibility',()=>{
  const root=path.resolve('owned');
  const c={baseUrl:'https://wow.lalamail.sbs',tokenFile:path.join(root,'private','token.txt'),executablePath:path.resolve('chrome.exe'),modulePath:path.resolve('playwright','index.mjs')};
  assert.equal(validateConfig(c,root).headless,false);
  assert.equal(validateConfig({...c,headless:true},root).headless,true);
  assert.equal(validateConfig({...c,headless:false},root).headless,false);
  for(const headless of ['true',1,null,{},[]])assert.throws(()=>validateConfig({...c,headless},root),/CONFIG/);
});

test('background browser uses a headless owned proxied context and the existing network guards',async()=>{
  let options,profile,closed=0,routes=0,sockets=0;
  const context={route:async()=>{routes++;},routeWebSocket:async()=>{sockets++;},on:()=>{},newPage:async()=>({on:()=>{}}),close:async()=>{closed++;}};
  const browser=new CloakAdapter({executablePath:'C:/chrome.exe',headless:true,loadModule:async()=>({chromium:{launchPersistentContext:async(p,o)=>{profile=p;options=o;return context;}}})}).create();
  await browser.open({profilePath:'C:/owned/uuid-profile',proxy:{server:'http://proxy.test:80',username:'u',password:'p'}});
  assert.equal(options.headless,true);
  assert.equal(profile,'C:/owned/uuid-profile');
  assert.deepEqual(options.proxy,{server:'http://proxy.test:80',username:'u',password:'p'});
  assert.equal(options.serviceWorkers,'block');assert.equal(options.acceptDownloads,false);
  assert.equal(routes,1);assert.equal(sockets,1);
  await browser.close();assert.equal(closed,1);
});
