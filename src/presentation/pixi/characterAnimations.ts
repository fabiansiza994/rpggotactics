import { archerPresentationEnabled } from '../archerRelease';
import { ARCHER_ANIMATION, ARCHER_VISUAL_ID } from '../qa/archer/visuals';
import { shapeshifterQaEnabled } from '../qa/shapeshifter/access';
import { verticalAsset } from '../qa/locomotion/directionalProfiles';
import { SUMMONER_LOCOMOTION } from '../qa/locomotion/summonerLocomotion';
import { shapeshifterPresentationEnabled } from '../shapeshifterRelease';
import { QA_FORM_VISUALS } from '../qa/shapeshifter/visuals';
import type { CardinalView } from './directionalFacing';
import type { CharacterMotion, AnimationFrames } from './CharacterAnimator.ts';

export interface CharacterAnimationLayout {
  url: string;
  columns: number;
  cellSize: number;
  runtimeScale: number;
  /** New gait atlas; static poses and existing procedural gestures keep their master artwork. */
  locomotionOnly?: boolean;
  actionStyle?: 'martial' | 'spell';
  directionalUrls?: Record<CardinalView, string>;
  /** Authored subject region inside each source cell; retains the original canvas/ground line. */
  directionalRegions?: Partial<Record<CardinalView, readonly { x:number; y:number; width:number; height:number }[]>>;
  clips: Partial<Record<CharacterMotion, AnimationFrames & { start: number }>>;
}

