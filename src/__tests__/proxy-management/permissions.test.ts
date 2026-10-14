import {expect,it} from 'vitest';
import {assertInfrastructureAction} from '@/server/permissions/infrastructure';
import type {ActorScope} from '@/server/proxy-management/types';
const user:ActorScope={userId:'u',projectId:'p',role:'USER',capabilities:[],allowedModules:['INFRASTRUCTURE']};
it('lets an operator act on the entire granted project, but needs import/copy capabilities',()=>{
  expect(()=>assertInfrastructureAction(user,'BLOCK')).not.toThrow();expect(()=>assertInfrastructureAction(user,'ASSIGN')).not.toThrow();
  expect(()=>assertInfrastructureAction(user,'IMPORT')).toThrow('FORBIDDEN');expect(()=>assertInfrastructureAction(user,'COPY_CREDENTIALS')).toThrow('FORBIDDEN');
  expect(()=>assertInfrastructureAction({...user,capabilities:['PROXY_IMPORT','COPY_CREDENTIALS']},'IMPORT')).not.toThrow();
});
it('VIEWER cannot mutate and MODERATOR requires module access',()=>{
  for(const action of ['BLOCK','IMPORT','REPLACE','ASSIGN','CONFIRM','COPY_CREDENTIALS','MANAGE'] as const) expect(()=>assertInfrastructureAction({...user,role:'VIEWER'},action)).toThrow('FORBIDDEN');
  expect(()=>assertInfrastructureAction({...user,role:'MODERATOR',allowedModules:[]},'BLOCK')).toThrow('FORBIDDEN');
  expect(()=>assertInfrastructureAction({...user,userId:''},'READ')).toThrow('FORBIDDEN');
});
