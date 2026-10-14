import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {access,mkdir,open,readdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError} from '../proxy-management/types';
import {sealArchive} from './archive';
export function assertSystemOwner(actorId:string,ownerId=process.env.SYSTEM_OWNER_USER_ID){if(!ownerId||!actorId||actorId!==ownerId)throw new ProxyDomainError('FORBIDDEN','Chỉ chủ hệ thống được quản lý sao lưu');}
export function pgEnvironment(databaseUrl:string){
  const url=new URL(databaseUrl);if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.pathname==='/')throw new Error('Invalid database configuration');
  const sslmode=url.searchParams.get('sslmode')||'prefer';if(!['disable','allow','prefer','require','verify-ca','verify-full'].includes(sslmode))throw new Error('Invalid SSL mode');
  return {PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:sslmode,PGCONNECT_TIMEOUT:'15',PGAPPNAME:'bdops-system-backup'};
}
export function assertRestoreTarget(targetUrl:string,appUrl:string,testUrl?:string){
  const target=pgEnvironment(targetUrl),app=pgEnvironment(appUrl),test=testUrl?pgEnvironment(testUrl):null;
  const fingerprint=(v:typeof target)=>[v.PGHOST==='localhost'?'127.0.0.1':v.PGHOST,v.PGPORT,v.PGDATABASE].join('/');
  if(!['127.0.0.1','localhost'].includes(target.PGHOST)||!/^proxy_restore_[a-z0-9_]+$/.test(target.PGDATABASE)||fingerprint(target)===fingerprint(app)||(test&&fingerprint(target)===fingerprint(test)))throw new Error('Restore requires a separate local proxy_restore_* database');
  return target;
}
export interface BackupManifest {version:1;id:string;createdAt:string;bytes:number;checksum:string;appVersion:string;schemaVersion:string;appKeyFingerprint:string;backupKeyFingerprint:string}
export function backupConfiguration(){
  const directory=process.env.BACKUP_DIRECTORY,keyText=process.env.BACKUP_ENCRYPTION_KEY,appKey=process.env.ENCRYPTION_KEY,binary=process.env.PG_DUMP_PATH;
  if(!directory||!isAbsolute(directory)||!keyText||!/^[a-fA-F0-9]{64}$/.test(keyText)||!appKey||!binary||!isAbsolute(binary))throw new ProxyDomainError('SOURCE_UNAVAILABLE','Chưa cấu hình nơi lưu hoặc khóa sao lưu trên server');
  return {directory,key:Buffer.from(keyText,'hex'),binary,appKey};
}
const fingerprint=(value:Buffer)=>createHash('sha256').update(value).digest('hex').slice(0,16);
export async function listSystemBackups(actorId:string){
  assertSystemOwner(actorId);const {directory}=backupConfiguration();const files=await readdir(directory).catch(()=>[] as string[]);
  const rows:BackupManifest[]=[];for(const name of files)if(/^[a-f0-9-]{36}\.json$/.test(name)){try{const item=JSON.parse(await readFile(join(directory,name),'utf8')) as BackupManifest;if(item.version===1&&item.id+'.json'===name)rows.push(item);}catch{}}
  return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50);
}
export async function createSystemBackup(actorId:string,db:PrismaClient=prisma){
  assertSystemOwner(actorId);if(!await db.user.findUnique({where:{id:actorId}}))throw new ProxyDomainError('FORBIDDEN');
  const {directory,key,binary,appKey}=backupConfiguration(),pg=pgEnvironment(process.env.DATABASE_URL||'');await access(binary);await mkdir(directory,{recursive:true,mode:0o700});
  const lockPath=join(directory,'.creating-backup'),id=randomUUID(),temporary=join(directory,id+'.partial'),archive=join(directory,id+'.backup');
  let lock;try{lock=await open(lockPath,'wx',0o600);}catch{throw new ProxyDomainError('STALE_PREVIEW','Đang tạo một bản sao khác. Chờ hoàn tất.');}
  const child=spawn(binary,['--format=custom','--no-owner','--no-acl','--no-password'],{env:{...process.env,...pg},windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:120000});
  const completion=new Promise<boolean>(resolve=>{child.on('error',()=>{child.stdout.destroy(new Error('Backup process failed'));resolve(false);});child.on('close',code=>resolve(code===0));});child.stderr.resume();
  try{
    await db.auditLog.create({data:{userId:actorId,action:'SYSTEM_BACKUP_STARTED',entity:'SystemBackup',entityId:id}});
    const sealed=await sealArchive(child.stdout,temporary,key);if(!await completion)throw new Error('Backup process failed');
    const migrations=await db.$queryRaw<{migration_name:string}[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`;
    const manifest:BackupManifest={version:1,id,createdAt:new Date().toISOString(),...sealed,appVersion:'8.9.0',schemaVersion:migrations[0]?.migration_name||'unversioned',appKeyFingerprint:fingerprint(Buffer.from(appKey,'hex')),backupKeyFingerprint:fingerprint(key)};
    await rename(temporary,archive);await writeFile(join(directory,id+'.json.partial'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});await rename(join(directory,id+'.json.partial'),join(directory,id+'.json'));
    await db.auditLog.create({data:{userId:actorId,action:'SYSTEM_BACKUP_COMPLETED',entity:'SystemBackup',entityId:id,changes:{bytes:manifest.bytes,checksum:manifest.checksum}}});return manifest;
  }catch{
    child.kill();await completion;await Promise.all([temporary,archive,join(directory,id+'.json.partial'),join(directory,id+'.json')].map(path=>unlink(path).catch(()=>{})));
    await db.auditLog.create({data:{userId:actorId,action:'SYSTEM_BACKUP_FAILED',entity:'SystemBackup',entityId:id}}).catch(()=>{});
    throw new ProxyDomainError('SOURCE_UNAVAILABLE','Chưa tạo được bản sao. Không có bản sao lỗi trong danh sách; dữ liệu đang chạy được giữ nguyên.');
  }finally{await lock.close();await unlink(lockPath).catch(()=>{});}
}
