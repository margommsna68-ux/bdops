import {parse} from 'dotenv';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {assertCashRehearsalTarget} from '../src/server/business-management/rehearsal-guard';
import {assertEmptyCashTarget,decodeRecoveryArchive,inspectLegacyBaseline,verifyLegacyPreserved,legacySchemaFingerprint,assertLegacySchema} from '../src/server/business-management/legacy-rehearsal';
import {pgEnvironment} from '../src/server/system-backups/service';

export async function rehearseTeamCash(options:{metadataPath:string;legacyEnvPath:string;targetEnvPath:string}){
 let stage='validate-inputs';
 try{
 const app=parse(readFileSync('.env')),test=parse(readFileSync('.env.test')),profile=parse(readFileSync(options.targetEnvPath)),target=profile.DATABASE_URL||'',safe=assertCashRehearsalTarget(target,[app.DATABASE_URL,test.DATABASE_URL_TEST]);
 const metadata=JSON.parse(readFileSync(options.metadataPath,'utf8')) as {backupPath:string;keyPath:string;sha256:string;bytes:number},archive=readFileSync(metadata.backupPath);
 if(archive.length!==metadata.bytes)throw Error('Recovery archive size mismatch');
 const plain=decodeRecoveryArchive(archive,readFileSync(metadata.keyPath),metadata.sha256);
 stage='legacy-key';
 const legacy=parse(readFileSync(options.legacyEnvPath));if(!/^[a-fA-F0-9]{64}$/.test(legacy.ENCRYPTION_KEY||''))throw Error('Legacy credential key missing');
 // This script is an isolated child: only the old encryption key is adopted, never its datasource.
 process.env.ENCRYPTION_KEY=legacy.ENCRYPTION_KEY;process.env.DATABASE_URL=target;
 const adminUrl=new URL(target);adminUrl.pathname='/postgres';const admin=new PrismaClient({datasources:{db:{url:adminUrl.toString()}}}),db=new PrismaClient({datasources:{db:{url:target}}});let baseline:PrismaClient|undefined;
 const bin=profile.PG_BIN_DIRECTORY||'D:/CodexRuntime/bdops-proxy-trial/pgsql/bin',baselineUrl=new URL(target);baselineUrl.pathname='/proxy_cash_verify_baseline_'+randomUUID().replace(/-/g,'');
 assertCashRehearsalTarget(baselineUrl.toString(),[target,app.DATABASE_URL,test.DATABASE_URL_TEST]);
 const sql=(url:string,input:Buffer)=>execFileSync(join(bin,'psql.exe'),['-X','-q','-v','ON_ERROR_STOP=1'],{input,env:{...process.env,...pgEnvironment(url)},stdio:['pipe','pipe','pipe'],windowsHide:true});
 try{
  stage='create-copy-database';
  const exists=await admin.$queryRaw<{n:bigint}[]>`SELECT count(*) AS n FROM pg_database WHERE datname=${safe.database}`;
  if(!exists[0].n)await admin.$executeRawUnsafe(`CREATE DATABASE "${safe.database}"`);
  stage='require-empty-copy';await assertEmptyCashTarget(db,target,[app.DATABASE_URL,test.DATABASE_URL_TEST]);
  stage='restore-archive';try{execFileSync(join(bin,'pg_restore.exe'),['--dbname='+safe.database,'--single-transaction','--exit-on-error','--no-owner','--no-acl','--no-password'],{input:plain,env:{...process.env,...pgEnvironment(target)},stdio:['pipe','ignore','pipe'],windowsHide:true});}finally{plain.fill(0);}
  stage='baseline-schema';await admin.$executeRawUnsafe(`CREATE DATABASE "${baselineUrl.pathname.slice(1)}"`);baseline=new PrismaClient({datasources:{db:{url:baselineUrl.toString()}}});await assertEmptyCashTarget(baseline,baselineUrl.toString(),[target,app.DATABASE_URL,test.DATABASE_URL_TEST]);
  sql(baselineUrl.toString(),readFileSync('prisma/migrations/0_init/migration.sql'));
  const expectedSchema=await legacySchemaFingerprint(baseline),actualSchema=await legacySchemaFingerprint(db);await assertLegacySchema(db,expectedSchema);
  stage='inspect-original';const before=await inspectLegacyBaseline(db),tables=Object.keys(before.tables).length,rows=Object.values(before.tables).reduce((sum,t)=>sum+BigInt(t.rows),BigInt(0)).toString();
  if(tables!==26||rows!=='1120')throw Error('Recovery archive differs from the approved historical dataset');
  const migrate=(args:string[])=>execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate',...args],{env:{...process.env,DATABASE_URL:target},stdio:'pipe',windowsHide:true});
  stage='migrate-copy';migrate(['resolve','--applied','0_init']);migrate(['deploy']);
  const fullAfter=await inspectLegacyBaseline(db);for(const [name,facts] of Object.entries(before.tables))if(fullAfter.tables[name]?.rows!==facts.rows)throw Error('Migration changed an original table count');
  verifyLegacyPreserved(before,await inspectLegacyBaseline(db,before.projection));
  const sources=await db.collectorExpense.findMany({select:{id:true,type:true}}),review={teamPaymentCandidates:sources.filter(s=>s.type==='TEAM_PAYMENT').length,billOtherCandidates:sources.filter(s=>['BILL','OTHER'].includes(s.type)).length,commissionKeptSeparate:sources.filter(s=>s.type==='COMMISSION_WITHDRAW').length,confirmedReceipts:await db.teamReceipt.count(),actualUsdtUnknown:true};
  stage='credential-verification';const {decrypt}=await import('../src/lib/encryption');let legacyCredentialDecrypt=false;
  const credential=await db.payPalEmail.findFirst({where:{password:{not:null}},select:{password:true}});if(credential?.password){legacyCredentialDecrypt=!!decrypt(credential.password);if(!legacyCredentialDecrypt)throw Error('Copied credential failed verification');}
  stage='synthetic-qa';const user=await db.user.create({data:{email:randomUUID()+'@cash-rehearsal.invalid'}}),project=await db.project.create({data:{code:'QA_'+randomUUID().slice(0,8),name:'Synthetic USDT rehearsal only',type:'PAYPAL_ONLY',settings:{teamCashEnabled:true},members:{create:{userId:user.id,role:'ADMIN'}}}}),scope={projectId:project.id,userId:user.id,role:'ADMIN' as const,capabilities:[]};
  const {saveTeamReceipt}=await import('../src/server/business-management/team-receipts'),{saveUsdtCost}=await import('../src/server/business-management/usdt-costs'),{teamCashSources}=await import('../src/server/business-management/team-cash-report');
  await saveTeamReceipt(scope,{key:randomUUID(),receivedDate:'2026-10-15',status:'CONFIRMED',amountUsdt:'100',referenceId:'QA-'+randomUUID()},db);
  for(const c of [{amount:'2500000',currency:'VND',rate:'25000'},{amount:'5',currency:'USDT'}])await saveUsdtCost(scope,{...c,key:randomUUID(),date:'2026-10-15',category:'OTHER',treatment:'CASH_COST'},db);
  const report=(await teamCashSources(scope,{start:'2026-10-01',end:'2026-10-31'},db)).report;if(report.net!=='-5.000000')throw Error('Cash QA example failed');
  verifyLegacyPreserved(before,await inspectLegacyBaseline(db,before.projection));
  const evidence={verifiedAt:new Date().toISOString(),archiveSha256:metadata.sha256,legacySchemaFingerprint:actualSchema,originalTables:tables,originalRows:rows,originalValuesPreserved:true,originalRelationsPreserved:true,afterSyntheticQAPreserved:true,legacyCredentialDecrypt,review,syntheticQA:{received:report.teamReceived,cost:report.cost,net:report.net},targetDatabase:safe.database,railwayUntouched:true};
  writeFileSync(resolve(dirname(options.targetEnvPath),'team-cash-rehearsal-evidence.json'),JSON.stringify(evidence,null,2));return evidence;
 }finally{plain.fill(0);await db.$disconnect();await baseline?.$disconnect();await admin.$disconnect();}
 }catch{throw Error('Rehearsal failed at '+stage);}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve('scripts/team-cash-rehearsal.ts')){
 const [metadataPath,legacyEnvPath,targetEnvPath]=process.argv.slice(2);if(!metadataPath||!legacyEnvPath||!targetEnvPath)throw Error('Three private input paths required');
 rehearseTeamCash({metadataPath,legacyEnvPath,targetEnvPath}).then(e=>console.log(JSON.stringify(e))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
