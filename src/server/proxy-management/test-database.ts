export function assertTestDatabase(testUrl?: string, appUrl?: string) {
  if (!testUrl) throw new Error('DATABASE_URL_TEST is required');
  const target = (value: string) => {
    try {
      const url = new URL(value);
      if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname || url.pathname === '/') throw new Error();
      return {host: url.hostname.toLowerCase(), port: url.port || '5432', database: decodeURIComponent(url.pathname.slice(1))};
    } catch { throw new Error('INVALID_DATABASE_URL'); }
  };
  const test = target(testUrl);
  if (appUrl && JSON.stringify(test) === JSON.stringify(target(appUrl))) throw new Error('SAME_DATABASE: tests require a dedicated database');
  return test;
}