/** Clean, padded Guardian atlases. Art availability never changes encounter release. */
export const GUARDIAN_EXPOSED_VISUAL_ID = 'temple_guardian:exposed';
export const TEMPLE_GUARDIAN_ANIMATION: CharacterAnimationLayout = {
  url:'/art/temple/guardian-animations-v2/guardian-fortified-front.webp',columns:4,cellSize:256,runtimeScale:.5,
  directionalUrls:{front:'/art/temple/guardian-animations-v2/guardian-fortified-front.webp',back:'/art/temple/guardian-animations-v2/guardian-fortified-back.webp',left:'/art/temple/guardian-animations-v2/guardian-fortified-left.webp',right:'/art/temple/guardian-animations-v2/guardian-fortified-right.webp'},
  clips:{idle:{start:0,count:4,frameMs:300,loop:true,animatedIdle:true},walk:{start:4,count:6,frameMs:100,loop:true},run:{start:10,count:6,frameMs:75,loop:true},attack:{start:16,count:4,frameMs:90,loop:false,contactFrame:2},hit:{start:20,count:2,frameMs:70,loop:false},death:{start:22,count:2,frameMs:270,loop:false,terminal:true}},
};
export const TEMPLE_GUARDIAN_EXPOSED_ANIMATION: CharacterAnimationLayout = {
  ...TEMPLE_GUARDIAN_ANIMATION,url:'/art/temple/guardian-animations-v2/guardian-exposed-front.webp',
  directionalUrls:{front:'/art/temple/guardian-animations-v2/guardian-exposed-front.webp',back:TEMPLE_GUARDIAN_ANIMATION.directionalUrls!.back,left:'/art/temple/guardian-animations-v2/guardian-exposed-left.webp',right:'/art/temple/guardian-animations-v2/guardian-exposed-right.webp'},
};
/** Half-resolution atlases; source frames retain the contract's 512×512 canvas. */
export const CHARACTER_ANIMATIONS: Record<string, CharacterAnimationLayout> = {
  warrior: {
    actionStyle: 'martial',
    url: '/art/animations/warrior_front.webp',
    columns: 3,
    cellSize: 256,
    runtimeScale: 0.5,
    directionalUrls: {
      front: '/art/animations/warrior_front.webp',
      back: '/art/animations/warrior_back.webp',
      left: '/art/animations/warrior_left.webp',
      right: '/art/animations/warrior_right.webp',
    },
    clips: {
      idle: { start: 0, count: 1, frameMs: 3200, loop: true },
      walk: { start: 6, count: 6, frameMs: 100, loop: true },
      attack: { start: 12, count: 6, frameMs: 65, loop: false, queueAfterHit: true },
      bash: { start: 18, count: 5, frameMs: 65, loop: false },
      charge: { start: 23, count: 4, frameMs: 80, loop: true },
      charge_stop: { start: 27, count: 2, frameMs: 80, loop: false },
      guard: { start: 29, count: 5, frameMs: 70, loop: true, loopStart: 3 },
      block: { start: 32, count: 2, frameMs: 40, loop: false },
      ability: { start: 34, count: 4, frameMs: 70, loop: false },
      hit: { start: 38, count: 3, frameMs: 40, loop: false },
      death: { start: 41, count: 3, frameMs: 200, loop: false, terminal: true },
    },
  },
  mage: {
    url: '/art/animations/mage.webp',
    columns: 3,
    cellSize: 256,
    runtimeScale: 0.5,
    clips: {
      idle: { start: 0, count: 6, frameMs: 3200 / 6, loop: true, animatedIdle: true },
      walk: { start: 6, count: 6, frameMs: 100, loop: true },
      cast: { start: 12, count: 6, frameMs: 65, loop: false },
      hit: { start: 18, count: 3, frameMs: 40, loop: false },
      death: { start: 21, count: 3, frameMs: 200, loop: false, terminal: true },
    },
  },
  orc_warrior: {
    url: '/art/animations/orc_warrior.webp',
    columns: 3,
    cellSize: 256,
    runtimeScale: 0.5,
    clips: {
      idle: { start: 0, count: 6, frameMs: 3200 / 6, loop: true }, // Unstable foot poses: use existing upper-body breathing on frame 0.
      walk: { start: 6, count: 6, frameMs: 100, loop: true },
      attack: { start: 12, count: 6, frameMs: 65, loop: false },
      hit: { start: 18, count: 3, frameMs: 40, loop: false },
      death: { start: 21, count: 3, frameMs: 200, loop: false, terminal: true },
    },
  },
  shadow_wolf: {
    url: '/art/animations/shadow_wolf.webp',
    columns: 3,
    cellSize: 256,
    runtimeScale: 0.5,
    clips: {
      idle: { start: 0, count: 3, frameMs: 3200 / 3, loop: true }, // Unstable foot poses: use existing upper-body breathing on frame 0.
      run: { start: 3, count: 3, frameMs: 80, loop: true },
      attack: { start: 6, count: 3, frameMs: 70, loop: false },
      hit: { start: 9, count: 2, frameMs: 55, loop: false },
      death: { start: 11, count: 1, frameMs: 600, loop: false, terminal: true },
    },
  },
  dark_shaman: {
    url: '/art/animations/dark_shaman.webp',
    columns: 3,
    cellSize: 256,
    runtimeScale: 0.5,
    clips: {
      idle: { start: 0, count: 3, frameMs: 3200 / 3, loop: true }, // Unstable foot poses: use existing upper-body breathing on frame 0.
      walk: { start: 3, count: 3, frameMs: 100, loop: true },
      cast: { start: 6, count: 3, frameMs: 65, loop: false },
      hit: { start: 9, count: 2, frameMs: 55, loop: false },
      death: { start: 11, count: 1, frameMs: 600, loop: false, terminal: true },
    },
  },
  stone_brute: {
    url: '/art/animations/stone_brute.webp',
    columns: 3,
    cellSize: 256,
    runtimeScale: 0.5,
    clips: {
      idle: { start: 0, count: 3, frameMs: 3200 / 3, loop: true }, // Unstable foot poses: use existing upper-body breathing on frame 0.
      walk_heavy: { start: 3, count: 3, frameMs: 160, loop: true },
      attack: { start: 6, count: 3, frameMs: 95, loop: false },
      hit: { start: 9, count: 2, frameMs: 70, loop: false },
      death: { start: 11, count: 1, frameMs: 850, loop: false, terminal: true },
    },
  },
};

CHARACTER_ANIMATIONS.temple_guardian=TEMPLE_GUARDIAN_ANIMATION;

