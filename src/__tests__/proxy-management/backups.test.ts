import {expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {sealArchive,verifyArchive,openArchive} from '@/server/system-backups/archive';
import {assertSystemOwner,assertRestoreTarget,pgEnvironment,createSystemBackup} from '@/server/system-backups/service';
import {testClient} from './db-fixture';
import {randomUUID} from 'node:crypto';
it('only configured system owner can operate system backups, not a project admin',()=>{
  expect(()=>assertSystemOwner('admin','')).toThrow('FORBIDDEN');expect(()=>assertSystemOwner('admin','owner')).toThrow('FORBIDDEN');expect(()=>assertSystemOwner('owner','owner')).not.toThrow();
});
it('dump failure publishes no backup and releases the lock for another attempt',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bdops-backup-process-')),db=testClient(),userId=randomUUID();
  const fields=['SYSTEM_OWNER_USER_ID','BACKUP_DIRECTORY','BACKUP_ENCRYPTION_KEY','PG_DUMP_PATH','DATABASE_URL'],previous=Object.fromEntries(fields.map(k=>[k,process.env[k]]));
  try{
    await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
    process.env.SYSTEM_OWNER_USER_ID=userId;process.env.BACKUP_DIRECTORY=dir;process.env.BACKUP_ENCRYPTION_KEY=randomBytes(32).toString('hex');process.env.PG_DUMP_PATH=process.execPath;process.env.DATABASE_URL=process.env.DATABASE_URL_TEST;
    await expect(createSystemBackup(userId,db)).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});
    const {readdir}=await import('node:fs/promises');expect(await readdir(dir)).toEqual([]);
    await expect(createSystemBackup(userId,db)).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});expect(await readdir(dir)).toEqual([]);
  }finally{for(const k of fields){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}await db.auditLog.deleteMany({where:{userId}});await db.user.delete({where:{id:userId}});await db.$disconnect();if(resolve(dir).startsWith(resolve(tmpdir())+'\\')||resolve(dir).startsWith(resolve(tmpdir())+'/'))await rm(dir,{recursive:true,force:true});}
});
it('stream failure removes an incomplete archive and preserves an existing archive',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bdops-backup-stream-')),path=join(dir,'archive'),key=randomBytes(32);
  try{
    const source=Readable.from((async function*(){yield Buffer.from('partial');throw new Error('Source failed');})());await expect(sealArchive(source,path,key)).rejects.toThrow('Source failed');await expect(readFile(path)).rejects.toMatchObject({code:'ENOENT'});
    await writeFile(path,'existing');await expect(sealArchive(Readable.from(['new']),path,key)).rejects.toMatchObject({code:'EEXIST'});expect((await readFile(path)).toString()).toBe('existing');
  }finally{if(resolve(dir).startsWith(resolve(tmpdir())+'\\')||resolve(dir).startsWith(resolve(tmpdir())+'/'))await rm(dir,{recursive:true,force:true});}
});
it('encrypted stream verifies and decrypts; wrong key and damage reject before restore',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bdops-backup-test-')),path=join(dir,'archive'),key=randomBytes(32);
  try{
    await sealArchive(Readable.from([Buffer.from('private dump contents')]),path,key);
    expect((await readFile(path)).includes(Buffer.from('private dump contents'))).toBe(false);
    await verifyArchive(path,key);const chunks:Buffer[]=[];for await(const c of openArchive(path,key))chunks.push(c);expect(Buffer.concat(chunks).toString()).toBe('private dump contents');
    await expect(verifyArchive(path,randomBytes(32))).rejects.toThrow();const bytes=await readFile(path);bytes[22]^=1;await writeFile(path,bytes);await expect(verifyArchive(path,key)).rejects.toThrow();
  }finally{if(resolve(dir).startsWith(resolve(tmpdir())+'\\')||resolve(dir).startsWith(resolve(tmpdir())+'/'))await rm(dir,{recursive:true,force:true});}
});
it('restore requires separate local proxy_restore database, credentials kept out of process arguments',()=>{
  const app='postgresql://user:secret@127.0.0.1:55432/proxy_app_trial';
  expect(()=>assertRestoreTarget(app,app)).toThrow();expect(()=>assertRestoreTarget('postgresql://u:p@remote:5432/proxy_restore_test',app)).toThrow();expect(()=>assertRestoreTarget('postgresql://u:p@127.0.0.1:55432/proxy_test',app)).toThrow();
  expect(()=>assertRestoreTarget('postgresql://u:p@127.0.0.1:55432/proxy_restore_test',app)).not.toThrow();
  expect(pgEnvironment(app)).toMatchObject({PGUSER:'user',PGPASSWORD:'secret',PGHOST:'127.0.0.1',PGPORT:'55432',PGDATABASE:'proxy_app_trial'});
});
