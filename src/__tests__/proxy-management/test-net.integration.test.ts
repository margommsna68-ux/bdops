import {afterAll,describe,expect,it,vi} from 'vitest';
import {freeTestNet,testClient} from './db-fixture';
const db=testClient();afterAll(()=>db.$disconnect());
// 22/10/2026: vm-table failed now and then because its random /24 landed on proxies an interrupted earlier run left in the test database.
describe('freeTestNet',()=>{
  it('never returns a /24 that already has a proxy identity, even when the random start lands on it',async()=>{
    const taken='198.19.77.',identity=await db.proxyIdentity.create({data:{ip:taken+'1',owner:'SELF'}});
    const spy=vi.spyOn(Math,'random').mockReturnValue(76.5/250);
    try{const net=await freeTestNet(db,'198.19.');expect(net).not.toBe(taken);expect(await db.proxyIdentity.count({where:{ip:{startsWith:net}}})).toBe(0);}
    finally{spy.mockRestore();await db.proxyIdentity.delete({where:{id:identity.id}});}
  });
});