/** Compact authored creature atlases, with independent back/front and both sides. */
for (const id of ['ancient_turtle', 'war_drake', 'ancient_wolf']) {
  CHARACTER_ANIMATIONS[id] = {
    url: `/art/rituals/${id}_front.webp`,
    columns: 6,
    cellSize: 256,
    runtimeScale: 0.5,
    directionalUrls: {
      front: `/art/rituals/${id}_front.webp`,
      back: `/art/rituals/${id}_back.webp`,
      left: `/art/rituals/${id}_left.webp`,
      right: `/art/rituals/${id}_right.webp`,
    },
    clips: {
      idle: { start: 0, count: 1, frameMs: 2400, loop: true },
      walk: { start: 1, count: 2, frameMs: id === 'ancient_turtle' ? 260 : 180, loop: true },
      attack: { start: 3, count: 1, frameMs: 220, loop: false },
      hit: { start: 4, count: 1, frameMs: 120, loop: false },
      death: { start: 5, count: 1, frameMs: 600, loop: false, terminal: true },
      arrival: { start: 0, count: 1, frameMs: 550, loop: false },
    },
  };
}

/** Backward-compatible alias for checks and tooling that name the original two-character pilot. */
export const PILOT_ANIMATIONS = CHARACTER_ANIMATIONS;

export function clipOffset(
  layout: CharacterAnimationLayout,
  state: CharacterMotion,
  frame: number,
) {
  const clip = layout.clips[state];
  if (!clip || frame < 0 || frame >= clip.count) return null;
  const index = clip.start + frame;
  return {
    x: (index % layout.columns) * layout.cellSize,
    y: Math.floor(index / layout.columns) * layout.cellSize,
    width: layout.cellSize,
    height: layout.cellSize,
  };
}

/** Optional authored directional atlas capability; shared by any future champion. */
export const hasDirectionalAtlas = (id: string): boolean =>
  !!CHARACTER_ANIMATIONS[id]?.directionalUrls;
export const hasDirectionalArt = (id: string): boolean => id === 'mage' || hasDirectionalAtlas(id) || !!verticalAsset(id);

/** Action vocabulary is independent of directional coverage (future spellcasters keep spells). */
export const hasMartialAnimation = (id: string): boolean =>
  CHARACTER_ANIMATIONS[id]?.actionStyle === 'martial';

/** Independently painted DOWN/UP/LEFT/RIGHT poses; no mirrored infernal views. */
export const INFERNAL_ANIMATION_IDS = [
  'infernal_imp',
  'infernal_knight',
  'ash_shaman',
  'magma_beast',
  'infernal_jailer',
  'forge_king',
  'ash_hound',
] as const;
for (const id of INFERNAL_ANIMATION_IDS) {
  CHARACTER_ANIMATIONS[id] = {
    url: `/art/infernal/${id}_front.webp`,
    columns: 8,
    cellSize: 256,
    runtimeScale: 0.5,
    directionalUrls: {
      front: `/art/infernal/${id}_front.webp`,
      back: `/art/infernal/${id}_back.webp`,
      left: `/art/infernal/${id}_left.webp`,
      right: `/art/infernal/${id}_right.webp`,
    },
    actionStyle: id === 'ash_shaman' ? 'spell' : 'martial',
    clips: {
      idle: { start: 0, count: 2, frameMs: 1300, loop: true, animatedIdle: true },
      walk: {
        start: 2,
        count: 2,
        frameMs: id === 'infernal_imp' ? 95 : id === 'ash_hound' ? 125 : 220,
        loop: true,
      },
      attack: {
        start: 4,
        count: 2,
        frameMs: id === 'infernal_imp' ? 75 : 160,
        loop: false,
        queueAfterHit: true,
      },
      cast: { start: 4, count: 2, frameMs: 160, loop: false },
      ability: { start: 4, count: 2, frameMs: 170, loop: false },
      arrival: { start: 0, count: 2, frameMs: 120, loop: false },
      hit: { start: 6, count: 1, frameMs: 120, loop: false },
      death: { start: 7, count: 1, frameMs: 650, loop: false, terminal: true },
    },
  };
}

