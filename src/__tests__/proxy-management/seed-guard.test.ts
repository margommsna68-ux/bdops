import {expect,it} from 'vitest';
import {allowLegacySeed} from '@/server/permissions/seed';
it('legacy seed is closed by default and always closed in production',()=>{
  expect(allowLegacySeed('development',undefined)).toBe(false);expect(allowLegacySeed('production','true')).toBe(false);expect(allowLegacySeed('development','true')).toBe(true);
});
