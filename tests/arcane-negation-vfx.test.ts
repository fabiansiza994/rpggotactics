import {afterEach, describe, expect, it, vi} from 'vitest';
import type {GameEvent} from '../src/game';
import {duelView, applyDuel} from '../src/game/pvp/duel';
import {NegationLedger, NegationLane, readNegationFrame, subscribeNegation, NEGATION_DURATION_MS} from '../src/presentation/cards/negationResolution';
import {VfxDirector, type DirectorHost} from '../src/presentation/vfx/VfxDirector';
import type {ElementEffects} from '../src/presentation/vfx/ElementEffects';
import {compileTimeline} from '../src/presentation/vfx/spellTimeline';
import {negationFixture, negationContent} from './arcane-negation.fixtures';
const lookup = (id: string) => negationContent.cards[id];
const key = (id: string) => lookup(id)?.presentation.visualKey ?? id;
const lanes: NegationLane[] = [];
afterEach(() => {for (const lane of lanes) lane.clear(); lanes.length = 0;});
function plan() {const f = negationFixture(), result = f.resolve();return [...new NegationLedger().claim(result.events,{key:'test:lane:1',live:true,before:f.before},lookup).values()][0]!;}

describe('authoritative public negation contract', () => {
  it.each(['magic_missile','fireball','summon_chicken','dark_scorpion_king'])('shows the actual source and target for %s without changing the result', cardId => {
    const f = negationFixture(cardId), before = JSON.stringify(f.before), result = f.resolve(), after = JSON.stringify(result);
    const ledger = new NegationLedger(), plans = ledger.claim(result.events,{key:'pvp:room:'+cardId,live:true,before:f.before},lookup);
    expect(plans.size).toBe(1);
    expect([...plans.values()][0]).toMatchObject({sourceCardId:'dark_silence_seal',sourceCardUid:'public-seal',targetCardId:cardId,targetCardUid:'public-cast',sourceCasterId:f.before.duel!.other.heroId,targetCasterId:f.before.player.heroId});
    expect(result.events.some(e=>e.type==='CARD_PLAYED'&&e.cardId===cardId)).toBe(false);
    expect(result.events.some(e=>e.type==='UNIT_SPAWNED')).toBe(false);
    expect(JSON.stringify(f.before)).toBe(before);expect(JSON.stringify(result)).toBe(after);
    if(cardId==='dark_scorpion_king')expect(result.state.units.find(u=>u.id===f.before.player.heroId)!.hp).toBe(18);
  });
  it('both public PvP views derive identical identities, without revealing their hands', () => {
    const f=negationFixture(), result=f.resolve();
    const plans=([0,1] as const).map(seat=>[...new NegationLedger().claim(result.events,{key:'pvp:same-match:12',live:true,before:duelView(f.before,seat,f.content)},lookup).values()]);
    expect(plans[0]).toEqual(plans[1]);
    expect(Object.keys(plans[0]![0]!)).not.toContain('hand');
    expect(JSON.stringify(plans)).not.toContain('private-discard');
  });
  it('does not animate selection, announcement, pass/expiry, invalid response, or unrelated mitigation', () => {
    const f=negationFixture(), l=new NegationLedger();
    expect(l.claim(f.announced.events,{key:'pve:a:1',live:true},lookup).size).toBe(0);
    expect(l.claim(f.resolve(true).events,{key:'pve:a:2',live:true,before:f.before},lookup).size).toBe(0);
    const saved=JSON.stringify(f.before);
    expect(()=>applyDuel(f.before,{type:'SILENCE_RESPONSE',windowId:f.before.pendingCast!.id,pass:false,sealUid:'public-seal',discardUid:'foreign'},f.content)).toThrow();
    expect(JSON.stringify(f.before)).toBe(saved);
    const harmless:GameEvent[]=[{type:'CARD_RESOLVED',cardUid:'x',cardId:'barrier'}];
    expect(l.claim(harmless,{key:'pve:a:3',live:true},lookup).size).toBe(0);
  });
  it('a cursed Seal never labels the continuing original spell as negated', () => {
    const f=negationFixture('magic_missile',true), result=f.resolve();
    expect(result.events.some(e=>e.type==='CARD_CURSE_TRIGGERED'&&e.cardId==='dark_silence_seal')).toBe(true);
    expect(result.events.some(e=>e.type==='CARD_NEGATED')).toBe(false);
    expect(result.events.some(e=>e.type==='CARD_PLAYED'&&e.cardId==='magic_missile')).toBe(true);
    expect(new NegationLedger().claim(result.events,{key:'pvp:curse:1',live:true,before:f.before},lookup).size).toBe(0);
  });
  it('does not invent a source when a negation event arrives without its public activation', () => {
    const f=negationFixture(), r=f.resolve(), only=r.events.filter(e=>e.type==='CARD_NEGATED');
    expect(new NegationLedger().claim(only,{key:'pvp:missing:1',live:true,before:f.before},lookup).size).toBe(0);
  });
  it('deduplicates cloned snapshots and new revisions of the same response window', () => {
    const f=negationFixture(),r=f.resolve(),l=new NegationLedger();
    expect(l.claim(r.events,{key:'pvp:repeat:2',live:true,before:f.before},lookup).size).toBe(1);
    expect(l.claim(structuredClone(r.events),{key:'pvp:repeat:2',live:true,before:f.before},lookup).size).toBe(0);
    expect(l.claim(structuredClone(r.events),{key:'pvp:repeat:3',live:true,before:f.before},lookup).size).toBe(0);
  });
  it('consumes recovery without replay, but permits a genuinely new window using the same cards', () => {
    const f=negationFixture(),r=f.resolve(),l=new NegationLedger();
    expect(l.claim(r.events,{key:'pvp:recover:1',live:false,before:f.before},lookup).size).toBe(0);
    expect(l.claim(r.events,{key:'pvp:recover:2',live:true,before:f.before},lookup).size).toBe(0);
    const before=structuredClone(f.before);before.pendingCast!.id+=':new-cast';
    expect(l.claim(r.events,{key:'pvp:recover:3',live:true,before},lookup).size).toBe(1);
    expect(l.claim(r.events,undefined,lookup).size).toBe(0);
  });
  it('uses the public announcement identity when the pending cast resolved in the same batch', () => {
    const f=negationFixture(),r=f.resolve(),l=new NegationLedger(),events=[...f.announced.events,...r.events];
    expect(l.claim(events,{key:'pve:auto:1',live:true},lookup).size).toBe(1);
    expect(l.claim(r.events,{key:'pve:auto:2',live:true},lookup).size).toBe(0);
  });
});

