import {config} from 'dotenv';
import {execFileSync} from 'node:child_process';
config({quiet:true});const url=new URL(process.env.DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||url.port!=='55432'||url.pathname!=='/proxy_app_trial')throw new Error('Dedicated trial datasource required');
execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'inherit',env:process.env});
