import { SECTION_SPIN_MS } from '../motion/sectionTiming';
import type { GameEvent } from '../../game';
import { resolutionTiming } from './resolutionProfiles';
import { TURN } from '../motion/tokens.ts';
import { isArrowVisual, specialArrow } from '../assets/archerHuntVisuals';

export type CueKind = 'ritualCircle' | 'cast' | 'projectile' | 'spellImpact' | 'move' | 'event' | 'reactionPrepare' | 'attackImpact' | 'commit';
export interface VisualCue {
  at: number;
  kind: CueKind;
  event: GameEvent;
  duration: number;
  key: string;
}
/** Timing only. Coordinates, recipients and outcomes remain the original event payloads. */
export function compileTimeline(
  events: readonly GameEvent[],
  visualKey: (cardId: string) => string,
  reduced: boolean,
  _readable = false,
): { cues: VisualCue[]; duration: number } {
  // Retain the former laboratory argument for existing callers; budgets now apply everywhere.
  void _readable;
  const cues: VisualCue[] = [];
  let cursor = 0,
    effectAt = 0,
    lastDamageAt = 0,
    recoveryUntil = 0;
  let spell: {
    start: number;
    impact: number;
    end: number;
    key: string;
    cast: number;
    travel: number;
  } | null = null;
  const add = (at: number, kind: CueKind, event: GameEvent, duration = 0, key = spell?.key ?? '') =>
    cues.push({ at, kind, event, duration, key });
  for (const event of events) {
    if (event.type === 'COUNTER_ATTACK') {
      // Reactions are separate visual actions, not another simultaneous hit.
      // The authoritative event sequence/payload remains untouched.
      const start = Math.max(cursor, effectAt, lastDamageAt + (reduced ? 100 : 220));
      const prepare = reduced ? 40 : 120, attack = reduced ? 80 : 200;
      add(start, 'reactionPrepare', event, prepare);
      add(start + prepare, 'event', event, attack);
      cursor = effectAt = start + prepare + attack;
      add(cursor, 'attackImpact', event);
      recoveryUntil = cursor + (reduced ? 120 : 240);
      if (spell) spell.end = Math.max(spell.end, recoveryUntil);
    } else if(event.type==='FORM_CHANGED') {
      const at=spell?effectAt:cursor,duration=reduced?120:360;
      add(at,'event',event,duration);
      recoveryUntil=Math.max(recoveryUntil,at+duration);
    } else if (event.type === 'UNIT_DEFEATED') {
      const at = (spell ? effectAt : cursor) + (reduced ? 40 : 120);
      const duration = reduced ? 160 : 600;
      add(at, 'event', event, duration);
      add(at + duration, 'commit', event);
      recoveryUntil = Math.max(recoveryUntil, at + duration);
    } else if (event.type === 'CARD_PLAYED') {
      cursor = Math.max(cursor, recoveryUntil);
      const key = specialArrow(event.cardId) ? event.cardId : visualKey(event.cardId);
      const resolvedIndex = events.indexOf(event);
      const nextResolution = events.slice(resolvedIndex + 1).findIndex(e => e.type === 'CARD_RESOLVED');
      const ownEvents = events.slice(resolvedIndex + 1, nextResolution < 0 ? undefined : resolvedIndex + 1 + nextResolution);
      const timing = resolutionTiming(key, reduced, ownEvents.some(e => e.type === 'UNIT_SPAWNED' && e.kind === 'SUMMON'));
      const cast = isArrowVisual(key) && !reduced ? 300 : timing.cast;
      const travel = isArrowVisual(key) && !reduced ? 220 : timing.travel;
      spell = {
        start: cursor,
        impact: cursor + cast + travel,
        end: cursor + cast + travel + timing.aftermath + timing.read,
        key,
        cast,
        travel,
      };
      effectAt = spell.impact;
      add(cursor, 'cast', event, cast);
      // LINE cards emit PROJECTILE_LAUNCHED themselves; UNIT shots need the cue here.
      const lineShot = event.direction !== null && event.affectedTiles.length > 1;
      if (((key === 'magic_missile' || key === 'fireball') && !ownEvents.some(e => e.type === 'PROJECTILE_LAUNCHED')) || (isArrowVisual(key) && !lineShot)) add(cursor + cast, 'projectile', event, travel);
      add(spell.impact, 'spellImpact', event, key === 'magic_missile' || isArrowVisual(key) ? 130 : 220);
    } else if (event.type === 'ARROW_REBOUNDED') {
      // Each authoritative hop flies before its damage is projected. No invented recipients.
      const travel = reduced ? 50 : 180;
      const start = Math.max(effectAt, lastDamageAt);
      add(start, 'projectile', event, travel, 'rebound_arrow');
      effectAt = start + travel;
      add(effectAt, 'event', event, 0, 'rebound_arrow');
    } else if (event.type === 'RITUAL_ACTIVATED') {
      const four = event.pieces.length === 4;
      const total = four ? (reduced ? 900 : 3000) : reduced ? 240 : event.tier === 'MAJOR' ? 1200 : 950;
      spell = {start:cursor,impact:cursor+(four ? (reduced ? 350 : 1800) : reduced?80:450),end:cursor+total,key:`ritual:${event.ritualId}`,cast:0,travel:0};
      add(cursor,'event',event,total);
      if (four) add(cursor + (reduced ? 250 : 1350), 'ritualCircle', event, reduced ? 200 : 650);
      effectAt=spell.impact;
    } else if(event.type==='RITUAL_RESOLVED') {
      cursor=Math.max(cursor,spell?.end??effectAt);add(cursor,'event',event);spell=null;
    } else if (event.type === 'UNIT_SPAWNED'  && event.kind === 'SUMMON') {
      const at = (spell ? effectAt : cursor) + (reduced ? 40 : 150);
      add(at, 'event', event, reduced ? 120 : 600);
      if (spell) spell.end = Math.max(spell.end, at + (reduced ? 240 : 840));
      else cursor = at + (reduced ? 240 : 840);
    } else if (event.type === 'SUMMON_CAPACITY_CHANGED') {
      // Vínculo Prohibido: the seal locks in after the sacrifice has been read.
      const at = (spell ? effectAt : cursor) + (reduced ? 60 : 420);
      add(at, 'event', event, reduced ? 160 : 620);
      if (spell) spell.end = Math.max(spell.end, at + (reduced ? 160 : 620));
      else cursor = at + (reduced ? 160 : 620);
    } else if (event.type === 'SUMMON_BREATH') {
      add(cursor, 'event', event, reduced ? 120 : 480, 'primordial_breath');
      cursor += reduced ? 40 : 120;
      effectAt = cursor;
      add(cursor,'attackImpact',event);
    } else if (event.type === 'SUMMON_ATTACKED') {
      cursor = Math.max(cursor, recoveryUntil);
      add(cursor, 'event', event, reduced ? 40 : 180);
      cursor += reduced ? 40 : 180;
      effectAt = cursor;
      add(cursor,'attackImpact',event);
    } else if (event.type === 'PROJECTILE_LAUNCHED') {
      add((spell?.start ?? cursor) + (spell?.cast ?? 0), 'projectile', event, spell?.travel ?? 100);
    } else if (event.type === 'CARD_RESOLVED') {
      cursor = Math.max(spell?.end ?? cursor, effectAt, recoveryUntil);
      add(cursor, 'event', event);
      spell = null;
    } else if (
      event.type === 'UNIT_MOVED' ||
      event.type === 'UNIT_PUSHED' ||
      event.type === 'UNIT_TELEPORTED'
    ) {
      const at = Math.max(spell ? effectAt : cursor, recoveryUntil);
      const duration =
        event.type === 'UNIT_MOVED' && event.mode === 'WALK'
          ? Math.max(1, event.path.length) * (reduced ? 100 : 300)
          : reduced
            ? 0
            : event.type === 'UNIT_TELEPORTED'
              ? 230
              : event.type === 'UNIT_PUSHED'
                ? 140
                : spell?.key === 'warrior_charge' || spell?.key === 'ram'
                  ? 320
                  : 160;
      add(at, 'move', event, duration);
      add(at + duration, 'event', event);
      if (spell) effectAt = at + duration;
      else {
        cursor = at + duration;
        effectAt = cursor;
      }
    } else if (event.type === 'MECHANISM_CHANGED' && event.cue === 'SECTION_ROTATED') {
      // Share the event queue: a scheduled turn must not run ahead of enemy actions.
      cursor = Math.max(cursor, effectAt, recoveryUntil, spell?.end ?? 0);
      const duration = reduced ? 0 : SECTION_SPIN_MS;
      add(cursor, 'event', event, duration);
      cursor += duration;
      effectAt = cursor;
    } else if (event.type === 'TURN_STARTED') {
      // Turn banner: nothing acts (and the player gets no input) until it has been read.
      cursor = Math.max(cursor, effectAt, recoveryUntil);
      add(cursor, 'event', event); // the banner itself is CSS; only the hold gates playback
      cursor += reduced ? TURN.holdReduced : TURN.hold;
      effectAt = cursor;
    } else if (event.type === 'ENEMY_ACTION_STARTED') {
      cursor = Math.max(cursor, recoveryUntil);
      effectAt = cursor;
      add(cursor, 'event', event);
    } else if (event.type === 'ENEMY_ATTACKED') {
      const duration = reduced ? 60 : event.intentKind === 'MELEE_ATTACK' ? 200 : 70;
      add(cursor, 'event', event, duration);
      cursor += duration;
      effectAt = cursor;
      add(cursor, 'attackImpact', event);
    } else if (event.type === 'ENEMY_ACTION_ENDED') {
      cursor = Math.max(cursor + (reduced ? 60 : 180), recoveryUntil);
      add(cursor, 'event', event);
      effectAt = cursor;
    } else {
      const at = spell ? effectAt : cursor;
      if (event.type === 'UNIT_DAMAGED') lastDamageAt = at;
      add(at, 'event', event);
    }
  }
  // Stable sort preserves causal ordering for simultaneous hits / shield breaks / deaths.
  cues.sort((a, b) => a.at - b.at);
  return {
    cues,
    duration: Math.max(
      1,
      cursor,
      recoveryUntil,
      ...cues.map((c) => c.at + c.duration + (c.event.type === 'UNIT_DAMAGED' ? 120 : 0)),
    ),
  };
}
