import {it,expect} from 'vitest';
import {randomUUID,createCipheriv,createHash,randomBytes} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectorCandidates} from '@/server/business-management/collector-reconciliation';
import {inspectLegacyBaseline,verifyLegacyPreserved,legacySchemaFingerprint,assertLegacySchema,assertEmptyCashTarget,decodeRecoveryArchive} from '@/server/business-management/legacy-rehearsal';
import {rehearseTeamCash} from '../../../scripts/team-cash-rehearsal';
import {pgEnvironment} from '@/server/system-backups/service';
const root='D:/CodexRuntime/bdops-proxy-trial/pgsql/bin/';
async function oldFixture(){
 const source=new URL(process.env.DATABASE_URL_TEST!),url=new URL(source);url.pathname='/proxy_cash_verify_test_'+randomUUID().replace(/-/g,'');url.search='';const adminUrl=new URL(source);adminUrl.pathname='/postgres';const admin=new PrismaClient({datasources:{db:{url:adminUrl.toString()}}});
 if(source.hostname!=='127.0.0.1'||source.port!=='55432')throw Error('Local fixture only');
 await admin.$executeRawUnsafe(`CREATE DATABASE "${url.pathname.slice(1)}"`);const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
 await assertEmptyCashTarget(db,url.toString(),[source.toString()]);
 execFileSync(root+'psql.exe',['-X','-q','-v','ON_ERROR_STOP=1'],{input:readFileSync('prisma/migrations/0_init/migration.sql'),env:{...process.env,...pgEnvironment(url.toString())},stdio:['pipe','pipe','pipe'],windowsHide:true});
 return {db,url,admin,cleanup:async()=>{await db.$disconnect();await admin.$executeRawUnsafe(`DROP DATABASE "${url.pathname.slice(1)}"`);await admin.$disconnect();}};
}
it('authenticates recovery archives before any restore',()=>{
 const key=randomBytes(32),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce),ciphertext=Buffer.concat([cipher.update(Buffer.from('PGDMP synthetic dump')),cipher.final()]),archive=Buffer.concat([Buffer.from('BDB1'),nonce,cipher.getAuthTag(),ciphertext]),sha=createHash('sha256').update(archive).digest('hex');
 expect(decodeRecoveryArchive(archive,key,sha).subarray(0,5).toString()).toBe('PGDMP');
 expect(()=>decodeRecoveryArchive(archive,randomBytes(32),sha)).toThrow();expect(()=>decodeRecoveryArchive(Buffer.from('bad'),key,sha)).toThrow();
});
it('detects missing original rows and refuses nonempty restore targets',async()=>{
 const f=await oldFixture();try{
  await f.db.$executeRawUnsafe(`INSERT INTO "Project" (id,name,code,"updatedAt") VALUES ('p','Synthetic','SYNTH',now())`);
  const before=await inspectLegacyBaseline(f.db);expect(Object.keys(before.tables)).toHaveLength(26);
  await expect(assertEmptyCashTarget(f.db,f.url.toString(),[])).rejects.toThrow();
  await f.db.$executeRawUnsafe(`DELETE FROM "Project" WHERE id='p'`);expect(()=>verifyLegacyPreserved(before,{...before,tables:{}})).toThrow();
  const after=await inspectLegacyBaseline(f.db,before.projection);expect(()=>verifyLegacyPreserved(before,after)).toThrow();
 }finally{await f.cleanup();}
});
it('migrates a matching old schema without changing original numeric values or relations',async()=>{
 const f=await oldFixture(),baseline=await oldFixture();try{
  expect(await legacySchemaFingerprint(f.db)).toBe(await legacySchemaFingerprint(baseline.db));
  await f.db.$executeRawUnsafe(`ALTER TABLE "Project" DROP COLUMN description`);await f.db.$executeRawUnsafe(`ALTER TABLE "Project" ADD COLUMN description text`);
  expect(await legacySchemaFingerprint(f.db)).toBe(await legacySchemaFingerprint(baseline.db));
  await f.db.$executeRawUnsafe(`INSERT INTO "Project" (id,name,code,"updatedAt") VALUES ('p','Synthetic','SYNTH',now())`);
  await f.db.$executeRawUnsafe(`INSERT INTO "CostRecord" (id,date,amount,total,"projectId","updatedAt") VALUES ('c',now(),0.10,2500000.10,'p',now())`);
  await f.db.$executeRawUnsafe(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('u','old@fixture.invalid',now())`);
  await f.db.$executeRawUnsafe(`INSERT INTO "CollectorExpense" (id,date,type,amount,"referenceId","collectorId","projectId","updatedAt") SELECT 'e'||s,'2026-10-15','TEAM_PAYMENT',110,'legacy','u','p',now() FROM generate_series(1,4) s`);
  const before=await inspectLegacyBaseline(f.db),env={...process.env,DATABASE_URL:f.url.toString()};
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','resolve','--applied','0_init'],{env,stdio:'pipe',windowsHide:true});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,stdio:'pipe',windowsHide:true});
  verifyLegacyPreserved(before,await inspectLegacyBaseline(f.db,before.projection));
  const sources=await collectorCandidates('p',{start:'2026-10-01',end:'2026-10-31'},f.db);expect(sources).toHaveLength(4);expect(sources.every(x=>x.amountUsdt===null&&x.needsReview)).toBe(true);
  await f.db.$executeRawUnsafe(`ALTER TABLE "Project" ADD COLUMN "wrong_fingerprint" text`);await expect(assertLegacySchema(f.db,await legacySchemaFingerprint(baseline.db))).rejects.toThrow();
 }finally{await f.cleanup();await baseline.cleanup();}
});
it('rejects remote/protected targets and missing input before creating any rehearsal database',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bdops-cash-guard-')),profile=join(dir,'target.env'),missing=join(dir,'absent.json');try{
  for(const url of ['postgresql://x:x@remote.invalid:5432/proxy_cash_verify_bad',process.env.DATABASE_URL_TEST!,'postgresql://x:x@127.0.0.1:55432/proxy_cash_verify_missing_input']){
   writeFileSync(profile,'DATABASE_URL='+url);await expect(rehearseTeamCash({targetEnvPath:profile,metadataPath:missing,legacyEnvPath:missing})).rejects.toThrow('validate-inputs');
  }
 }finally{unlinkSync(profile);rmdirSync(dir);}
});
