import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game';
import { withArcher } from '../src/game/data/archer';
import { DIALOGUE_LIBRARY, VOICES } from '../src/game/data/dialogue';
import { WORLD_CAMPAIGNS } from '../src/game/data/worlds';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import {
  campaignDialogue,
  dialogueKeys,
  DIALOGUE_EXPRESSIONS,
  findMatchup,
  matchupId,
  pvpIntro,
  pvpOutro,
  type DialogueLibrary,
} from '../src/game/dialogue/dialogue';
import { DialogueOverlay, dialogueStep } from '../src/presentation/dialogue/DialogueOverlay';
import { pvpMatchKey } from '../src/presentation/dialogue/DialogueGates';
import {
  introDecision,
  outroDecision,
  readDialogueSettings,
  SeenDialogues,
  writeDialogueSettings,
  type KeyValueStore,
} from '../src/presentation/dialogue/dialogueSession';
import { speakerView } from '../src/presentation/dialogue/speakers';

const LIB = DIALOGUE_LIBRARY;
const CONTENT = withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
const HEROES = ['mage', 'summoner', 'warrior', 'shapeshifter', 'archer'] as const;
const memory = (): KeyValueStore => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const texts = (seq: { lines: { speaker: string; text: string }[] } | null) => seq?.lines.map((l) => `${l.speaker}:${l.text}`);

describe('PvP intro banter', () => {
  it('has a specific matchup (two variants) for every pair and every mirror of the five champions', () => {
    for (const a of HEROES)
      for (const b of HEROES) {
        const m = findMatchup(LIB, a, b);
        expect(m, `${a} vs ${b}`).toBeDefined();
        expect(m!.variants).toHaveLength(2);
        for (const v of m!.variants) {
          expect(v.length).toBeGreaterThanOrEqual(2);
          expect(v.length).toBeLessThanOrEqual(3);
          expect(new Set(v.map((l) => l.by))).toEqual(new Set([0, 1])); // both champions speak
        }
      }
    expect(LIB.pvp).toHaveLength(15);
    expect(new Set(LIB.pvp.map((m) => matchupId(...m.pair))).size).toBe(15);
  });

  it('looks up the right matchup: Mage vs Archer lines are spoken by those two, from their exchange', () => {
    const seq = pvpIntro(LIB, { heroes: ['mage', 'archer'], matchKey: 'm-1' })!;
    expect(seq.moment).toBe('PVP_INTRO');
    expect(new Set(seq.lines.map((l) => l.speaker))).toEqual(new Set(['mage', 'archer']));
    expect(seq.lines.every((l) => l.key.startsWith('pvp.intro.archer__mage.v'))).toBe(true);
    for (const l of seq.lines) expect(l.seat).toBe(l.speaker === 'mage' ? 0 : 1);
  });

  it('reversed seat order gives the same exchange, with seats following the champions', () => {
    const a = pvpIntro(LIB, { heroes: ['warrior', 'archer'], matchKey: 'room-7' })!;
    const b = pvpIntro(LIB, { heroes: ['archer', 'warrior'], matchKey: 'room-7' })!;
    expect(texts(a)).toEqual(texts(b));
    expect(a.lines.map((l) => l.key)).toEqual(b.lines.map((l) => l.key));
    for (const l of b.lines) expect(l.seat).toBe(l.speaker === 'archer' ? 0 : 1);
  });

  it('mirror matchups use both seats and the mirror exchange', () => {
    for (const hero of HEROES) {
      const seq = pvpIntro(LIB, { heroes: [hero, hero], matchKey: `mirror-${hero}` })!;
      expect(seq.lines.every((l) => l.speaker === hero)).toBe(true);
      expect(new Set(seq.lines.map((l) => l.seat))).toEqual(new Set([0, 1]));
      expect(seq.lines[0]!.key).toContain(`pvp.intro.${hero}__${hero}.`);
    }
  });

  it('variant choice is deterministic per match and both variants occur across matches', () => {
    const key = (k: string) => pvpIntro(LIB, { heroes: ['summoner', 'archer'], matchKey: k })!.lines[0]!.key;
    expect(key('abc')).toBe(key('abc'));
    const variants = new Set(Array.from({ length: 40 }, (_, i) => key(`match-${i}`).split('.')[3]));
    expect(variants).toEqual(new Set(['v1', 'v2']));
  });

  it('a new match id (rematch) is a new sequence; the same match id is the same one', () => {
    const one = pvpIntro(LIB, { heroes: ['mage', 'warrior'], matchKey: 'm-a' })!;
    expect(pvpIntro(LIB, { heroes: ['mage', 'warrior'], matchKey: 'm-a' })!.id).toBe(one.id);
    expect(pvpIntro(LIB, { heroes: ['mage', 'warrior'], matchKey: 'm-b' })!.id).not.toBe(one.id);
    expect(pvpMatchKey({ matchId: 'uuid-1', code: 'ABCD', members: [] })).toBe('uuid-1');
    expect(pvpMatchKey({ code: 'ABCD', members: [{ name: 'a', heroId: 'mage' }, { name: 'b', heroId: 'archer' }] })).toBe('ABCD:a/mage|b/archer');
  });
});

