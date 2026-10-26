import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildPackage,root} from './build.mjs';
const {out,files}=buildPackage();let failures=0;
function run(args){const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.status!==0)failures++;return r;}
for(const name of Object.keys(files))run(['--check',path.join(out,name)]);
for(const mode of ['baseline','patched']){
 const dir=path.join(root,'.work',mode);fs.mkdirSync(dir,{recursive:true});
 fs.cpSync(path.join(root,'base/engine'),path.join(dir,'engine'),{recursive:true});
 fs.cpSync(path.join(root,'base/test'),path.join(dir,'test'),{recursive:true});
 fs.copyFileSync(path.join(root,'base/main.mjs'),path.join(dir,'main.mjs'));
 if(mode==='patched'){
  fs.cpSync(path.join(root,'engine'),path.join(dir,'engine'),{recursive:true});fs.copyFileSync(path.join(out,'main.mjs'),path.join(dir,'main.mjs'));
  // Only legacy literal source guards need new import/call spelling; behavioral assertions stay byte-for-byte.
  const file=path.join(dir,'test/earnapp-monitor-v3116.mjs');let s=fs.readFileSync(file,'utf8');
  s=s.replace("'./vm-name.mjs']);","'./vm-name.mjs', './native-monitor-canary.mjs']);");
  s=s.replace('readGuestHelperCore\\(vboxScan, CFG, vm\\.uuid, gr\\.username, \\{ signal \\}\\)', 'readGuestHelperCore\\(nativeMonitorVbox, CFG, vm\\.uuid, gr\\.username, \\{ signal,');
  fs.writeFileSync(file,s);
  const cycle=path.join(dir,'test/earnapp-monitor-cycle-v3118.mjs');let c=fs.readFileSync(cycle,'utf8');
  c=c.replace('hostCache: hostCacheSnapshot\\(\\) \\}\\)', 'hostCache: hostCacheSnapshot\\(\\), nativeMonitorV1: nativeMonitorSourceLatest \\}\\)');
  c=c.replace('listVms: async \\(\\) => \\{ await discover', 'listVms: async \\(\\) => \\{ if \\(nativeCanary\\) return readNativeInventory\\(nativeMonitorVbox\\); await discover');
  fs.writeFileSync(cycle,c);
 }
 console.log('LEGACY '+mode);
 for(const name of fs.readdirSync(path.join(dir,'test')).filter(n=>n.endsWith('.mjs')))run([path.join(dir,'test',name)]);
}
console.log('PACKAGE');
run(['--test','--test-concurrency=1',...fs.readdirSync(path.join(root,'test')).filter(n=>n.endsWith('.test.mjs')).map(n=>path.join(root,'test',n))]);
process.exitCode=failures?1:0;
