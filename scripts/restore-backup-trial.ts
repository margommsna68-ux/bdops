import {config,parse} from 'dotenv';
import {readFileSync,existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {PrismaClient} from '@prisma/client';
import {archiveChecksum,verifyArchive,openArchive} from '../src/server/system-backups/archive';
import {assertRestoreTarget,backupConfiguration,type BackupManifest} from '../src/server/system-backups/service';
config({quiet:true});
async function main(){
  const target=process.env.RESTORE_DATABASE_URL||'',id=process.env.BACKUP_ID||'',binary=process.env.PG_RESTORE_PATH||'';
  const test=existsSync('.env.test')?parse(readFileSync('.env.test')).DATABASE_URL_TEST:undefined;
  const pg=assertRestoreTarget(target,process.env.DATABASE_URL||'',test),{directory,key}=backupConfiguration();
  if(!/^[a-f0-9-]{36}$/.test(id)||!isAbsolute(binary))throw new Error('BACKUP_ID and absolute PG_RESTORE_PATH required');
  const archive=join(directory,id+'.backup'),manifest=JSON.parse(await readFile(join(directory,id+'.json'),'utf8')) as BackupManifest;
  if(manifest.id!==id||manifest.checksum!==await archiveChecksum(archive))throw new Error('Backup checksum mismatch');await verifyArchive(archive,key);
  const db=new PrismaClient({datasources:{db:{url:target}}});
  try{
    const tables=await db.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`;
    if(Number(tables[0].count)!==0)throw new Error('Restore destination must be empty');
    const child=spawn(binary,['--dbname='+pg.PGDATABASE,'--no-owner','--no-acl','--no-password','--single-transaction','--exit-on-error'],{env:{...process.env,...pg},windowsHide:true,stdio:['pipe','ignore','pipe'],timeout:120000});child.stderr.resume();
    const completed=new Promise<boolean>(resolve=>{child.on('error',()=>resolve(false));child.on('close',code=>resolve(code===0));});
    try{await pipeline(openArchive(archive,key),child.stdin);if(!await completed)throw new Error('Restore process failed');}catch(error){child.kill();await completed;throw error;}
    console.log('Restored encrypted backup into isolated local database:',pg.PGDATABASE);
  }finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Restore failed. Active application database was not targeted. Check the private backup configuration and empty destination.');process.exitCode=1;});