describe('nonblocking shared presentation clock', () => {
  it('holds for 2500ms and emits one official cue, without another clock or repeated sound', () => {
    const impact=vi.fn(),lane=new NegationLane(impact);lanes.push(lane);lane.show(plan(),false);
    expect(readNegationFrame()?.progress).toBe(0);lane.tick(899);expect(impact).not.toHaveBeenCalled();
    lane.tick(1);lane.tick(300);expect(impact).toHaveBeenCalledTimes(1);
    lane.tick(1299);expect(readNegationFrame()).not.toBeNull();lane.tick(1);expect(readNegationFrame()).toBeNull();
    expect(NEGATION_DURATION_MS).toBe(2500);
  });
  it('reduced motion keeps readable dwell and can dismiss without advancing combat', () => {
    const impact=vi.fn(),lane=new NegationLane(impact);lanes.push(lane);lane.show(plan(),true);
    expect(readNegationFrame()?.reduced).toBe(true);expect(impact).toHaveBeenCalledTimes(1);
    readNegationFrame()!.dismiss();expect(readNegationFrame()).toBeNull();lane.tick(3000);expect(impact).toHaveBeenCalledTimes(1);
  });
  it('clear removes a surface and a later resolution replaces it instead of building a delay backlog', () => {
    const lane=new NegationLane();lanes.push(lane);const p=plan();lane.show(p,false);lane.tick(1000);
    lane.show({...p,id:p.id+':next'},false);expect(readNegationFrame()?.progress).toBe(0);expect(readNegationFrame()?.id).toContain(':next');
    lane.clear();expect(readNegationFrame()).toBeNull();
  });
  it('the actual director releases its original busy lock while the extra surface is still visible', () => {
    const f=negationFixture(),r=f.resolve(),busy:boolean[]=[];
    const effects=new Proxy({darkLight:{beginBatch(){},theme(){return true;}}},{get:(obj,k)=>k in obj?obj[k as keyof typeof obj]:['catalog','icePremium','avalanche','mage','fireball','bastion','pactSummon'].includes(String(k))?undefined:k==='center'||k==='lift'?(p:unknown)=>p:vi.fn()}) as unknown as ElementEffects;
    const host:DirectorHost={redraw(){},unit:()=>undefined,obstacle:()=>undefined,walk(){},busy:v=>busy.push(v),impulse(){},handPulse(){},card:lookup,turnBanner(){}};
    const d=new VfxDirector(effects,host);d.sync(f.before);const duration=compileTimeline(r.events,key,false).duration;
    let starts=0;const stop=subscribeNegation(frame=>{if(frame?.progress===0)starts++;});
    const batch={key:'pvp:director-lane:10',live:true,before:f.before};
    d.enqueue(r.events,r.state,false,batch);
    d.tick(duration);expect(d.busy).toBe(false);expect(busy.at(-1)).toBe(false);expect(readNegationFrame()).not.toBeNull();
    d.enqueue(r.events,r.state,false,batch);d.tick(duration);expect(starts).toBe(1);stop();
    const states:string[]=[];const off=subscribeNegation(frame=>states.push(frame?.id??'clear'));d.clear();off();expect(readNegationFrame()).toBeNull();expect(states.at(-1)).toBe('clear');
  });
});