describe('PvP post-match line', () => {
  it('every ordered matchup, mirrors included, has a specific short winner line', () => {
    for (const w of HEROES) for (const l of HEROES) expect(LIB.pvpVictory[`${w}>${l}`], `${w}>${l}`).toBeTruthy();
    const seq = pvpOutro(LIB, { heroes: ['mage', 'archer'], matchKey: 'm', winnerSeat: 1 })!;
    expect(seq.lines[0]).toMatchObject({ speaker: 'archer', seat: 1, text: 'Tanto poder… y aun así no viste venir la flecha.' });
    expect(seq.lines).toHaveLength(2); // one winner line + one short loser line, no conversation
    expect(seq.lines[1]).toMatchObject({ speaker: 'mage', seat: 0, expression: 'wounded' });
  });

  it('draws have no outro', () => {
    expect(pvpOutro(LIB, { heroes: ['mage', 'archer'], matchKey: 'm', winnerSeat: -1 })).toBeNull();
  });
});

describe('campaign dialogue', () => {
  it('main-act intro: authored enemy line + the champion response (own line or its voice pool)', () => {
    const warrior = campaignDialogue(LIB, { encounterId: 'ascent_04_shield_wall', tier: 'NORMAL', heroId: 'warrior', phase: 'intro' })!;
    expect(warrior.moment).toBe('ENCOUNTER_INTRO');
    expect(texts(warrior)).toEqual(['stone_brute:Muro. Yo soy muro.', 'warrior:Yo también. Veamos cuál aguanta.']);
    const mage = campaignDialogue(LIB, { encounterId: 'ascent_04_shield_wall', tier: 'NORMAL', heroId: 'mage', phase: 'intro' })!;
    expect(mage.lines[1]!.speaker).toBe('mage');
    expect(VOICES.mage!.responses.encounter).toContain(mage.lines[1]!.text);
    // Deterministic pool pick.
    expect(texts(campaignDialogue(LIB, { encounterId: 'ascent_04_shield_wall', tier: 'NORMAL', heroId: 'mage', phase: 'intro' }))).toEqual(texts(mage));
  });

  it('every encounter of the main acts has an intro line for every champion that plays it', () => {
    for (const id of ['ascent', 'infernal']) {
      const campaign = Object.values(WORLD_CAMPAIGNS).find((c) => c.id === id)!;
      for (const e of campaign.encounters)
        for (const hero of campaign.heroIds) {
          const seq = campaignDialogue(LIB, { encounterId: e.id, tier: e.tier, heroId: hero, phase: 'intro' });
          expect(seq, `${e.id} / ${hero}`).not.toBeNull();
          expect(seq!.lines.some((l) => l.speaker === hero), `${e.id} / ${hero} answers`).toBe(true);
          expect(seq!.lines.length).toBeLessThanOrEqual(e.tier === 'NORMAL' ? 2 : 5);
        }
    }
  });

  it('elites and bosses in every campaign have a 2–5 line intro and a defeat scene', () => {
    for (const campaign of Object.values(WORLD_CAMPAIGNS))
      for (const e of campaign.encounters.filter((x) => x.tier !== 'NORMAL'))
        for (const hero of campaign.heroIds) {
          const intro = campaignDialogue(LIB, { encounterId: e.id, tier: e.tier, heroId: hero, phase: 'intro' })!;
          const outro = campaignDialogue(LIB, { encounterId: e.id, tier: e.tier, heroId: hero, phase: 'outro' })!;
          expect(intro.moment).toBe(e.tier === 'BOSS' ? 'BOSS_INTRO' : 'ELITE_INTRO');
          expect(outro.moment).toBe(e.tier === 'BOSS' ? 'BOSS_DEFEAT' : 'ELITE_DEFEAT');
          expect(intro.lines.length).toBeGreaterThanOrEqual(2);
          expect(intro.lines.length).toBeLessThanOrEqual(5);
          expect(outro.lines.length).toBeGreaterThanOrEqual(2);
        }
  });

  it('bosses answer with a line written for each champion', () => {
    for (const boss of ['ascent_10_colossus', 'w2_e10'])
      for (const hero of HEROES) {
        const seq = campaignDialogue(LIB, { encounterId: boss, tier: 'BOSS', heroId: hero, phase: 'intro' })!;
        expect(seq.lines.find((l) => l.speaker === hero)!.key).toMatch(new RegExp(`\\.${hero}$`));
      }
  });

  it('Sendero del Cazador: the Stalker, the Guardian and the Beast have their authored exchanges', () => {
    const beast = campaignDialogue(LIB, { encounterId: 'hunt_10_veil_beast', tier: 'BOSS', heroId: 'archer', phase: 'intro' })!;
    expect(texts(beast)).toContain('veil_beast:Has seguido mis rastros demasiado lejos, cazador.');
    expect(texts(beast)).toContain('archer:No seguía tus rastros. Te dejaba creer que escapabas.');
    const fall = campaignDialogue(LIB, { encounterId: 'hunt_10_veil_beast', tier: 'BOSS', heroId: 'archer', phase: 'outro' })!;
    expect(texts(fall)).toEqual(['veil_beast:Entonces… eras tú… quien me cazaba…', 'archer:Desde el principio.']);
    for (const elite of ['hunt_05_stalker', 'hunt_09_guardian']) {
      const intro = campaignDialogue(LIB, { encounterId: elite, tier: 'ELITE', heroId: 'archer', phase: 'intro' })!;
      expect(intro.lines.length).toBeGreaterThanOrEqual(4);
      expect(intro.lines.filter((l) => l.speaker === 'archer').length).toBeGreaterThanOrEqual(2);
    }
    for (const e of WORLD_CAMPAIGNS.archer_hunt!.encounters)
      expect(campaignDialogue(LIB, { encounterId: e.id, tier: e.tier, heroId: 'archer', phase: 'intro' }), e.id).not.toBeNull();
  });

  it('every speaker is a known champion, enemy or the narrator, and every encounter id exists', () => {
    const encounterIds = new Set(Object.values(WORLD_CAMPAIGNS).flatMap((c) => c.encounters.map((e) => e.id)));
    for (const [id, def] of Object.entries(LIB.campaign)) {
      expect(encounterIds.has(id), id).toBe(true);
      for (const line of [...(def.intro ?? []), ...(def.outro ?? [])]) {
        if (line.speaker === 'HERO' || line.speaker === 'narrator') continue;
        expect(CONTENT.enemies[line.speaker] ?? CONTENT.heroes[line.speaker], line.speaker).toBeDefined();
      }
    }
  });
});

