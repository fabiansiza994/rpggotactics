import {beforeEach,describe,expect,it} from 'vitest';
import {handle} from '../server/src/index';
import {COSMETICS,DEFAULT_CONTENT} from '../src/game';
import {memoryD1,addAccount} from './support/d1';
import {LAUNCH_REWARD_ID} from '../server/src/launchReward';
let db:ReturnType<typeof memoryD1>,a:ReturnType<typeof addAccount>,ids=0;
const deps={content:DEFAULT_CONTENT,now:()=>1800000000000,seed:()=>7,store:{catalog:[],cosmetics:COSMETICS,newId:()=>`launch-test-${++ids}`}};
async function call(token:string|null,claim=false,enabled='1',body:unknown={}){
 const r=await handle(new Request('https://qa.test/api/tactics/store/launch-reward'+(claim?'/claim':''),{method:claim?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(claim?{body:JSON.stringify(body)}:{})}),{DB:db,LAUNCH_REWARD_ENABLED:enabled},deps);
 return {status:r.status,data:await r.json() as {claimed:boolean;enabled:boolean;credited:number;wallet:{balance:number};receipt:{transaction_id:string}}};
}
async function player(name:string){const p=addAccount(db,name);await handle(new Request('https://qa.test/api/tactics/profile',{method:'POST',headers:{Authorization:'Bearer '+p.token,'Content-Type':'application/json'},body:'{}'}),{DB:db},deps);return p;}
function fund(n:number){db.sql.prepare(`INSERT INTO tactics_wallet_ledger(transaction_id,user_id,currency_id,amount_delta,balance_before,balance_after,reason,reference_id,created_at) VALUES('prior',?,'arcane_crystals',?,0,?,'PURCHASE_CURRENCY','prior',0)`).run(a.id,n,n);}
const count=()=>db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_wallet_ledger WHERE reference_id=?').get(LAUNCH_REWARD_ID) as {n:number};
beforeEach(async()=>{db=memoryD1();a=await player('launchqa');});
describe('launch reward authenticated ledger',()=>{
 it('requires authentication',async()=>expect((await call(null,true)).status).toBe(401));
 it('status does not credit',async()=>{expect((await call(a.token)).data).toMatchObject({claimed:false,credited:0,wallet:{balance:0}});expect(count().n).toBe(0);});
 it('credits exactly 500 to an existing balance',async()=>{fund(255);expect((await call(a.token,true)).data).toMatchObject({claimed:true,credited:500,wallet:{balance:755}});});
 it('never accepts client amount or another user',async()=>{expect((await call(a.token,true,'1',{amount:999999,userId:999})).data.wallet.balance).toBe(500);});
 it('second claim credits zero and reuses receipt',async()=>{const first=await call(a.token,true),second=await call(a.token,true);expect(second.data.credited).toBe(0);expect(second.data.receipt).toEqual(first.data.receipt);expect(count().n).toBe(1);});
 it('refresh is read-only and persists claimed state',async()=>{await call(a.token,true);for(let i=0;i<3;i++)expect((await call(a.token)).data).toMatchObject({claimed:true,credited:0,wallet:{balance:500}});});
 it('new login/device session retains the same account receipt',async()=>{await call(a.token,true);db.sql.prepare("INSERT INTO sessions VALUES('new-session','launchqa',0,4000000000000)").run();expect((await call('new-session',true)).data).toMatchObject({credited:0,wallet:{balance:500}});});
 it('concurrent claims credit only once',async()=>{const replies=await Promise.all(Array.from({length:12},()=>call(a.token,true)));expect(replies.every(x=>x.status===200)).toBe(true);expect(replies.reduce((n,x)=>n+x.data.credited,0)).toBe(500);expect(count().n).toBe(1);});
 it('lost response / same operation retry stays idempotent',async()=>{await call(a.token,true);expect((await call(a.token,true,'1',{operation:'same'})).data.credited).toBe(0);});
 it('two independent accounts receive 500 each',async()=>{const b=await player('launchqb');expect((await call(a.token,true)).data.wallet.balance).toBe(500);expect((await call(b.token,true)).data.wallet.balance).toBe(500);expect(count().n).toBe(2);});
 it('does not touch purchases, free-pack counters, collection or decks',async()=>{const tables=['tactics_store_purchases','tactics_player_cards','tactics_decks'];const snapshot=()=>tables.map(t=>db.sql.prepare(`SELECT * FROM ${t}`).all());const before=snapshot();await call(a.token,true);expect(snapshot()).toEqual(before);});
 it('can disable new claims without deleting prior receipt',async()=>{expect((await call(a.token,true,'0')).status).toBe(410);expect(count().n).toBe(0);await call(a.token,true);expect((await call(a.token,true,'0')).data).toMatchObject({claimed:true,credited:0,wallet:{balance:500}});});
 it('a prior spend stays intact and later ledger purchases still work',async()=>{fund(255);db.sql.prepare(`INSERT INTO tactics_wallet_ledger(transaction_id,user_id,currency_id,amount_delta,balance_before,balance_after,reason,reference_id,created_at) VALUES('spent',?,'arcane_crystals',-200,255,55,'STORE_PURCHASE','old',1)`).run(a.id);await call(a.token,true);db.sql.prepare(`INSERT INTO tactics_wallet_ledger(transaction_id,user_id,currency_id,amount_delta,balance_before,balance_after,reason,reference_id,created_at) VALUES('next',?,'arcane_crystals',-200,555,355,'STORE_PURCHASE','next',2)`).run(a.id);expect((await call(a.token,true)).data.wallet.balance).toBe(355);});
 it('failure without a receipt is retryable and never reports success',async()=>{db.sql.exec("CREATE TRIGGER reject_launch BEFORE INSERT ON tactics_wallet_ledger WHEN NEW.reference_id='launch_reward_2026_expansions_500' BEGIN SELECT RAISE(ABORT,'test failure'); END");expect((await call(a.token,true)).status).toBe(503);expect(count().n).toBe(0);db.sql.exec('DROP TRIGGER reject_launch');expect((await call(a.token,true)).data.wallet.balance).toBe(500);});
});
