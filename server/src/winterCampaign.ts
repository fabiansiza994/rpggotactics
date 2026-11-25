import {type GameContent,type PlayerProfile,type RunState} from '../../src/game';
import {legacyBattle,legacyDeck,legacyVerify,legacySettle,legacyCanonicalProof,legacyRunFingerprint,LEGACY_RULES} from '../../src/game/compat/pre-winter-b0e18cc8.js';
import {loadPlayer,type PlayerRecord} from './repo';
import type {D1Database} from './db';

export interface LegacyCampaignSnapshot {rules:typeof LEGACY_RULES;run:RunState;profile:PlayerProfile;deckPinned:boolean}
export function legacySnapshot(record:PlayerRecord,run:RunState):LegacyCampaignSnapshot|null {
 const cohort=record.storyCohorts?.[`${run.campaignId}:${run.heroId}`];
 if(!cohort||cohort.closed)return null;
 if(legacyRunFingerprint(JSON.parse(cohort.runJson).run)!==legacyRunFingerprint(run)||run.status!=='IN_BATTLE')throw Error('Invalid sealed Story encounter');
 if(!cohort.snapshotJson)throw Error('Missing sealed Story snapshot');
 const saved=JSON.parse(cohort.snapshotJson) as LegacyCampaignSnapshot;
 if(saved.rules!==LEGACY_RULES||legacyRunFingerprint(saved.run)!==legacyRunFingerprint(run))throw Error('Invalid sealed Story rules');
 return saved;
}
export function publicLegacyCampaigns(record:PlayerRecord|null){
 const result:Record<string,{rules:typeof LEGACY_RULES;runSeed:number;encounterId:string;profile:PlayerProfile;deckPinned:boolean}>={};
 if(record)for(const run of [...Object.values(record.runs),...Object.values(record.worldRuns).flatMap(x=>Object.values(x))]){if(!run)continue;const saved=legacySnapshot(record,run);if(saved)result[`${run.campaignId}:${run.heroId}`]={rules:saved.rules,runSeed:run.seed,encounterId:run.currentEncounterId,profile:saved.profile,deckPinned:saved.deckPinned};}
 return result;
}
export function verifyLegacyCampaign(record:PlayerRecord,run:RunState,proof:unknown){const snapshot=legacySnapshot(record,run);return snapshot?(snapshot.deckPinned?legacyVerify(snapshot.profile,snapshot.run,proof):{ok:false,error:'The admitted legacy encounter needs a legal40-card deck before retry'}):null;}
export async function storyTransitionPhase(db:D1Database):Promise<string|null>{return (await db.prepare('SELECT phase FROM tactics_winter_transition WHERE id=1').first<{phase:string}>())?.phase??null;}
/** Membership comes only from the sealed registry. Timestamps and client claims have no role. */
export async function loadWinterPlayer(db:D1Database,userId:number,content:GameContent):Promise<PlayerRecord|null>{
 const record=await loadPlayer(db,userId,content);if(!record)return null;
 const rows=await db.prepare('SELECT campaign_id,hero_id,run_json,closed,snapshot_json,proof_digest FROM tactics_story_legacy_cohort WHERE user_id=?').bind(userId).all<{campaign_id:string;hero_id:string;run_json:string;closed:number;snapshot_json:string|null;proof_digest:string|null}>();
 record.storyCohorts={};
 for(const row of rows.results){
  if(!row.closed&&row.snapshot_json===null){
   const run=JSON.parse(row.run_json).run as RunState,hero=record.profile.heroes[run.heroId],deck=hero?.decks.find(d=>d.id===hero.activeDeckId)??hero?.decks[0];
   if(!hero||!deck)throw Error('Missing authoritative legacy loadout');
   const profile:PlayerProfile={selectedChampionId:run.heroId,heroes:{[run.heroId]:{...structuredClone(hero),activeDeckId:deck.id,decks:[structuredClone(deck)]}},...(record.profile.shared?{shared:structuredClone(record.profile.shared)}:{})};
   let deckPinned=true;try{legacyDeck(profile,run);}catch{deckPinned=false;}
   // Invalid historical decks are not frozen: select a legal owned40-card deck, then retry.
   if(deckPinned){const snapshot:LegacyCampaignSnapshot={rules:LEGACY_RULES,run,profile,deckPinned};await db.prepare('UPDATE tactics_story_legacy_cohort SET snapshot_json=? WHERE user_id=? AND campaign_id=? AND hero_id=? AND closed=0 AND snapshot_json IS NULL').bind(JSON.stringify(snapshot),userId,row.campaign_id,row.hero_id).run();const fresh=await db.prepare('SELECT snapshot_json,closed FROM tactics_story_legacy_cohort WHERE user_id=? AND campaign_id=? AND hero_id=?').bind(userId,row.campaign_id,row.hero_id).first<{snapshot_json:string|null;closed:number}>();row.snapshot_json=fresh!.snapshot_json;row.closed=fresh!.closed;}
   else row.snapshot_json=JSON.stringify({rules:LEGACY_RULES,run,profile,deckPinned});
  }
  record.storyCohorts[`${row.campaign_id}:${row.hero_id}`]={runJson:row.run_json,closed:!!row.closed,snapshotJson:row.snapshot_json,proofDigest:row.proof_digest};
 }
 // Every persisted current encounter must have a matching server admission/version.
 const admissions=await db.prepare('SELECT campaign_id,hero_id,run_seed,encounter_id,engine FROM tactics_story_admissions WHERE user_id=?').bind(userId).all<{campaign_id:string;hero_id:string;run_seed:number;encounter_id:string;engine:string}>();
 for(const run of [...Object.values(record.runs),...Object.values(record.worldRuns).flatMap(x=>Object.values(x))]){if(!run||run.status!=='IN_BATTLE')continue;const a=admissions.results.find(a=>a.campaign_id===run.campaignId&&a.hero_id===run.heroId);if(!a||a.run_seed!==run.seed||a.encounter_id!==run.currentEncounterId||a.engine!==(record.storyCohorts[`${run.campaignId}:${run.heroId}`]?.closed===false?LEGACY_RULES:'winter-dominion-1'))throw Error('Missing or incompatible authoritative Story admission');}
 return record;
}
// Reference exports are intentionally campaign-only, not an alternate PvP/Ranked protocol.
export {legacyBattle,legacyDeck,legacySettle};

/** Normalize exactly the inputs the replay accepts; irrelevant fields/order cannot evade reuse detection. */
export async function legacyProofDigest(proof:unknown):Promise<string|null>{
  const canonical=legacyCanonicalProof(proof);if(canonical===null)return null;
  const data=new TextEncoder().encode(canonical);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function consumedLegacyProof(record:PlayerRecord,run:RunState,proof:unknown):Promise<boolean>{const digest=record.storyCohorts?.[`${run.campaignId}:${run.heroId}`]?.proofDigest;return !!digest&&digest===await legacyProofDigest(proof);}
