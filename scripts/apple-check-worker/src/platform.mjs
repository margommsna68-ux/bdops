import os from 'node:os';import path from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readFile,lstat,readdir} from 'node:fs/promises';
import {noLinks} from './store.mjs';
import {ApiClient} from './api.mjs';
const exec=promisify(execFile);
export async function powershell(script,{timeoutMs=15000}={}){
  if(process.platform!=='win32')throw new Error('WINDOWS_REQUIRED');
  const systemRuntime=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0');
  try{const {stdout}=await exec(path.join(systemRuntime,'powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(`$ErrorActionPreference='Stop';${script}`,'utf16le').toString('base64')],{windowsHide:true,timeout:timeoutMs,maxBuffer:1024*1024,env:{...process.env,PSModulePath:path.join(systemRuntime,'Modules')}});return stdout.trim();}
  catch{throw new Error('WINDOWS_PROBE_FAILED');}
}
const psLiteral=value=>"'"+value.replaceAll("'","''")+"'";
export async function desktopPath(){return powershell("[Environment]::GetFolderPath('Desktop')");}
export async function desktopAvailable(){
  const output=await powershell(`
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class AppleDesktop {
 [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
 [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desk);
 [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool GetUserObjectInformationW(IntPtr h, int index, StringBuilder value, uint length, out uint needed);
 [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool WTSQuerySessionInformationW(IntPtr server, int session, int info, out IntPtr buffer, out uint size);
 [DllImport("wtsapi32.dll")] public static extern void WTSFreeMemory(IntPtr memory);
}
'@
$session=[System.Diagnostics.Process]::GetCurrentProcess().SessionId;
$active=$false;$buffer=[IntPtr]::Zero;$size=[uint32]0;
if($session -gt 0 -and [AppleDesktop]::WTSQuerySessionInformationW([IntPtr]::Zero,$session,8,[ref]$buffer,[ref]$size)) {
 try {$active=[Runtime.InteropServices.Marshal]::ReadInt32($buffer) -eq 0} finally {[AppleDesktop]::WTSFreeMemory($buffer)}
}
$desk=[AppleDesktop]::OpenInputDesktop(0,$false,1);$name=New-Object System.Text.StringBuilder 512;$needed=[uint32]0;$unlocked=$false;
if($desk -ne [IntPtr]::Zero){try {$unlocked=[AppleDesktop]::GetUserObjectInformationW($desk,2,$name,1024,[ref]$needed) -and $name.ToString() -eq 'Default'} finally {[void][AppleDesktop]::CloseDesktop($desk)}}
($active -and $unlocked).ToString()
`);
  return output==='True';
}
export function cachedDesktopProbe(probe=desktopAvailable,{ttlMs=1000,now=Date.now}={}){
  let pending,at=0;
  return ()=>{
    if(!pending||now()-at>=ttlMs){at=now();pending=Promise.resolve().then(probe).catch(()=>false);}
    return pending;
  };
}
export async function resourceGate({platform=process.platform,freeMemory=os.freemem,desktopProbe=desktopAvailable,minFreeMemoryMb=2048,checkMemory=true,requireDesktop=true}={}){
  if(platform!=='win32')return 'WAITING_DESKTOP';
  if(requireDesktop){try{if(!await desktopProbe())return 'WAITING_DESKTOP';}catch{return 'WAITING_DESKTOP';}}
  return checkMemory&&freeMemory()<minFreeMemoryMb*1024*1024?'WAITING_RESOURCES':'IDLE';
}
export function privateAcl(value,{requireProtected=true,directory=true}={}){
  return (!requireProtected||value?.protected===true)&&Array.isArray(value?.rules)&&value.rules.some(r=>r.sid===value.userSid&&r.type==='Allow'&&(r.rights&2032127)===2032127)&&value.rules.every(r=>r.type==='Allow'&&[value.userSid,'S-1-5-18'].includes(r.sid)&&(!directory||(r.inheritance===3&&r.propagation===0)));
}
export async function secureDirectory(directory,{apply=false}={}){
  await noLinks(directory);
  const snapshot=await powershell(`
$target=${psLiteral(directory)};$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
${apply?`$acl=New-Object Security.AccessControl.DirectorySecurity;
$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);
foreach($who in @($sid,(New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'))){
 $rule=New-Object Security.AccessControl.FileSystemAccessRule($who,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $target -AclObject $acl;`:''}
$acl=Get-Acl -LiteralPath $target;
@{protected=$acl.AreAccessRulesProtected;userSid=$sid.Value;rules=@($acl.Access|ForEach-Object {@{sid=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;type=$_.AccessControlType.ToString();rights=[int]$_.FileSystemRights;inheritance=[int]$_.InheritanceFlags;propagation=[int]$_.PropagationFlags}})}|ConvertTo-Json -Depth 5 -Compress
`);
  if(!privateAcl(JSON.parse(snapshot)))throw new Error('PRIVATE_ACL_REQUIRED');
}
async function checkTree(directory){
  await noLinks(directory);
  for(const name of await readdir(directory)){
    const file=path.join(directory,name);await noLinks(file);if((await lstat(file)).isDirectory())await checkTree(file);
  }
}
export async function verifyPrivateState(root,{tokenFile,configFile}={}){
  const targets=[path.join(root,'state'),path.join(root,'private')];
  for(const directory of targets){try{await checkTree(directory);}catch(e){if(e.code!=='ENOENT')throw e;}}
  for(const file of [tokenFile,configFile].filter(Boolean))await noLinks(file);
  const snapshots=JSON.parse(await powershell(`
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
$items=@(Get-Item -LiteralPath ${psLiteral(root)});
foreach($dir in @(${targets.map(psLiteral).join(',')})){if(Test-Path -LiteralPath $dir){$items+=@(Get-Item -LiteralPath $dir);$items+=@(Get-ChildItem -LiteralPath $dir -Force -Recurse)}}
foreach($file in @(${[tokenFile,configFile].filter(Boolean).map(psLiteral).join(',')})){if(Test-Path -LiteralPath $file){$items+=@(Get-Item -LiteralPath $file)}}
@($items | ForEach-Object {$acl=Get-Acl -LiteralPath $_.FullName;@{directory=$_.PSIsContainer;protected=$acl.AreAccessRulesProtected;userSid=$sid;rules=@($acl.Access|ForEach-Object {@{sid=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;type=$_.AccessControlType.ToString();rights=[int]$_.FileSystemRights;inheritance=[int]$_.InheritanceFlags;propagation=[int]$_.PropagationFlags}})}})|ConvertTo-Json -Depth 6 -Compress
`));
  const all=Array.isArray(snapshots)?snapshots:[snapshots];
  if(!all.length||all.some((acl,index)=>!privateAcl(acl,{requireProtected:index===0,directory:acl.directory})))throw new Error('PRIVATE_CHILD_ACL_REQUIRED');
}
export function inside(root,file){const rel=path.relative(path.resolve(root),path.resolve(file));return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
export function validateConfig(input,root){
  const allowed=['baseUrl','tokenFile','executablePath','modulePath','minFreeMemoryMb','heartbeatMs','pollMs','jobTimeoutMs','maxSlots','headless'];
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!allowed.includes(k)))throw new Error('CONFIG_KEYS');
  try{new ApiClient({baseUrl:input.baseUrl,token:'validation-only'});}catch{throw new Error('CONFIG_ORIGIN');}
  for(const k of ['tokenFile','executablePath','modulePath'])if(typeof input[k]!=='string'||!path.isAbsolute(input[k]))throw new Error('CONFIG_PATH');
  if(path.win32.basename(input.executablePath).toLowerCase()!=='chrome.exe')throw new Error('CONFIG_BROWSER_NAME');
  if(!inside(path.join(root,'private'),input.tokenFile))throw new Error('CONFIG_PRIVATE_TOKEN');
  const c={minFreeMemoryMb:2048,heartbeatMs:10000,pollMs:15000,jobTimeoutMs:180000,maxSlots:5,headless:false,...input};
  if(typeof c.headless!=='boolean')throw new Error('CONFIG_HEADLESS');
  for(const [k,min,max] of [['minFreeMemoryMb',512,262144],['heartbeatMs',1000,20000],['pollMs',1000,60000],['jobTimeoutMs',1000,180000]])if(!Number.isInteger(c[k])||c[k]<min||c[k]>max)throw new Error('CONFIG_RANGE');
  if(!Number.isInteger(c.maxSlots)||c.maxSlots<1||c.maxSlots>5)throw new Error('CONFIG_RANGE');
  return c;
}
export async function loadConfig(file,root){
  await noLinks(file);const c=validateConfig(JSON.parse(await readFile(file,'utf8')),root);
  for(const f of [c.tokenFile,c.executablePath,c.modulePath]){await noLinks(f);if(!(await lstat(f)).isFile())throw new Error('CONFIG_FILE_REQUIRED');}
  await secureDirectory(root);await verifyPrivateState(root,{tokenFile:c.tokenFile,configFile:file});
  const token=(await readFile(c.tokenFile,'utf8')).replace(/^\uFEFF/,'').trim();
  return {config:c,token};
}
export async function noOwnedBrowser(profilePath,{inspect}={}){
  // Inspection only. Never terminate unrelated/shared browser processes.
  const processes=inspect?await inspect():JSON.parse(await powershell(`$items=@(Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" | ForEach-Object {@{name=$_.Name;commandLine=$_.CommandLine}});ConvertTo-Json -InputObject $items -Compress`));
  if(!Array.isArray(processes))return false;
  const target=canonicalBrowserPath(profilePath);
  return processes.every(p=>{
    if(typeof p?.name!=='string')return false;
    if(p.name.toLowerCase()!=='chrome.exe')return true;
    if(typeof p.commandLine!=='string'||!p.commandLine.trim())return false;
    const args=browserArguments(p.commandLine),profile=args&&browserProfile(args);
    return !!args&&profile!==undefined&&(profile===null||profile!==target);
  });
}

const canonicalBrowserPath=value=>path.win32.normalize(value.replaceAll('/','\\')).replace(/\\+$/,'').toLowerCase();
// Windows quoting rules: a profile path is an argument, never a command-line substring.
function browserArguments(line){
 if(typeof line!=='string'||!line.trim()||line.length>32768||line.includes('\0'))return null;
 const args=[];let word='',quoted=false,started=false;
 for(let i=0;i<line.length;i++){
  const c=line[i];
  if(c==='\\'){
   let n=1;while(line[i+1]==='\\'){n++;i++;}
   if(line[i+1]==='"'){word+='\\'.repeat(Math.floor(n/2));i++;if(n%2)word+='"';else quoted=!quoted;}
   else word+='\\'.repeat(n);
   started=true;
  }else if(c==='"'){quoted=!quoted;started=true;}
  else if(/\s/.test(c)&&!quoted){if(started){args.push(word);word='';started=false;}}
  else{word+=c;started=true;}
 }
 if(quoted)return null;if(started)args.push(word);return args;
}
function browserProfile(args){
 const found=[];
 for(let i=1;i<args.length;i++){
  if(args[i]==='--user-data-dir')found.push(args[++i]);
  else if(args[i].startsWith('--user-data-dir='))found.push(args[i].slice(16));
 }
 if(!found.length)return null;
 if(found.length!==1||!found[0]||!path.win32.isAbsolute(found[0]))return undefined;
 return canonicalBrowserPath(found[0]);
}
const chrome=p=>p?.name?.toLowerCase()==='chrome.exe';
const identity=p=>Number.isSafeInteger(p?.pid)&&p.pid>0&&Number.isSafeInteger(p.parentPid)&&p.parentPid>=0&&typeof p.creationTime==='string'&&/^\d+$/.test(p.creationTime);
const sameProcess=(a,b)=>identity(a)&&identity(b)&&a.pid===b.pid&&a.parentPid===b.parentPid&&a.creationTime===b.creationTime&&a.name===b.name&&a.commandLine===b.commandLine;
export function selectOwnedBrowserProcesses(profilePath,processes){
 if(!Array.isArray(processes)||processes.length>512)throw new Error('BROWSER_INSPECTION_INVALID');
 const target=canonicalBrowserPath(profilePath),selected=[],byId=new Map();
 for(const p of processes){if(byId.has(p?.pid))throw new Error('BROWSER_INSPECTION_INVALID');byId.set(p?.pid,p);}
 for(const p of processes){
  if(!chrome(p)||!identity(p))continue;
  const args=browserArguments(p.commandLine);
  if(args&&browserProfile(args)===target&&!args.some(a=>a==='--type'||a.startsWith('--type=')))selected.push(p);
 }
 const owned=new Set(selected.map(p=>p.pid));
 for(let i=0;i<selected.length;i++)for(const p of processes){
  if(owned.has(p.pid)||p.parentPid!==selected[i].pid||!chrome(p)||!identity(p)||BigInt(p.creationTime)<BigInt(selected[i].creationTime))continue;
  const args=browserArguments(p.commandLine),profile=args&&browserProfile(args);
  if(!args||profile===undefined||profile!==null&&profile!==target)continue;
  owned.add(p.pid);selected.push(p);
 }
 return selected;
}
async function ownedProfile(profilePath){
 if(typeof profilePath!=='string'||!path.isAbsolute(profilePath))throw new Error('PROFILE_OWNER');
 const full=await noLinks(profilePath),id=path.basename(full);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)||!(await lstat(full)).isDirectory())throw new Error('PROFILE_OWNER');
 const marker=path.join(full,'.owner');await noLinks(marker);
 if(!(await lstat(marker)).isFile()||await readFile(marker,'utf8')!==id)throw new Error('PROFILE_OWNER');
 return full;
}
async function inspectChrome(timeoutMs){
 return JSON.parse(await powershell(`$items=@(Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" | ForEach-Object {
 $stamp=$null;try{$handle=Get-Process -Id $_.ProcessId;[void]$handle.Handle;$stamp=$handle.StartTime.ToUniversalTime().Ticks.ToString()}catch{}
 @{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;creationTime=$stamp;name=$_.Name;commandLine=$_.CommandLine}
 });ConvertTo-Json -InputObject $items -Compress`,{timeoutMs}));
}
async function stopOwnedChrome(p,{ancestors,timeoutMs}){
 // Open the process handle BEFORE rechecking CIM/creation identity. Stop only this handle,
 // never taskkill /T or a later lookup by PID, which could select a reused foreign PID.
 const expected=JSON.stringify([p,...ancestors]);
 const result=await powershell(`$expected=ConvertFrom-Json ${psLiteral(expected)};$targetHandle=$null;
 foreach($item in $expected){
  $native=Get-Process -Id $item.pid -ErrorAction SilentlyContinue;
  if(!$native){if($item.pid -eq ${p.pid}){Write-Output 'GONE';exit};throw 'IDENTITY'}
  [void]$native.Handle;
  $row=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$item.pid);
  if(!$row -or $row.Name -ine 'chrome.exe' -or $row.CommandLine -cne $item.commandLine -or [int]$row.ParentProcessId -ne [int]$item.parentPid -or $native.StartTime.ToUniversalTime().Ticks.ToString() -cne $item.creationTime){throw 'IDENTITY'}
  if($item.pid -eq ${p.pid}){$targetHandle=$native}
 }
 if(!$targetHandle){throw 'IDENTITY'}
 if(!$targetHandle.HasExited){Stop-Process -InputObject $targetHandle -Force}
 Write-Output 'STOPPED'`,{timeoutMs});
 if(!['GONE','STOPPED'].includes(result))throw new Error('OWNED_BROWSER_CLEANUP_FAILED');
}
export async function terminateOwnedBrowser(profilePath,{inspect,terminate}={}){
 const full=await ownedProfile(profilePath),deadline=Date.now()+18000;
 // Injection is all-or-nothing so a test can never accidentally stop a real process.
 if(!!inspect!==!!terminate)throw new Error('BROWSER_OPERATIONS_REQUIRED');
 const remaining=()=>{const ms=Math.min(4000,deadline-Date.now());if(ms<=0)throw new Error('OWNED_BROWSER_CLEANUP_FAILED');return ms;};
 const inspectNow=()=>inspect?inspect():inspectChrome(remaining());
 const original=selectOwnedBrowserProcesses(full,await inspectNow()),originalById=new Map(original.map(p=>[p.pid,p]));
 for(const p of [...original].reverse()){
  remaining();await ownedProfile(full);
  const rows=await inspectNow(),current=rows.find(r=>r.pid===p.pid);
  if(!current)continue;
  if(!sameProcess(p,current))throw new Error('BROWSER_IDENTITY_CHANGED');
  const selected=selectOwnedBrowserProcesses(full,rows);
  if(!selected.some(r=>sameProcess(r,p)))throw new Error('BROWSER_IDENTITY_CHANGED');
  const ancestors=[];let parent=originalById.get(p.parentPid);
  while(parent){
   if(!rows.some(r=>sameProcess(r,parent)))throw new Error('BROWSER_IDENTITY_CHANGED');
   ancestors.push(parent);parent=originalById.get(parent.parentPid);
   if(ancestors.length>original.length)throw new Error('BROWSER_IDENTITY_CHANGED');
  }
  try{await (terminate??stopOwnedChrome)(p,{ancestors,profilePath:full,timeoutMs:remaining()});}
  catch{throw new Error('OWNED_BROWSER_CLEANUP_FAILED');}
 }
 remaining();await ownedProfile(full);
 const after=await inspectNow();
 // Retain departed parents as verification-only anchors: a newly spawned Chrome
 // child may outlive its root without carrying --user-data-dir of its own.
 const lineage=selectOwnedBrowserProcesses(full,[...after,...original.filter(p=>!after.some(current=>current.pid===p.pid))]);
 if(after.some(p=>lineage.some(old=>sameProcess(p,old)))||!await noOwnedBrowser(full,{inspect:async()=>after}))throw new Error('OWNED_BROWSER_UNRESOLVED');
 return true;
}