describe('fallbacks', () => {
  it('missing dialogue resolves to null instead of throwing', () => {
    expect(campaignDialogue(LIB, { encounterId: 'no_such_encounter', tier: 'NORMAL', heroId: 'mage', phase: 'intro' })).toBeNull();
    expect(campaignDialogue(LIB, { encounterId: 'ascent_01_outpost', tier: 'NORMAL', heroId: 'mage', phase: 'outro' })).toBeNull();
  });

  it('a pair without an authored exchange falls back to each champion\'s greeting', () => {
    const lib: DialogueLibrary = { ...LIB, pvp: LIB.pvp.filter((m) => matchupId(...m.pair) !== 'archer__mage') };
    const seq = pvpIntro(lib, { heroes: ['mage', 'archer'], matchKey: 'x' })!;
    expect(seq.lines.map((l) => [l.speaker, l.seat])).toEqual([['mage', 0], ['archer', 1]]);
    expect(VOICES.mage!.greeting).toContain(seq.lines[0]!.text);
  });

  it('an unknown future champion never crashes: known side speaks, otherwise no scene', () => {
    expect(() => pvpIntro(LIB, { heroes: ['necromancer', 'archer'], matchKey: 'k' })).not.toThrow();
    const seq = pvpIntro(LIB, { heroes: ['necromancer', 'archer'], matchKey: 'k' })!;
    expect(seq.lines.map((l) => l.speaker)).toEqual(['archer']);
    expect(pvpIntro(LIB, { heroes: ['necromancer', 'lich'], matchKey: 'k' })).toBeNull();
    const outro = pvpOutro(LIB, { heroes: ['necromancer', 'archer'], matchKey: 'k', winnerSeat: 0 })!;
    expect(outro.lines.map((l) => l.speaker)).toEqual(['archer']); // only the loser line exists
    const scene = campaignDialogue(LIB, { encounterId: 'ascent_10_colossus', tier: 'BOSS', heroId: 'necromancer', phase: 'intro' })!;
    expect(scene.lines.every((l) => l.speaker !== 'HERO')).toBe(true);
    expect(scene.lines.some((l) => l.speaker === 'necromancer')).toBe(false); // nothing to say yet: dropped
    expect(speakerView(CONTENT, 'necromancer').name).toBe('necromancer');
    expect(speakerView(CONTENT, 'archer').isHero).toBe(true);
  });
});

