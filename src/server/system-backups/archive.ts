import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {appendFile,open,stat,unlink,writeFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Writable,type Readable} from 'node:stream';
const MAGIC=Buffer.from('BDOPSB01');
export async function archiveChecksum(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function sealArchive(source:Readable,path:string,key:Buffer){
  if(key.length!==32)throw new Error('Invalid backup key');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);let created=false;
  try{
    await writeFile(path,Buffer.concat([MAGIC,iv]),{flag:'wx',mode:0o600});created=true;
    await pipeline(source,cipher,createWriteStream(path,{flags:'a',mode:0o600}));await appendFile(path,cipher.getAuthTag());
    return {bytes:(await stat(path)).size,checksum:await archiveChecksum(path)};
  }catch(error){if(created)await unlink(path).catch(()=>{});throw error;}
}
export async function* openArchive(path:string,key:Buffer):AsyncGenerator<Buffer>{
  if(key.length!==32)throw new Error('Invalid backup key');const size=(await stat(path)).size;if(size<36)throw new Error('Invalid archive');
  const handle=await open(path,'r'),header=Buffer.alloc(20),tag=Buffer.alloc(16);
  try{await handle.read(header,0,20,0);await handle.read(tag,0,16,size-16);}finally{await handle.close();}
  if(!header.subarray(0,8).equals(MAGIC))throw new Error('Invalid archive version');
  const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(8));decipher.setAuthTag(tag);
  const source=createReadStream(path,{start:20,end:size-17});source.on('error',error=>decipher.destroy(error));source.pipe(decipher);
  try{for await(const chunk of decipher)yield chunk;}finally{source.destroy();decipher.destroy();}
}
export async function verifyArchive(path:string,key:Buffer){await pipeline(openArchive(path,key),new Writable({write(_chunk,_encoding,callback){callback();}}));}
