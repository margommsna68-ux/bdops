import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
it('enforces physical IP uniqueness and permanent Genjy at the database boundary',async()=>{
  const id=randomUUID();
  try{
    await db.proxyIdentity.create({data:{id,ip:'192.0.2.42',owner:'GENJY',subgroup:'PC_CHUNG'}});
    await expect(db.proxyIdentity.create({data:{id:randomUUID(),ip:'192.0.2.42',owner:'SELF'}})).rejects.toMatchObject({code:'P2002'});
    await expect(db.proxyIdentity.update({where:{id},data:{owner:'SELF'}})).rejects.toThrow();
    await expect(db.proxyIdentity.update({where:{id},data:{subgroup:null}})).rejects.toThrow();
    expect(await db.proxyIdentity.findUnique({where:{id}})).toMatchObject({owner:'GENJY',subgroup:'PC_CHUNG'});
  }finally{await db.proxyIdentity.deleteMany({where:{id}});}
});
it('rejects PC_CHUNG outside Genjy and keeps unknown dates null',async()=>{
  const id=randomUUID();
  try{await expect(db.proxyIdentity.create({data:{id,ip:'192.0.2.43',owner:'SELF',subgroup:'PC_CHUNG'}})).rejects.toThrow();}
  finally{await db.proxyIdentity.deleteMany({where:{id}});}
});
