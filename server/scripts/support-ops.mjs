/** Administrative CLI: existing Cloudflare D1 permissions. No HTTP endpoint, automatic replies or stored credentials. */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSupportSql, showSupportSql, noteSupportSql, resolveSupportSql } from './support-ops-sql.mjs';
const [command,...args]=process.argv.slice(2);
const opt=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
if(!['list','show','note','record-reply','resolve'].includes(command))throw Error('Use list/show/note/record-reply/resolve. Read SUPPORT-EMAIL-SETUP.md.');
if(command==='show'&&!args.includes('--confirm-private-output'))throw Error('Detail contains personal data. Use an authorized private terminal and --confirm-private-output.');
if(command==='record-reply'&&!args.includes('--confirmed-sent'))throw Error('This only records a reply already sent externally; requires --confirmed-sent.');
const sql=command==='list'?listSupportSql():command==='show'?showSupportSql(opt('ticket')):command==='resolve'?resolveSupportSql(opt('ticket')):noteSupportSql({reportId:opt('ticket'),actor:opt('actor'),text:readFileSync(opt('text-file'),'utf8'),now:Date.now(),noteId:'note_'+randomUUID(),confirmedSent:command==='record-reply'});
if(!args.includes('--apply')){console.log('Prepared '+command+'. No SQL, content or personal data printed. Add --apply with explicit target to execute.');process.exit(0);}
if(args.includes('--local')===args.includes('--remote'))throw Error('Choose exactly one of --local / --remote; never guess a database.');
const database=opt('database');
if(!database || !/^[A-Za-z0-9_-]+$/.test(database))throw Error('Specify --database explicitly; no production fallback.');
const dir=mkdtempSync(join(tmpdir(),'tactics-support-'));
try{
 const file=join(dir,'operation.sql');writeFileSync(file,sql,{mode:0o600});
 execFileSync('npx',['wrangler','d1','execute',database,args.includes('--remote')?'--remote':'--local','--file',file,...(opt('persist-to')?['--persist-to',opt('persist-to')]:[]),...(opt('env')?['--env',opt('env')]:[]),...(opt('config')?['--config',opt('config')]:[])],{cwd:fileURLToPath(new URL('..',import.meta.url)),stdio:'inherit'});
}finally{rmSync(dir,{recursive:true,force:true});}