describe('skip, settings and reconnect', () => {
  it('next walks the lines and closes after the last; skip closes the whole sequence at once', () => {
    expect(dialogueStep(0, 3, 'next')).toEqual({ index: 1, closed: false });
    expect(dialogueStep(2, 3, 'next')).toEqual({ index: 2, closed: true });
    expect(dialogueStep(0, 3, 'skip')).toEqual({ index: 0, closed: true });
  });

  it('the overlay renders the first line, the speaker and a Skip control', () => {
    const sequence = campaignDialogue(LIB, { encounterId: 'hunt_05_stalker', tier: 'ELITE', heroId: 'archer', phase: 'intro' })!;
    const html = renderToStaticMarkup(createElement(DialogueOverlay, { sequence, content: CONTENT, mode: 'modal', onClose: () => {} }));
    expect(html).toContain('Algo se mueve entre los helechos');
    expect(html).toContain('Saltar');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-side="center"'); // narrator
    const pvp = pvpIntro(LIB, { heroes: ['mage', 'archer'], matchKey: 'k' })!;
    const ambient = renderToStaticMarkup(createElement(DialogueOverlay, { sequence: pvp, content: CONTENT, mode: 'ambient', sideOf: (l) => (l.seat === 1 ? 'left' : 'right'), onClose: () => {} }));
    expect(ambient).toContain('data-mode="ambient"');
    expect(ambient).toContain(`data-side="${pvp.lines[0]!.seat === 1 ? 'left' : 'right'}"`);
  });

  it('PvP dialogue can be switched off and the setting persists', () => {
    const store = memory();
    expect(readDialogueSettings(store)).toEqual({ pvp: true, campaign: true });
    writeDialogueSettings({ pvp: false, campaign: true }, store);
    expect(readDialogueSettings(store).pvp).toBe(false);
    const seen = new SeenDialogues(memory());
    expect(introDecision({ sequenceId: 'pvp:m:intro', enabled: false, progress: { round: 1, finished: false }, seen })).toBe('SKIP_DISABLED');
    expect(readDialogueSettings({ getItem: () => '{broken', setItem: () => {} })).toEqual({ pvp: true, campaign: true });
  });

  it('reconnect, refresh or replay recovery never restarts the intro', () => {
    const seen = new SeenDialogues(memory());
    const fresh = { round: 1, commands: 0, cardsPlayed: 0, finished: false };
    expect(introDecision({ sequenceId: 'pvp:m:intro', enabled: true, progress: fresh, seen })).toBe('PLAY');
    seen.mark('pvp:m:intro');
    // Refresh/reconnect on the same device before anything happened: already shown.
    expect(introDecision({ sequenceId: 'pvp:m:intro', enabled: true, progress: fresh, seen })).toBe('SKIP_SEEN');
    // Reconnect from anywhere into a battle already under way: straight back to combat.
    const other = new SeenDialogues(memory());
    expect(introDecision({ sequenceId: 'pvp:m:intro', enabled: true, progress: { round: 3, finished: false }, seen: other })).toBe('SKIP_STARTED');
    expect(introDecision({ sequenceId: 'pvp:m:intro', enabled: true, progress: { round: 1, cardsPlayed: 1, finished: false }, seen: other })).toBe('SKIP_STARTED');
    expect(introDecision({ sequenceId: 'c:intro', enabled: true, progress: { round: 1, commands: 2, finished: false }, seen: other })).toBe('SKIP_STARTED');
    expect(introDecision({ sequenceId: null, enabled: true, progress: fresh, seen: other })).toBe('SKIP_NONE');
    // Outro once: a refresh on the result screen does not repeat it.
    other.mark('c:outro');
    expect(outroDecision({ sequenceId: 'c:outro', enabled: true, seen: other })).toBe('SKIP_SEEN');
  });

  it('the seen list is bounded and survives broken storage', () => {
    const store = memory();
    const seen = new SeenDialogues(store);
    for (let i = 0; i < 120; i++) seen.mark(`s${i}`);
    expect(seen.has('s119')).toBe(true);
    expect(seen.has('s0')).toBe(false);
    const broken = new SeenDialogues({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(() => broken.mark('x')).not.toThrow();
    expect(broken.has('x')).toBe(false);
  });
});

describe('localization readiness and style', () => {
  it('every line has a unique stable key, and a translation catalog replaces text by key', () => {
    const keys = dialogueKeys(LIB);
    expect(new Set(keys).size).toBe(keys.length);
    const seq = pvpIntro(LIB, { heroes: ['warrior', 'archer'], matchKey: 'k', translate: (k) => (k.endsWith('.1') ? `EN:${k}` : undefined) })!;
    expect(seq.lines[0]!.text).toBe(`EN:${seq.lines[0]!.key}`);
    expect(seq.lines[1]!.text).not.toMatch(/^EN:/);
    // Keys emitted at runtime are all in the catalog list.
    const emitted = [
      ...pvpIntro(LIB, { heroes: ['mage', 'mage'], matchKey: 'q' })!.lines,
      ...pvpOutro(LIB, { heroes: ['mage', 'archer'], matchKey: 'q', winnerSeat: 0 })!.lines,
      ...campaignDialogue(LIB, { encounterId: 'ascent_01_outpost', tier: 'NORMAL', heroId: 'summoner', phase: 'intro' })!.lines,
      ...campaignDialogue(LIB, { encounterId: 'hunt_10_veil_beast', tier: 'BOSS', heroId: 'archer', phase: 'outro' })!.lines,
    ].map((l) => l.key);
    for (const k of emitted) expect(keys).toContain(k);
  });

  it('lines are short, non-empty and use only the expression contract', () => {
    const all = [
      ...LIB.pvp.flatMap((m) => m.variants.flat()),
      ...Object.values(LIB.campaign).flatMap((d) => [...(d.intro ?? []), ...(d.outro ?? [])]),
    ];
    for (const l of all) {
      for (const text of [l.text, ...Object.values('byHero' in l ? l.byHero ?? {} : {})].filter((t): t is string => t !== undefined)) {
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text.length, text).toBeLessThanOrEqual(90);
      }
      if (l.expression) expect(DIALOGUE_EXPRESSIONS).toContain(l.expression);
    }
    for (const v of Object.values(VOICES)) expect(DIALOGUE_EXPRESSIONS).toContain(v.defaultExpression);
    for (const t of Object.values(LIB.pvpVictory)) expect(t.length).toBeLessThanOrEqual(70);
  });

  it('every champion that can play has a voice', () => {
    for (const hero of new Set(Object.values(WORLD_CAMPAIGNS).flatMap((c) => c.heroIds))) expect(VOICES[hero], hero).toBeDefined();
  });
});
