import type {PrismaClient} from '@prisma/client';
// Fixed-window counters in PostgreSQL (OpsRateBucket), so every instance and every restart sees the same count. One atomic upsert per
// hit: a new window starts the count again at 1. Times are written as UTC explicitly (the column has no time zone).
export const LIMITS={read:{max:120,windowSec:60},write:{max:30,windowSec:60},batch:{max:10,windowSec:60},authFail:{max:30,windowSec:60},pinFail:{max:5,windowSec:1800}} as const;
export type LimitName=keyof typeof LIMITS;
const windowOf=(name:LimitName,now=Date.now())=>{const w=LIMITS[name].windowSec*1000;return {start:new Date(Math.floor(now/w)*w),end:Math.floor(now/w)*w+w};};
/** Count one hit; over the limit → retryAfter (seconds). */
export async function hit(db:PrismaClient,name:LimitName,subject:string){
  const {start,end}=windowOf(name),key=name+':'+subject;
  const rows=await db.$queryRaw<{count:number}[]>`INSERT INTO "OpsRateBucket" ("key","windowStart","count") VALUES (${key},(${start.toISOString()}::timestamptz AT TIME ZONE 'UTC'),1)
    ON CONFLICT ("key") DO UPDATE SET "count"=CASE WHEN "OpsRateBucket"."windowStart"=EXCLUDED."windowStart" THEN "OpsRateBucket"."count"+1 ELSE 1 END,"windowStart"=EXCLUDED."windowStart"
    RETURNING "count"`;
  if(Math.random()<0.01)await db.opsRateBucket.deleteMany({where:{windowStart:{lt:new Date(Date.now()-86400000)}}});
  const count=Number(rows[0]?.count??1);return {count,over:count>LIMITS[name].max,retryAfter:Math.max(1,Math.ceil((end-Date.now())/1000))};
}
/** Current count without adding a hit (failed authentications / PINs are counted only when they happen). */
export async function peek(db:PrismaClient,name:LimitName,subject:string){
  const {start,end}=windowOf(name),row=await db.opsRateBucket.findUnique({where:{key:name+':'+subject}});
  const count=row&&row.windowStart.getTime()===start.getTime()?row.count:0;return {count,over:count>=LIMITS[name].max,retryAfter:Math.max(1,Math.ceil((end-Date.now())/1000))};
}
