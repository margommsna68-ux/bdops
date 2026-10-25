import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {resourceGate,validateConfig,privateAcl,secureDirectory,verifyPrivateState,powershell,noOwnedBrowser} from '../src/platform.mjs';
import {installRelease,rollback,status,requestStop} from '../src/manage.mjs';

test('RAM/Windows active desktop gating fails closed',async()=>{
  assert.equal(await resourceGate({platform:'linux',freeMemory:()=>8e9,desktopProbe:async()=>true}),'WAITING_DESKTOP');
  assert.equal(await resourceGate({platform:'win32',freeMemory:()=>8e9,desktopProbe:async()=>false}),'WAITING_DESKTOP');
  assert.equal(await resourceGate({platform:'win32',freeMemory:()=>1e9,desktopProbe:async()=>true,minFreeMemoryMb:2048}),'WAITING_RESOURCES');
  assert.equal(await resourceGate({platform:'win32',freeMemory:()=>8e9,desktopProbe:async()=>{throw new Error('probe');}}),'WAITING_DESKTOP');
  assert.equal(await resourceGate({platform:'win32',freeMemory:()=>8e9,desktopProbe:async()=>true}),'IDLE');
});
test('config rejects inline credentials, unsafe API origin, shared data/token paths and invalid timeouts',()=>{
  const root=path.resolve('owned');const config={baseUrl:'https://wow.lalamail.sbs',tokenFile:path.join(root,'private','token.txt'),executablePath:path.resolve('chrome.exe'),modulePath:path.resolve('playwright-core','index.mjs')};
  assert.equal(validateConfig(config,root).heartbeatMs,10000);
  for(const extra of [{token:'secret'},{baseUrl:'https://wow.lalamail.sbs/api'},{tokenFile:path.resolve('outside.txt')},{executablePath:path.resolve('renamed.exe')},{heartbeatMs:90000},{jobTimeoutMs:200000}])assert.throws(()=>validateConfig({...config,...extra},root),/CONFIG/);
});
test('private ACL rejects public access and unprotected inheritance',()=>{
  assert.equal(privateAcl({protected:true,userSid:'u',rules:[{sid:'u',type:'Allow',rights:2032127,inheritance:3,propagation:0},{sid:'S-1-5-18',type:'Allow',rights:2032127,inheritance:3,propagation:0}]}),true);
  assert.equal(privateAcl({protected:true,userSid:'u',rules:[{sid:'u',type:'Allow',rights:2032127,inheritance:0,propagation:0}]}),false);
  assert.equal(privateAcl({protected:true,userSid:'u',rules:[{sid:'u',type:'Allow',rights:2032127},{sid:'S-1-1-0',type:'Allow',rights:1}]}),false);
  assert.equal(privateAcl({protected:false,userSid:'u',rules:[{sid:'u',type:'Allow',rights:2032127}]}),false);
});
test('versioned install preserves config/state, stops cooperatively and rolls back only while unlocked',async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'apple-release-'));const desktop=path.join(temp,'Desktop');await mkdir(desktop);
  const root=path.join(desktop,'MoneyToHome','AppleCheckWorker');const source=path.join(temp,'source');await mkdir(path.join(source,'src'),{recursive:true});
  const config={baseUrl:'https://wow.lalamail.sbs',tokenFile:path.join(root,'private','token.txt'),executablePath:path.join(temp,'chrome.exe'),modulePath:path.join(temp,'playwright','index.mjs')};
  await writeFile(path.join(source,'worker.mjs'),'console.log("fixture");');await writeFile(path.join(source,'src','a.mjs'),'export const a=1;');
  await writeFile(path.join(source,'package.json'),JSON.stringify({name:'moneytohome-apple-check-worker',version:'1.0.0'}));
  const secure=async()=>{};
  await installRelease({root,desktop,source,config,secure});assert.equal((await status(root)).version,'1.0.0');
  await writeFile(path.join(root,'private','keep.txt'),'keep');
  await writeFile(path.join(source,'package.json'),JSON.stringify({name:'moneytohome-apple-check-worker',version:'1.0.1'}));
  await installRelease({root,desktop,source,config,secure});assert.equal((await status(root)).version,'1.0.1');
  await writeFile(path.join(root,'state','worker.lock'),'{}');await assert.rejects(rollback(root),/STOP/);
  await requestStop(root);assert.equal(JSON.parse(await readFile(path.join(root,'state','stop.json'),'utf8')).requested,true);
  const fs=await import('node:fs/promises');await fs.unlink(path.join(root,'state','worker.lock'));
  await rollback(root);assert.equal((await status(root)).version,'1.0.0');assert.equal(await readFile(path.join(root,'private','keep.txt'),'utf8'),'keep');
  await assert.rejects(installRelease({root:path.join(temp,'shared'),desktop,source,config,secure}),/INSTALL_ROOT/);
});
test('release staging rejects symlinks and source tampering is detected before start',async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'apple-stage-')),desktop=path.join(temp,'Desktop');await mkdir(desktop);
  const root=path.join(desktop,'MoneyToHome','AppleCheckWorker'),source=path.join(temp,'source');await mkdir(path.join(source,'src'),{recursive:true});
  await writeFile(path.join(source,'package.json'),JSON.stringify({name:'moneytohome-apple-check-worker',version:'1.0.0'}));await writeFile(path.join(source,'worker.mjs'),'x');
  await symlink(desktop,path.join(source,'src','foreign'),'junction');
  const config={baseUrl:'https://wow.lalamail.sbs',tokenFile:path.join(root,'private','token.txt'),executablePath:path.join(temp,'chrome.exe'),modulePath:path.join(temp,'playwright','index.mjs')};
  await assert.rejects(installRelease({root,desktop,source,config,secure:async()=>{}}),/LINK/);
});
test('browser process verification treats missing commandline as unresolved and inspects configured chrome identity',async()=>{
  const profile=path.resolve('owned-profile');
  assert.equal(await noOwnedBrowser(profile,{inspect:async()=>[]}),true);
  assert.equal(await noOwnedBrowser(profile,{inspect:async()=>[{name:'chrome.exe',commandLine:null}]}),false);
  assert.equal(await noOwnedBrowser(profile,{inspect:async()=>[{name:'chrome.exe',commandLine:`chrome.exe --user-data-dir="${profile}"`}]}),false);
  assert.equal(await noOwnedBrowser(profile,{inspect:async()=>[{name:'chrome.exe',commandLine:'chrome.exe --user-data-dir="C:/foreign"'}]}),true);
});
test('native effective ACL check refuses a public token child even under a private root',{skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'apple-native-acl-'));await secureDirectory(root,{apply:true});
  await mkdir(path.join(root,'state','profiles'),{recursive:true});await mkdir(path.join(root,'private'));
  const tokenFile=path.join(root,'private','token.txt');await writeFile(tokenFile,'fixture');await verifyPrivateState(root,{tokenFile});
  const escaped=tokenFile.replaceAll("'","''");
  await powershell(`$file='${escaped}';$acl=Get-Acl -LiteralPath $file;$sid=New-Object Security.Principal.SecurityIdentifier 'S-1-1-0';$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'Read','Allow');$acl.AddAccessRule($rule);Set-Acl -LiteralPath $file -AclObject $acl`);
  await assert.rejects(verifyPrivateState(root,{tokenFile}),/ACL/);
});
