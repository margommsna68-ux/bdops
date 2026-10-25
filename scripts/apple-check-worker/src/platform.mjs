import os from 'node:os';import path from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readFile,lstat,readdir} from 'node:fs/promises';
import {noLinks} from './store.mjs';
import {ApiClient} from './api.mjs';
const exec=promisify(execFile);
export async function powershell(script){
  if(process.platform!=='win32')throw new Error('WINDOWS_REQUIRED');
  const systemRuntime=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0');
  try{const {stdout}=await exec(path.join(systemRuntime,'powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(`$ErrorActionPreference='Stop';${script}`,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:1024*1024,env:{...process.env,PSModulePath:path.join(systemRuntime,'Modules')}});return stdout.trim();}
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
export async function resourceGate({platform=process.platform,freeMemory=os.freemem,desktopProbe=desktopAvailable,minFreeMemoryMb=2048,checkMemory=true}={}){
  if(platform!=='win32')return 'WAITING_DESKTOP';
  try{if(!await desktopProbe())return 'WAITING_DESKTOP';}catch{return 'WAITING_DESKTOP';}
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
  const allowed=['baseUrl','tokenFile','executablePath','modulePath','minFreeMemoryMb','heartbeatMs','pollMs','jobTimeoutMs','maxSlots'];
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!allowed.includes(k)))throw new Error('CONFIG_KEYS');
  try{new ApiClient({baseUrl:input.baseUrl,token:'validation-only'});}catch{throw new Error('CONFIG_ORIGIN');}
  for(const k of ['tokenFile','executablePath','modulePath'])if(typeof input[k]!=='string'||!path.isAbsolute(input[k]))throw new Error('CONFIG_PATH');
  if(path.win32.basename(input.executablePath).toLowerCase()!=='chrome.exe')throw new Error('CONFIG_BROWSER_NAME');
  if(!inside(path.join(root,'private'),input.tokenFile))throw new Error('CONFIG_PRIVATE_TOKEN');
  const c={minFreeMemoryMb:2048,heartbeatMs:10000,pollMs:15000,jobTimeoutMs:180000,maxSlots:5,...input};
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
  const target=path.resolve(profilePath).replaceAll('/','\\').toLowerCase();
  return processes.every(p=>{
    if(typeof p?.name!=='string')return false;
    if(p.name.toLowerCase()!=='chrome.exe')return true;
    if(typeof p.commandLine!=='string'||!p.commandLine.trim())return false;
    return !p.commandLine.replaceAll('/','\\').toLowerCase().includes(target);
  });
}
