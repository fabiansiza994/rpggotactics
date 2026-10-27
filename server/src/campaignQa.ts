import { ASCENT_CAMPAIGN, createRun, DECK_RULES, encounterOrder, validateDeck, type DeckEntry, type GameContent } from '../../src/game';
import type { Env } from './db';

/** Exact account identity from the authenticated session; never from request data. */
export function summonerQaAllowed(env: Env, username: string): boolean {
  return env.SUMMONER_CAMPAIGN_QA === '1' && ['tactics_qa_a', 'tactics_qa_b'].includes(username);
}
export const QA_ENCOUNTERS = ['ascent_05_alpha', 'ascent_07_chasm', 'ascent_09_elder', 'ascent_10_colossus'];
const entries = (cards: Record<string, number>): DeckEntry[] => Object.entries(cards).map(([cardId, count]) => ({cardId,count}));
export function qaCampaignSetup(content: GameContent, encounterId: unknown, tier: unknown, seed: unknown) {
  if (typeof encounterId !== 'string' || !QA_ENCOUNTERS.includes(encounterId) || !['STARTER','MID','VETERAN'].includes(String(tier)) || !Number.isInteger(seed) || Number(seed)<1 || Number(seed)>0xffffffff) return null;
  const cards = tier === 'STARTER' ? content.heroes.summoner!.deck.map(e=>({...e})) : tier === 'MID'
    // 30-card presets (exactly, DECK_RULES): the former 20-card MID/VETERAN lists + 10 Summoner commons/support.
    ? entries({summon_chicken:3,nurture:3,summoner_ward:3,summoner_push:3,summoner_step:3,summon_fox:3,summon_turtle:2,summon_raven:2,entangle:2,summoner_dispel:3,summoner_blink:2,familiar_aegis:1})
    : entries({summon_fox:3,summon_chicken:3,summon_wolf:1,summon_turtle:2,summon_raven:2,nurture:3,summoner_ward:3,familiar_aegis:2,recall_familiar:2,summoner_push:3,summoner_step:3,entangle:2,pack_hymn:1});
  if (validateDeck(cards,'summoner',id=>cards.find(e=>e.cardId===id)?.count??0,content,DECK_RULES).length) throw new Error('Illegal QA preset');
  const order=encounterOrder(ASCENT_CAMPAIGN).map(e=>e.id);
  const run={...createRun(ASCENT_CAMPAIGN,content,Number(seed),'summoner'), currentEncounterId:encounterId,completedEncounterIds:order.slice(0,order.indexOf(encounterId))};
  return {run,cards};
}
