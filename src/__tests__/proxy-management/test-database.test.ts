import { describe, expect, it } from 'vitest';
import { assertTestDatabase } from '@/server/proxy-management/test-database';

describe('dedicated database guard', () => {
  it('requires an explicit test datasource', () => {
    expect(() => assertTestDatabase(undefined, 'postgresql://u:p@localhost:5432/app')).toThrow('DATABASE_URL_TEST');
  });
  it('rejects the same physical database with changed credentials or query parameters', () => {
    expect(() => assertTestDatabase('postgresql://test:other@LOCALHOST:5432/app?schema=test', 'postgresql://u:p@localhost/app')).toThrow('SAME_DATABASE');
  });
  it('returns only a redacted target description for a separate database', () => {
    expect(assertTestDatabase('postgresql://test:secret@localhost:55432/proxy_trial', 'postgresql://u:p@localhost/app')).toEqual({host: 'localhost', port: '55432', database: 'proxy_trial'});
  });
  it('rejects an invalid database URL without leaking its contents', () => {
    expect(() => assertTestDatabase('secret', undefined)).toThrow('INVALID_DATABASE_URL');
  });
});
