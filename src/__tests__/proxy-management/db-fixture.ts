import {PrismaClient} from '@prisma/client';
import {readFileSync,existsSync} from 'node:fs';
import {parse} from 'dotenv';
import {assertTestDatabase} from '@/server/proxy-management/test-database';
export function testClient(){
  const app=existsSync('.env')?parse(readFileSync('.env')).DATABASE_URL:undefined;
  assertTestDatabase(process.env.DATABASE_URL_TEST,app);
  return new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL_TEST}}});
}
