import fs from 'node:fs';
const root=new URL('../',import.meta.url);
fs.mkdirSync(new URL('.work/engine/',root),{recursive:true});
fs.cpSync(new URL('base/engine/',root),new URL('.work/engine/',root),{recursive:true});
fs.cpSync(new URL('engine/',root),new URL('.work/engine/',root),{recursive:true});
