import {PrismaClient} from '@prisma/client';
import {readFileSync,existsSync} from 'node:fs';
import {parse} from 'dotenv';
import {assertTestDatabase} from '@/server/proxy-management/test-database';
export function testClient(){
  const app=existsSync('.env')?parse(readFileSync('.env')).DATABASE_URL:undefined;
  assertTestDatabase(process.env.DATABASE_URL_TEST,app);
  return new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL_TEST}}});
}
/**
 * A free synthetic /24 under `prefix` (e.g. '203.4.') for one fixture: the test database keeps rows of earlier runs that stopped before
 * their cleanup, and ProxyIdentity.ip is unique across projects, so a random pick alone could land on them (vm-table, 22/10/2026).
 * Starts at a random third octet and takes the first one with no identity; files run one after another (fileParallelism: false).
 */
export async function freeTestNet(db:PrismaClient,prefix:string){
  const start=Math.floor(Math.random()*250);
  for(let i=0;i<250;i++){const net=prefix+(1+(start+i)%250)+'.';if(!await db.proxyIdentity.count({where:{ip:{startsWith:net}}}))return net;}
  throw new Error('Không còn dải IP thử trống dưới '+prefix+' trong DB test');
}
