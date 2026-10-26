import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {transformMain} from './transform-main.mjs';
export const root=path.dirname(fileURLToPath(import.meta.url));
export function buildPackage(){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'base-sha256.json'),'utf8'));
 for(const [name,sha] of Object.entries(manifest.base)){
  const bytes=fs.readFileSync(path.join(root,'base',name));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==sha)throw Error('BASE_SHA_MISMATCH: '+name);
 }
 const out=path.join(root,'output');fs.mkdirSync(out,{recursive:true});
 fs.cpSync(path.join(root,'engine'),path.join(out,'engine'),{recursive:true});
 fs.writeFileSync(path.join(out,'main.mjs'),transformMain(fs.readFileSync(path.join(root,'base/main.mjs'))));
 const files={};for(const name of ['main.mjs',...fs.readdirSync(path.join(root,'engine')).map(n=>'engine/'+n)]){
  const b=fs.readFileSync(path.join(out,name));files[name]={sha256:crypto.createHash('sha256').update(b).digest('hex'),bytes:b.length};
 }
 fs.writeFileSync(path.join(out,'patch-manifest.json'),JSON.stringify({sourceVersion:'3.1.18',installed:false,files},null,2)+'\n');
 return {out,files};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=buildPackage();console.log(JSON.stringify({builtFiles:Object.keys(result.files).length,installed:false,output:result.out}));
}
