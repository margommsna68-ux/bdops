import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from 'dotenv';
import { assertTestDatabase } from '../src/server/proxy-management/test-database';

const app = existsSync('.env') ? parse(readFileSync('.env')) : {};
const test = existsSync('.env.test') ? parse(readFileSync('.env.test')) : {};
const url = process.env.DATABASE_URL_TEST || test.DATABASE_URL_TEST;
const target = assertTestDatabase(url, app.DATABASE_URL);
console.log('Test datasource:', target.host, target.port, target.database);
execFileSync(process.execPath, ['node_modules/prisma/build/index.js', ...process.argv.slice(2)], {
  stdio: 'inherit', env: {...process.env, DATABASE_URL: url},
});
