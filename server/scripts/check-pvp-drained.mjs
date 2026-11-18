/** Read-only precondition for restoring a Worker that predates beasts-release-1.
 * Requires explicit QA/prod database UUID; never guesses a default binding.
 * Supply a Cloudflare API token in the environment; it is never printed.
 */
const [account,database,worker]=process.argv.slice(2);
if(!account||!database||!worker||!process.env.CLOUDFLARE_API_TOKEN)throw Error('Usage: check-pvp-drained.mjs ACCOUNT_ID DATABASE_UUID WORKER_NAME; CLOUDFLARE_API_TOKEN required');
const settingsResponse=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${encodeURIComponent(worker)}/settings`,{headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`}});
const settings=await settingsResponse.json();
const bindings=settings.result?.bindings??[];
if(!settingsResponse.ok||!settings.success||!bindings.some(b=>b.name==='DB'&&b.type==='d1'&&b.id===database)||!bindings.some(b=>b.name==='CONTENT_RELEASE_DRAIN'&&b.text==='1')){
 console.log(JSON.stringify({rollbackAllowed:false,reason:'DRAIN_NOT_VERIFIED_OR_DATABASE_MISMATCH'}));process.exit(3);
}
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{method:'POST',headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({sql:'SELECT COUNT(*) AS active_matches FROM tactics_pvp_rooms WHERE started_at IS NOT NULL AND finished_at IS NULL'})});
const body=await response.json();if(!response.ok||!body.success)throw Error('Could not verify drainage; rollback is BLOCKED');
const count=body.result[0].results[0].active_matches;
console.log(JSON.stringify({activeMatches:count,rollbackAllowed:count===0}));
if(count!==0)process.exitCode=2;