/** Own authored locomotion per form, loaded only by the loopback QA client. */
export const QA_FORM_ANIMATIONS: Record<string, CharacterAnimationLayout> = {};
for (const visual of Object.values(QA_FORM_VISUALS)) {
  QA_FORM_ANIMATIONS[`qa_form_${visual.id}`] = {
    url: visual.locomotion.atlas,
    columns: 5,
    cellSize: 256,
    runtimeScale: 0.5,
    clips: {
      idle: { start: 0, count: 1, frameMs: 2000, loop: true },
      attack: { start: 1, count: 1, frameMs: 220, loop: false },
      cast: { start: 1, count: 1, frameMs: 220, loop: false },
      hit: { start: 2, count: 1, frameMs: 120, loop: false },
      death: { start: 3, count: 1, frameMs: 600, loop: false, terminal: true },
      arrival: { start: 0, count: 1, frameMs: 600, loop: false },
      walk: { start: 4, count: visual.locomotion.walkFrames, frameMs: 160, loop: true },
      run: { start: 7, count: visual.locomotion.runFrames, frameMs: 100, loop: true },
    },
  };
}

if (shapeshifterPresentationEnabled) Object.assign(CHARACTER_ANIMATIONS, QA_FORM_ANIMATIONS);

export const QA_SUMMONER_ANIMATIONS: Record<string, CharacterAnimationLayout> = Object.fromEntries(
  Object.entries(SUMMONER_LOCOMOTION).map(([id,profile])=>[id,{
    url:`/art/qa-summoner-locomotion/${id}.webp`,columns:4,cellSize:256,runtimeScale:0.5,locomotionOnly:true,
    clips:{
      idle:{start:0,count:1,frameMs:2500,loop:true},
      walk:{start:1,count:3,frameMs:profile.walkMs,loop:true},
      run:{start:4,count:3,frameMs:profile.runMs,loop:true},
      attack:{start:0,count:1,frameMs:180,loop:false},
      cast:{start:0,count:1,frameMs:180,loop:false},
      hit:{start:0,count:1,frameMs:120,loop:false},
      arrival:{start:0,count:1,frameMs:500,loop:false},
      death:{start:0,count:1,frameMs:600,loop:false,terminal:true},
    },
  }]),
);
if(shapeshifterPresentationEnabled)Object.assign(CHARACTER_ANIMATIONS,QA_SUMMONER_ANIMATIONS);

// Private visual specimen only; absent from production animation loading.
if (shapeshifterQaEnabled || archerPresentationEnabled) CHARACTER_ANIMATIONS[ARCHER_VISUAL_ID] = ARCHER_ANIMATION;

/** Only the ash-hound rear strip contains secondary sketches inside its source cells. */
CHARACTER_ANIMATIONS.ash_hound!.directionalRegions = {back: Array.from({length:8},(_,i)=>
  i===7 ? {x:32,y:76,width:152,height:156} : {x:24,y:56,width:116,height:176})};
export function animationRegion(layout:CharacterAnimationLayout, motion:CharacterMotion, frame:number, view:string) {
  const cell=clipOffset(layout,motion,frame);
  if(!cell)return null;
  const index=layout.clips[motion]!.start+frame;
  const crop=layout.directionalRegions?.[view as CardinalView]?.[index];
  return {frame:crop ? {...crop,x:cell.x+crop.x,y:cell.y+crop.y} : cell,
    orig:{x:0,y:0,width:layout.cellSize,height:layout.cellSize},
    trim:crop ? {x:(layout.cellSize-crop.width)/2,y:crop.y,width:crop.width,height:crop.height} : undefined};
}

/** Pact Golem: authored articulated clips; release remains gated by the free catalog. */
CHARACTER_ANIMATIONS.pact_golem = {
 url:'/art/free-catalog/golem-cycles/pact_golem-front.webp', columns:6, cellSize:256, runtimeScale:.5, actionStyle:'martial',
 directionalUrls:{front:'/art/free-catalog/golem-cycles/pact_golem-front.webp',back:'/art/free-catalog/golem-cycles/pact_golem-back.webp',left:'/art/free-catalog/golem-cycles/pact_golem-left.webp',right:'/art/free-catalog/golem-cycles/pact_golem-right.webp'},
 clips:{
  idle:{start:0,count:4,frameMs:480,loop:true,animatedIdle:true},
  arrival:{start:4,count:2,frameMs:220,loop:false},
  walk:{start:6,count:6,frameMs:140,loop:true},
  run:{start:12,count:6,frameMs:95,loop:true},
  attack:{start:18,count:3,frameMs:110,loop:false,contactFrame:1,queueAfterHit:true},
  hit:{start:21,count:1,frameMs:160,loop:false},
  death:{start:22,count:2,frameMs:310,loop:false,terminal:true},
 },
};
