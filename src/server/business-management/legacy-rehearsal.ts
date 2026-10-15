import {createHash,createDecipheriv} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {assertCashRehearsalTarget} from './rehearsal-guard';
export type LegacyEvidence={projection:Record<string,{columns:{name:string;type:string}[];primaryKeys:string[];rowKeys:string[][]}>;tables:Record<string,{rows:string;primaryKeyHash:string;valueHash:string;relationHash:string}>};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ident=(value:string)=>'"'+value.replace(/"/g,'""')+'"';
export async function assertEmptyCashTarget(db:PrismaClient,target:string,protectedUrls:(string|undefined)[]){
 assertCashRehearsalTarget(target,protectedUrls);const rows=await db.$queryRaw<{n:bigint}[]>`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`;
 if(rows[0].n!==BigInt(0))throw Error('Restore destination must be empty');
}
export function decodeRecoveryArchive(archive:Buffer,key:Buffer,sha:string){
 if(key.length!==32||!archive.subarray(0,4).equals(Buffer.from('BDB1'))||archive.length<33||!/^[a-f0-9]{64}$/.test(sha)||createHash('sha256').update(archive).digest('hex')!==sha)throw Error('Invalid recovery archive');
 const decipher=createDecipheriv('aes-256-gcm',key,archive.subarray(4,16));decipher.setAuthTag(archive.subarray(16,32));
 const plain=Buffer.concat([decipher.update(archive.subarray(32)),decipher.final()]);if(plain.subarray(0,5).toString()!=='PGDMP')throw Error('Invalid dump format');return plain;
}
export async function legacySchemaFingerprint(db:PrismaClient){
 const columns=await db.$queryRaw<Record<string,unknown>[]>`SELECT table_name,column_name,udt_name,is_nullable,column_default,numeric_precision,numeric_scale,datetime_precision FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' ORDER BY table_name,column_name`;
 const constraints=await db.$queryRaw<Record<string,unknown>[]>`SELECT c.relname AS table_name,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname<>'_prisma_migrations' ORDER BY c.relname,k.conname`;
 const indexes=await db.$queryRaw<Record<string,unknown>[]>`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename,indexname`;
 const enums=await db.$queryRaw<Record<string,unknown>[]>`SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder`;
 return hash({columns,constraints,indexes,enums});
}
export async function assertLegacySchema(db:PrismaClient,expected:string){if(await legacySchemaFingerprint(db)!==expected)throw Error('Copied schema does not match the verified legacy baseline');}
export async function inspectLegacyBaseline(db:PrismaClient,projection?:LegacyEvidence['projection']):Promise<LegacyEvidence>{
 const result:LegacyEvidence={projection:{},tables:{}};
 const columns=await db.$queryRaw<{table_name:string;column_name:string;data_type:string}[]>`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`;
 const pk=await db.$queryRaw<{table_name:string;column_name:string}[]>`SELECT t.table_name,k.column_name FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k ON k.constraint_name=t.constraint_name AND k.constraint_schema=t.constraint_schema AND k.table_name=t.table_name WHERE t.table_schema='public' AND t.constraint_type='PRIMARY KEY' AND t.table_name<>'_prisma_migrations' ORDER BY t.table_name,k.ordinal_position`;
 const names=projection?Object.keys(projection).sort():Array.from(new Set(columns.map(c=>c.table_name))).sort();
 for(const table of names){
  const original=projection?.[table],cols=original?.columns??columns.filter(c=>c.table_name===table).map(c=>({name:c.column_name,type:c.data_type})),keys=original?.primaryKeys??pk.filter(k=>k.table_name===table).map(k=>k.column_name);
  if(!keys.length)throw Error('Legacy table lacks primary key');
  const select=cols.map(c=>{const q=ident(c.name);let expression=q+'::text';if(c.type==='numeric')expression=`trim_scale(${q})::text`;if(c.type.startsWith('timestamp'))expression=`to_char(${q}${c.type==='timestamp with time zone'?" AT TIME ZONE 'UTC'":''},'YYYY-MM-DD"T"HH24:MI:SS.US')`;if(['json','jsonb','ARRAY'].includes(c.type))expression=`to_jsonb(${q})::text`;return `${expression} AS ${q}`;});
  let rows=await db.$queryRawUnsafe<Record<string,string|null>[]>(`SELECT ${select.join(',')} FROM ${ident(table)} ORDER BY ${keys.map(ident).join(',')}`);
  if(original){const wanted=new Set(original.rowKeys.map(k=>JSON.stringify(k)));rows=rows.filter(r=>wanted.has(JSON.stringify(keys.map(k=>r[k]))));}
  const rowKeys=rows.map(r=>keys.map(k=>r[k]!)),values=rows.map(r=>cols.map(c=>r[c.name])),links=rows.map(r=>cols.filter(c=>c.name.endsWith('Id')).map(c=>r[c.name]));
  result.projection[table]={columns:cols,primaryKeys:keys,rowKeys};result.tables[table]={rows:String(rows.length),primaryKeyHash:hash(rowKeys),valueHash:hash(values),relationHash:hash(links)};
 }
 return result;
}
export function verifyLegacyPreserved(before:LegacyEvidence,after:LegacyEvidence){
 if(JSON.stringify(before.tables)!==JSON.stringify(after.tables))throw Error('Original legacy rows or relations changed');
}
