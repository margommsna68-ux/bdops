import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import type {ActorScope} from '@/server/proxy-management/types';
import {listProxyMembers,listServerAccessChoices,setProxyCapabilities} from '@/server/proxy-management/capabilities';
import {assertImagesUnchanged,captureMember,type OperationSnapshot} from '@/server/operation-history/snapshot';

const mocks=vi.hoisted(()=>({load:vi.fn(),journal:vi.fn()}));
vi.mock('@/server/permissions/infrastructure',()=>({loadInfrastructureScope:mocks.load}));
vi.mock('@/server/operation-history/journal',()=>({recordOperation:mocks.journal}));
const scope:ActorScope={userId:'admin',projectId:'project',role:'ADMIN',capabilities:[],businessMode:'PROXY_VM'};
function fixture(overrides:Record<string,unknown>={}){
  let member={id:'member',projectId:'project',role:'USER',capabilities:['OTHER'],allowedModules:['INFRASTRUCTURE'],accessRevision:3,serverScope:'ALL',allowedServerIds:[],...overrides};
  const audits:unknown[]=[];
  const tx={$queryRaw:vi.fn(async()=>[]),projectMember:{findFirst:vi.fn(async({where})=>where.id===member.id&&where.projectId===member.projectId?member:null),findMany:vi.fn(async(_input:{select:Record<string,unknown>})=>[member]),update:vi.fn(async({data})=>{member={...member,...data,accessRevision:data.accessRevision?.increment?member.accessRevision+data.accessRevision.increment:member.accessRevision};return member;})},server:{findMany:vi.fn(async({where})=>[{id:'a',code:'A'},{id:'b',code:'B'}].filter(s=>where.projectId==='project'&&(!where.id||where.id.in.includes(s.id))))},auditLog:{create:vi.fn(async input=>{audits.push(input);})}};
  const db={...tx,$transaction:vi.fn(async fn=>fn(tx))} as unknown as PrismaClient;
  return {db,tx,audits,member:()=>member};
}
beforeEach(()=>{vi.clearAllMocks();mocks.load.mockResolvedValue(scope);});
describe('member server access configuration',()=>{
  it('stores multiple selected servers and invalidates old member images with a nonreversible access journal',async()=>{
    const f=fixture();await setProxyCapabilities(scope,'member',['EARN_BALANCE'],f.db,true,{mode:'SELECTED',serverIds:['b','a'],expectedAccessRevision:3});
    expect(f.member()).toMatchObject({serverScope:'SELECTED',allowedServerIds:['a','b'],accessRevision:4,capabilities:['OTHER','EARN_BALANCE']});
    expect(mocks.journal.mock.calls[0][1]).toMatchObject({kind:'ACCESS',reversible:false});
    expect(f.audits[0]).toMatchObject({data:{changes:{serverScope:'SELECTED',allowedServerIds:['a','b'],accessRevision:4}}});
    expect(mocks.load).toHaveBeenCalledWith(f.tx,'admin','project');
    expect(f.tx.$queryRaw).toHaveBeenCalled();
    expect(f.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(f.tx.projectMember.findFirst.mock.invocationCallOrder[0]);
  });
  it('keeps SELECTED empty as no servers, including when infrastructure is enabled',async()=>{
    const f=fixture();await setProxyCapabilities(scope,'member',[],f.db,true,{mode:'SELECTED',serverIds:[],expectedAccessRevision:3});
    expect(f.member()).toMatchObject({serverScope:'SELECTED',allowedServerIds:[],accessRevision:4});
  });
  it('preserves defaults and existing selected access when the optional argument is omitted',async()=>{
    for(const values of [{serverScope:'ALL',allowedServerIds:[]},{serverScope:'SELECTED',allowedServerIds:['a']}]){
      const f=fixture(values);await setProxyCapabilities(scope,'member',[],f.db,true);
      expect(f.member()).toMatchObject({...values,accessRevision:3});
    }
  });
  it('returns member scopes and project server choices only after reloading administrator rights',async()=>{
    const f=fixture();expect(await listProxyMembers(scope,f.db)).toEqual([f.member()]);
    expect(f.tx.projectMember.findMany.mock.calls[0][0].select).toMatchObject({serverScope:true,allowedServerIds:true,accessRevision:true});
    expect(await listServerAccessChoices(scope,f.db)).toEqual([{id:'a',code:'A'},{id:'b',code:'B'}]);
    expect(f.tx.server.findMany.mock.calls[0][0].where).toMatchObject({projectId:'project'});
    mocks.load.mockResolvedValue({...scope,role:'USER'});
    await expect(listProxyMembers(scope,f.db)).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(listServerAccessChoices(scope,f.db)).rejects.toMatchObject({code:'FORBIDDEN'});
  });
  it.each(['USER','MODERATOR','VIEWER'])('rejects a stale ADMIN actor whose current role is %s',async role=>{
    const f=fixture();mocks.load.mockResolvedValue({...scope,role});
    await expect(setProxyCapabilities(scope,'member',[],f.db,true,{mode:'SELECTED',serverIds:[],expectedAccessRevision:3})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(f.tx.projectMember.update).not.toHaveBeenCalled();
  });
  it('rejects members from another project',async()=>{
    const f=fixture({projectId:'elsewhere'});
    await expect(setProxyCapabilities(scope,'member',[],f.db,true,{mode:'SELECTED',serverIds:[],expectedAccessRevision:3})).rejects.toMatchObject({code:'FORBIDDEN'});
  });
  it.each([{serverIds:['foreign']},{serverIds:['a','a']}])('rejects foreign or duplicate server IDs $serverIds',async({serverIds})=>{
    const f=fixture();await expect(setProxyCapabilities(scope,'member',[],f.db,true,{mode:'SELECTED',serverIds,expectedAccessRevision:3})).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(f.tx.projectMember.update).not.toHaveBeenCalled();
  });
  it('rejects stale access revisions even when submitted scope is unchanged',async()=>{
    const f=fixture();await expect(setProxyCapabilities(scope,'member',[],f.db,true,{mode:'ALL',serverIds:[],expectedAccessRevision:2})).rejects.toMatchObject({code:'STALE_PREVIEW'});
    expect(f.tx.projectMember.update).not.toHaveBeenCalled();
  });
  it('never restricts an ADMIN member',async()=>{
    const f=fixture({role:'ADMIN'});await expect(setProxyCapabilities(scope,'member',[],f.db,true,{mode:'SELECTED',serverIds:[],expectedAccessRevision:3})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(f.member()).toMatchObject({serverScope:'ALL',allowedServerIds:[]});
  });
  it('restores unrestricted ADMIN access when a previously selected member has been promoted',async()=>{
    const f=fixture({role:'ADMIN',serverScope:'SELECTED',allowedServerIds:['a']});
    await setProxyCapabilities(scope,'member',[],f.db,true);
    expect(f.member()).toMatchObject({serverScope:'ALL',allowedServerIds:[],accessRevision:4});
    expect(mocks.journal.mock.calls[0][1]).toMatchObject({reversible:false});
  });
  it('refuses an old MEMBER snapshot after a server grant changes',async()=>{
    const f=fixture();
    const image=captureMember(f.member() as unknown as Parameters<typeof captureMember>[0]);
    const snapshot:OperationSnapshot={version:1,resources:[{resource:'MEMBER',id:'member',before:image,after:image}],eventIds:[],replacementIds:[]};
    await expect(assertImagesUnchanged(f.db,'project',snapshot)).resolves.toBeUndefined();
    await setProxyCapabilities(scope,'member',[],f.db,true,{mode:'SELECTED',serverIds:['a'],expectedAccessRevision:3});
    await expect(assertImagesUnchanged(f.db,'project',snapshot)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  });
  it('normalizes ALL to no allowlist and does not bump revision for reordered unchanged selections',async()=>{
    const f=fixture({serverScope:'SELECTED',allowedServerIds:['a','b']});
    await setProxyCapabilities(scope,'member',[],f.db,true,{mode:'SELECTED',serverIds:['b','a'],expectedAccessRevision:3});
    expect(f.member().accessRevision).toBe(3);
    await setProxyCapabilities(scope,'member',[],f.db,true,{mode:'ALL',serverIds:['a'],expectedAccessRevision:3});
    expect(f.member()).toMatchObject({serverScope:'ALL',allowedServerIds:[],accessRevision:4});
  });
});
