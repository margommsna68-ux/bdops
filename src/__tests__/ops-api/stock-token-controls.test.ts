import {describe,it,expect} from 'vitest';
import {TOKEN_SCOPES} from '@/components/settings/OpsTokensPanel';
import {OPS_SCOPES} from '@/server/ops-api/tokens';
describe('the user token form exposes the API stock scope',()=>{
 it('offers every implemented scope, including ACCOUNT_OPS',()=>{
  expect(TOKEN_SCOPES.map(x=>x.value).sort()).toEqual([...OPS_SCOPES].sort());
  expect(TOKEN_SCOPES.find(x=>x.value==='ACCOUNT_OPS')?.label).toMatch(/tài khoản/i);
 });
});
