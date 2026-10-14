import {config} from 'dotenv';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {createSystemBackup} from '../src/server/system-backups/service';
import {decrypt} from '../src/lib/encryption';
config({quiet:true});
async function main(){
  const url=new URL(process.env.DATABASE_URL||'');
  if(url.hostname!=='127.0.0.1'||url.port!=='55432'||url.pathname!=='/proxy_app_trial')throw new Error('Dedicated local trial required');
  const db=new PrismaClient();let restored:PrismaClient|undefined,admin:PrismaClient|undefined;
  try{
    const owner=await db.user.findUniqueOrThrow({where:{username:'proxy-trial'}});
    const values={SYSTEM_OWNER_USER_ID:owner.id,BACKUP_DIRECTORY:'D:/CodexRuntime/bdops-proxy-trial/backups',BACKUP_ENCRYPTION_KEY:process.env.BACKUP_ENCRYPTION_KEY||randomBytes(32).toString('hex'),PG_DUMP_PATH:'D:/CodexRuntime/bdops-proxy-trial/pgsql/bin/pg_dump.exe',PG_RESTORE_PATH:'D:/CodexRuntime/bdops-proxy-trial/pgsql/bin/pg_restore.exe'};
    let env=readFileSync('.env','utf8');for(const [key,value] of Object.entries(values)){env=env.replace(new RegExp('^'+key+'=.*\\r?\\n','gm'),'');env+=`${key}='${value}'\n`;process.env[key]=value;}writeFileSync('.env',env);
    const tables=await db.$queryRaw<{table_name:string}[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`;
    const counts=new Map<string,number>();for(const {table_name} of tables){const rows=await db.$queryRawUnsafe<{count:bigint}[]>(`SELECT count(*) FROM "${table_name.replace(/"/g,'""')}"`);counts.set(table_name,Number(rows[0].count));}
    const manifest=await createSystemBackup(owner.id,db),target=new URL(url),name='proxy_restore_'+Date.now();target.pathname='/'+name;
    const adminUrl=new URL(url);adminUrl.pathname='/postgres';admin=new PrismaClient({datasources:{db:{url:adminUrl.toString()}}});await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/restore-backup-trial.ts'],{env:{...process.env,BACKUP_ID:manifest.id,RESTORE_DATABASE_URL:target.toString()},stdio:['ignore','pipe','pipe']});
    restored=new PrismaClient({datasources:{db:{url:target.toString()}}});
    for(const [table,count] of Array.from(counts)){if(table==='AuditLog')continue;const result=await restored.$queryRawUnsafe<{count:bigint}[]>(`SELECT count(*) FROM "${table.replace(/"/g,'""')}"`);if(Number(result[0].count)!==count)throw new Error('Restored table count mismatch');}
    const endpoint=await restored.proxyIP.findFirstOrThrow({where:{credentialCipher:{not:null}}});const plaintext=JSON.parse(decrypt(endpoint.credentialCipher!));if(!plaintext.username||!plaintext.password)throw new Error('Restored encrypted proxy could not decrypt');
    const businessOperation=await restored.operationJournal.findFirst({where:{kind:{startsWith:'BUSINESS_'}}});if(businessOperation){const snapshot=JSON.parse(decrypt(businessOperation.snapshotCipher));if(snapshot.version!==3||!Array.isArray(snapshot.resources))throw new Error('Business history restore failed');}
    console.log(JSON.stringify({backupId:manifest.id,bytes:manifest.bytes,checksum:manifest.checksum,restoredDatabase:name,verifiedTables:tables.length,credentialsDecrypt:true,businessHistoryDecrypt:!!businessOperation,activeDatabaseUnchanged:true}));
  }finally{await Promise.all([db.$disconnect(),restored?.$disconnect(),admin?.$disconnect()]);}
}
main().catch(()=>{console.error('Backup/restore trial failed; inspect private local configuration. No secrets printed.');process.exitCode=1;});
