import { catalogBatch, confirmedAttackFamily, familyRecipe, usesPhysicalArrow, type CatalogRecipe, type PremiumFamily } from './catalogRecipes';
import { mageRecipeEnabled } from './mageRecipes';
import { damageReaction, REACTION_COLOR, universalReactionsEnabled } from './hitReactions';
import { presentPublicRitual } from '../cards/publicCast';
import { bondCompanion, attackingMarkedPrey } from '../cards/tacticalPresentation';
import { motionCues } from '../motion/motionCues';
import {
  hasDirectionalArt,
  hasDirectionalAtlas,
  hasMartialAnimation,
} from '../pixi/characterAnimations';
import { cardinalView, type DirectionalFacing } from '../pixi/directionalFacing';
const shieldSide = (facing: DirectionalFacing): number =>
  ['back', 'left'].includes(cardinalView(facing)) ? -1 : 1;
import type { Container } from 'pixi.js';
import type { CardDefinition, EventOfType, GameEvent, GameState, Pos } from '../../game';
import type { UnitView } from '../pixi/UnitView';
import { ElementEffects, type Family } from './ElementEffects.ts';
import { compileTimeline, type VisualCue } from './spellTimeline.ts';
import { VisualQueue } from './VisualQueue.ts';
import { ARCHER_VISUAL_ID, ARCHER_RELEASE_FRAME, ARCHER_RELEASE_POINTS, archerShotTiming } from '../qa/archer/visuals';
import { PaintedFigure } from '../pixi/unitArt';
import { projectEvent } from './visualProjection.ts';
import { ARCHER_OPTIMAL_RANGE } from '../../game/data/archer';
import { isArrowVisual, specialArrow } from '../assets/archerHuntVisuals';

export interface DirectorHost {
  redraw(state: Readonly<GameState>): void;
  readableCards?: boolean;
  castCard?(event: EventOfType<'CARD_PLAYED'> | null): void;
  enemyAction?(event: EventOfType<'ENEMY_ACTION_STARTED'> | null): void;
  presentEvent?(event: GameEvent): void;
  unit(id: string): UnitView | undefined;
  obstacle(id: string): Container | undefined;
  walk(event: EventOfType<'UNIT_MOVED'>, reduced: boolean): void;
  busy(value: boolean): void;
  impulse(kind: 'LIGHT' | 'MEDIUM', reduced: boolean): void;
  groundImpact?(id:string, pos:Pos, strong:boolean): void;
  handPulse(count: number): void;
  card(id: string): CardDefinition | undefined;
  turnBanner(faction: 'PLAYER' | 'ENEMY', round: number): void;
}

function family(key: string): Family {
  if (key === 'fireball' || key === 'flame_tile' || key === 'magma_fissure' || key === 'summon_ash_hound' || key === 'FIRE') return 'FIRE';
  if (key === 'ice_wall' || key === 'frost_nova' || key === 'ICE') return 'ICE';
  if (key === 'barrier' || key === 'BARRIER') return 'BARRIER';
  if (key === 'force_push' || key === 'FORCE' || key === 'PHYSICAL') return 'FORCE';
  return 'ARCANE';
}

function lightColor(element: Family): number {
  switch (element) {
    case 'FIRE':
      return 0xff874d;
    case 'ICE':
      return 0x78e5ff;
    case 'BARRIER':
      return 0xffd578;
    case 'FORCE':
      return 0xffb25a;
    default:
      return 0xa890ff;
  }
}

/** Orchestrates already-resolved events; owns no command dispatch or gameplay query. */
export class VfxDirector {
  readonly queue = new VisualQueue();
  private visual: Readonly<GameState> | null = null;
  private accepted: Readonly<GameState> | null = null;
  private reportedBusy = false;
  private catalogActions = new WeakMap<GameEvent, CatalogRecipe>();
  private attackFamilies = new WeakMap<GameEvent, PremiumFamily>();
  private readonly moving = new Set<string>();
  private readonly hitCancels = new Map<string, () => void>();
  get busy(): boolean {
    return this.queue.busy;
  }
  get state(): Readonly<GameState> | null {
    return this.visual;
  }
  ownsPosition(id: string): boolean {
    return this.moving.has(id);
  }
  constructor(
    readonly effects: ElementEffects,
    private readonly host: DirectorHost,
  ) {}

  sync(state: Readonly<GameState>): void {
    if (!this.busy) {
      this.visual = state;
      this.accepted = state;
    }
    this.updateAmbient();
  }
  private updateAmbient(): void {
    if (!this.visual) return;
    const board = this.visual.board;
    this.effects.setFireTiles(
      board.tiles.flatMap((tile, i) =>
        tile.terrain === 'FIRE' ? [{ x: i % board.width, y: Math.floor(i / board.width) }] : [],
      ),
    );
  }
  enqueue(events: readonly GameEvent[], final: Readonly<GameState>, reduced: boolean): void {
    if (!this.visual || events.some((e) => e.type === 'BATTLE_STARTED')) {
      this.clear();
      this.sync(final);
      this.host.redraw(final);
      return;
    }
    this.effects.catalog?.beginBatch?.();
    for (const [event, recipe] of catalogBatch(events, id => this.host.card(id))) this.catalogActions.set(event, recipe);
    for (const event of events) {
      if (['ENEMY_ATTACKED','SUMMON_ATTACKED','SUMMON_BREATH','COUNTER_ATTACK'].includes(event.type))
        this.attackFamilies.set(event, confirmedAttackFamily(events, event));
      if(event.type==='ENEMY_ACTION_STARTED') {
        const following=events.slice(events.indexOf(event)+1).find(e=>e.type==='ENEMY_ATTACKED'&&e.enemyId===event.enemyId);
        if(following)this.attackFamilies.set(event,confirmedAttackFamily(events,following));
      }
    }
    this.effects.mage?.beginBatch?.();
    this.effects.fireball?.beginBatch?.();
    this.effects.bastion?.beginBatch?.();
    this.effects.pactSummon?.beginBatch?.();
    const previous = this.accepted ?? this.visual;
    this.accepted = final;
    const plan = compileTimeline(
      events,
      (id) => {const card=this.host.card(id);return card&&usesPhysicalArrow(card)?'archer_arrow':card?.presentation.visualKey??id;},
      reduced,
      this.host.readableCards ?? false,
    );
    let nextCue = 0;
    this.queue.enqueue({
      duration: plan.duration,
      begin: () => {
        this.effects.reduced = reduced;
        if(this.effects.catalog)this.effects.catalog.reduced=reduced;
        this.visual = structuredClone(previous);
        this.host.busy(true);
        this.reportedBusy = true;
        this.host.redraw(this.visual);
      },
      update: (elapsed) => {
        while (nextCue < plan.cues.length && plan.cues[nextCue]!.at <= elapsed)
          this.play(plan.cues[nextCue++]!, final, reduced);
      },
      finish: () => {
        this.host.castCard?.(null);
        presentPublicRitual(null);
        this.host.enemyAction?.(null);
        this.visual = final;
        this.host.redraw(final);
        this.updateAmbient();
      },
      cancel: () => {},
    });
  }
  tick(ms: number): void {
    // Advance existing effects first so a newly emitted cue starts at its own t=0.
    this.effects.tick(ms);
    this.queue.tick(ms);
    if (this.reportedBusy && !this.busy) {
      this.reportedBusy = false;
      for (const unit of this.visual?.units ?? []) this.host.unit(unit.id)?.setFacingLock(false);
      this.host.busy(false);
      if (this.visual) this.host.redraw(this.visual);
    }
  }
  /** Private visual fixture on the SAME queue. No damage, commands or content definitions. */
  previewArcherShot(sourceId: string, targetId: string, reduced: boolean): boolean {
    const source=this.host.unit(sourceId), target=this.host.unit(targetId);
    const from=this.position(sourceId), to=this.position(targetId);
    if(this.busy||source?.defId!==ARCHER_VISUAL_ID||!target||!from||!to)return false;
    if(['hit','death'].includes(source.animationSnapshot()?.motion??''))return false;
    const timing=archerShotTiming(reduced);
    let released=false, impacted=false;
    this.queue.enqueue({
      duration:timing.release+timing.travel+timing.recovery,
      begin:()=>{
        this.host.busy(true);this.reportedBusy=true;
        source.faceTarget(from,to,true);source.setFacingLock(true);
        target.faceTarget(to,from,true);
        source.playAnimation('attack',timing.release);
      },
      update:elapsed=>{
        if(!released&&elapsed>=timing.release){
          released=true;
          const body=source.body;
          let origin: {x:number;y:number}|undefined;
          if(body instanceof PaintedFigure && source.root.parent){
            const view=cardinalView(source.directionalFacing);
            // Director cues precede UnitView.tick: show release NOW, before the projectile.
            body.setAnimationFrame('attack',ARCHER_RELEASE_FRAME);
            const grip=ARCHER_RELEASE_POINTS[view];
            const p=body.imagePoint(grip.x,grip.y);
            origin=source.root.parent.toLocal(body.toGlobal(p));
          }
          this.effects.physicalArrow(from,to,timing.travel,origin);
        }
        if(!impacted&&elapsed>=timing.release+timing.travel){
          impacted=true;this.effects.physicalArrowImpact(to);target.playAnimation('hit');
        }
      },
      finish:()=>{source.setFacingLock(false);source.playAnimation('idle');},
      cancel:()=>{source.setFacingLock(false);},
    });
    return true;
  }
  /** Archer cast beat: reads the shot's context once (visual state, same rules as the engine). */
  private archerShot: { cardId: string; perfect: boolean; passAt?: Pos } | null = null;
  private archerCast(e: EventOfType<'CARD_PLAYED'>, from: Pos, duration: number): void {
    const fx = this.effects, units = this.visual?.units ?? [];
    const at = (p: Pos | null) => (p ? units.find((u) => u.pos.x === p.x && u.pos.y === p.y) : undefined);
    const target = at(e.target);
    const d = target ? Math.abs(target.pos.x - from.x) + Math.abs(target.pos.y - from.y) : 0;
    const perfect = e.cardId === 'heart_shot' && !!target &&
      target.statuses.some((s) => s.id === 'PREY' && s.sourceId === e.casterId) &&
      d >= ARCHER_OPTIMAL_RANGE.min && d <= ARCHER_OPTIMAL_RANGE.max;
    // Flecha Perforante: two units on the traced line = the shot went through the first one.
    const onLine = e.cardId === 'piercing_arrow'
      ? units.filter((u) => u.id !== e.casterId && e.affectedTiles.some((t) => t.x === u.pos.x && t.y === u.pos.y))
          .sort((a, b) => Math.abs(a.pos.x - from.x) + Math.abs(a.pos.y - from.y) - (Math.abs(b.pos.x - from.x) + Math.abs(b.pos.y - from.y)))
      : [];
    this.archerShot = { cardId: e.cardId, perfect, ...(onLine.length >= 2 ? { passAt: onLine[0]!.pos } : {}) };
    if (perfect && target) {
      fx.focusCharge(from, duration);
      fx.aimLine(from, target.pos, duration + 220);
      fx.huntReticle(target.pos, true);
    } else if (e.cardId === 'hunters_eye' && target) fx.aimLine(from, target.pos, duration + 120);
  }

  clear(): void {
    this.host.castCard?.(null);
    presentPublicRitual(null);
    this.host.enemyAction?.(null);
    this.catalogActions = new WeakMap();
    this.attackFamilies = new WeakMap();
    this.queue.clear();
    this.effects.clear();
    for (const unit of this.visual?.units ?? []) this.host.unit(unit.id)?.snapHealth?.();
    this.moving.clear();
    this.hitCancels.clear();
    this.visual = null;
    this.accepted = null;
    this.reportedBusy = false;
    this.host.busy(false);
  }
  destroy(): void {
    this.clear();
    this.effects.destroy();
  }

  private position(id: string): Pos | undefined {
    return this.visual?.units.find((u) => u.id === id)?.pos;
  }
  private commit(event: GameEvent, final: Readonly<GameState>): void {
    if (!this.visual) return;
    this.visual = projectEvent(this.visual, event, final);
    this.host.redraw(this.visual);
    this.host.presentEvent?.(event);
    this.updateAmbient();
  }

  private play(cue: VisualCue, final: Readonly<GameState>, reduced: boolean): void {
    const e = cue.event,
      fx = this.effects,
      f = family(cue.key);
    if (cue.kind === 'commit') {
      this.commit(e, final);
      return;
    }
    if (cue.kind === 'reactionPrepare' && e.type === 'COUNTER_ATTACK') {
      const unit = this.host.unit(e.unitId), from = this.position(e.unitId), target = this.position(e.targetId);
      if (unit && from && target) {
        unit.faceTarget(from, target, true);
        unit.setFacingLock(true);
        unit.anticipate(cue.duration);
      }
      return;
    }
    if (cue.kind === 'attackImpact') {
      if (e.type === 'COUNTER_ATTACK') {
        const from = this.position(e.unitId), target = this.position(e.targetId);
        if (from && target) {
          if(!fx.catalog?.contact?.(this.attackFamilies.get(e)??'tactic',from,target)){fx.streak(from,target);fx.martialPulse(target,'counter');}
        }
      } else if (e.type === 'ENEMY_ATTACKED') {
        const veil=this.host.unit(e.enemyId)?.defId;
        if(veil==='veil_guardian'||veil==='veil_beast'||veil==='veil_stalker') {
          fx.veilImpact(e.tiles,veil!=='veil_guardian');
          this.host.impulse(veil==='veil_beast'?'MEDIUM':'LIGHT',reduced);
          return;
        }
        if (this.host.unit(e.enemyId)?.defId === 'forge_king' && e.tiles.length)
          fx.burst(e.tiles[Math.floor(e.tiles.length / 2)]!, 'FIRE', true, reduced ? 80 : 240);
        const from=this.position(e.enemyId);
        if(!from||!fx.catalog?.area?.(confirmedAttackFamily([e],e),from,e.tiles))fx.area(e.tiles, family(e.damageType), reduced ? 80 : 200);
        this.host.impulse('LIGHT', reduced);
      } else if(e.type==='SUMMON_ATTACKED') {
        this.host.unit(e.unitId)?.contactImpact(0);
        if(!fx.catalog?.contact?.(this.attackFamilies.get(e)??'tactic',e.from,e.to)) {
          const id=this.host.unit(e.unitId)?.defId;
          if(id==='primordial_dragon')fx.primordialBite(e.from,e.to);
          else if(id==='ash_hound')fx.ashBite(e.from,e.to);
          else fx.area([e.to],e.ranged?'ARCANE':'FORCE',120);
        }
      } else if(e.type==='SUMMON_BREATH')fx.catalog?.area?.(this.attackFamilies.get(e)??'tactic',e.from,e.tiles);
      return;
    }
    if (cue.kind === 'ritualCircle' && e.type === 'RITUAL_ACTIVATED') {
      fx.ritual(e.impact, e.tier);
      fx.charge(e.impact, 'ARCANE', cue.duration);
      return;
    }
    if (cue.kind === 'cast' && e.type === 'CARD_PLAYED') {
      this.host.castCard?.(e);
      const from = this.position(e.casterId) ?? e.impact;
      const caster = this.host.unit(e.casterId);
      if (caster && hasDirectionalArt(caster.defId)) {
        caster.faceTarget(from, e.target ?? e.impact, true);
        caster.setFacingLock(true);
      } else if (e.target) caster?.faceHorizontal(e.target.x - from.x);
      this.host.unit(e.casterId)?.anticipate(cue.duration);
      const martial = !!caster && hasMartialAnimation(caster.defId);
      const hint = this.host.card(e.cardId)?.presentation.castAnimation;
      const motion = martial
        ? ['shield_bash', 'brutal_shove', 'grapple'].includes(e.cardId)
          ? 'bash'
          : hint === 'charge'
            ? 'charge'
            : hint === 'guard'
              ? 'guard'
              : hint === 'ability'
                ? 'ability'
                : 'attack'
        : 'cast';
      caster?.playAnimation(motion, cue.duration);
      if(cue.key==='magma_fissure')fx.magmaFissure(e.affectedTiles,'windup');
      if(cue.key==='forbidden_bond')fx.forbiddenBond(from,'gather',cue.duration);
      this.host.unit(e.casterId)?.pulseLight(lightColor(f), reduced ? 140 : 220);
      const catalog=this.catalogActions.get(e);
      if(fx.catalog?.handles?.(catalog)) {
        fx.catalog.charge(catalog,from,cue.duration,caster?.castOrigin()??undefined,e.impact,e.affectedTiles);
        if(catalog.style==='volley')fx.catalog.volley(catalog,e.affectedTiles,cue.duration);
        return;
      }
      if (caster?.defId === ARCHER_VISUAL_ID) {
        this.archerCast(e, from, cue.duration);
        return;
      }
      if (mageRecipeEnabled(cue.key) && fx.mage?.handles(cue.key)) {
        fx.mage.reduced = reduced;
        fx.mage.charge(cue.key, from, cue.duration, caster?.castOrigin() ?? undefined);
        return;
      }
      if (cue.key === 'bastion_blow' && fx.bastion?.ready) {
        fx.bastion.reduced = reduced;
        fx.bastion.anticipate(from, e.impact, cue.duration);
        return;
      }
      if (cue.key === 'summon_pact_golem' && fx.pactSummon?.ready) {
        fx.pactSummon.reduced = reduced;
        fx.pactSummon.prepareCircle(e.impact, cue.duration + (reduced ? 40 : 150));
        return;
      }
      if (martial) {
        if (hint === 'guard') fx.martialGuard(from, shieldSide(caster!.directionalFacing));
        else
          fx.martialPulse(
            from,
            hint === 'ability' ? 'recovery' : hint === 'charge' ? 'spend' : 'impact',
            !!e.empowered,
          );
      } else {
        if (cue.key === 'fireball' && fx.fireball?.ready) {
          fx.fireball.reduced = reduced;
          fx.fireball.charge(from, cue.duration, caster?.castOrigin() ?? undefined);
          return;
        }
        fx.charge(from, f, cue.duration);
        fx.glyph(from, f, Math.max(120, cue.duration), 24);
      }
      if (cue.key === 'phase_step') {
        this.phase(e.casterId, reduced);
        fx.streak(from, from); // Stationary energy: Phase Step grants MP, never a teleport.
      }
      return;
    }
    if (cue.kind === 'projectile') {
      if (e.type === 'ARROW_REBOUNDED') {
        if (e.element === 'THUNDER' && fx.catalog) fx.catalog.projectile({...familyRecipe('arcane','projectile'),mageElement:'thunder',bank:'mage-elements',tint:0xa5dfff},e.fromPos,e.pos,cue.duration);
        else fx.specialArrow(e.fromPos, e.pos, 'rebound_arrow', cue.duration);
        return;
      }
      // Snap the gesture to its release beat before emitting the existing projectile.
      const casterId =
        e.type === 'PROJECTILE_LAUNCHED'
          ? e.sourceId
          : e.type === 'CARD_PLAYED'
            ? e.casterId
            : null;
      const caster = casterId ? this.host.unit(casterId) : undefined;
      if (caster?.defId === ARCHER_VISUAL_ID && isArrowVisual(cue.key)) {
        // Archer: bow release frame + physical shaft from the measured grip (no magic trail).
        const from = e.type === 'PROJECTILE_LAUNCHED' ? e.from : (this.position(casterId!) ?? null);
        const to = e.type === 'PROJECTILE_LAUNCHED' ? e.to : e.type === 'CARD_PLAYED' ? e.impact : null;
        let origin: { x: number; y: number } | undefined;
        if (caster.body instanceof PaintedFigure && caster.root.parent) {
          caster.body.setAnimationFrame('attack', ARCHER_RELEASE_FRAME);
          const grip = ARCHER_RELEASE_POINTS[cardinalView(caster.directionalFacing)];
          origin = caster.root.parent.toLocal(caster.body.toGlobal(caster.body.imagePoint(grip.x, grip.y)));
        }
        const shot = this.archerShot, duration = Math.max(1, cue.duration);
        if (from && to) {
          if (specialArrow(cue.key)) fx.specialArrow(from, to, cue.key, duration, origin);
          else if (shot?.passAt) fx.trailedArrow(from, to, duration, origin, shot.passAt);
          else if (shot?.perfect) fx.trailedArrow(from, to, duration, origin, undefined, true);
          else fx.physicalArrow(from, to, duration, origin);
        }
        return;
      }
      caster?.releaseCast();
      const origin = caster?.castOrigin() ?? undefined;
      const catalog=this.catalogActions.get(e);
      if(fx.catalog?.handles?.(catalog)) {
        const from=e.type==='PROJECTILE_LAUNCHED'?e.from:e.type==='CARD_PLAYED'?this.position(e.casterId):null;
        const to=e.type==='PROJECTILE_LAUNCHED'?e.to:e.type==='CARD_PLAYED'?e.impact:null;
        if(from&&to)fx.catalog.projectile(catalog,from,to,Math.max(1,cue.duration),origin);
        return;
      }
      if (cue.key === 'magic_missile' && fx.mage?.handles(cue.key)) {
        const from = e.type === 'CARD_PLAYED' ? this.position(e.casterId) : e.type === 'PROJECTILE_LAUNCHED' ? e.from : null;
        const to = e.type === 'CARD_PLAYED' ? e.impact : e.type === 'PROJECTILE_LAUNCHED' ? e.to : null;
        if (from && to) fx.mage.projectile(from, to, Math.max(1, cue.duration), origin);
        return;
      }
      if (cue.key === 'fireball' && fx.fireball?.ready) {
        const from = e.type === 'PROJECTILE_LAUNCHED' ? e.from : e.type === 'CARD_PLAYED' ? (this.position(e.casterId) ?? e.impact) : null;
        const to = e.type === 'PROJECTILE_LAUNCHED' ? e.to : e.type === 'CARD_PLAYED' ? e.impact : null;
        if (from && to) fx.fireball.projectile(from, to, Math.max(1, cue.duration), origin);
        return;
      }
      if (e.type === 'PROJECTILE_LAUNCHED')
        fx.projectile(e.from, e.to, f, Math.max(1, cue.duration), origin);
      else if (e.type === 'CARD_PLAYED')
        fx.projectile(
          this.position(e.casterId) ?? e.impact,
          e.impact,
          f,
          Math.max(1, cue.duration),
          origin,
        );
      return;
    }
    if (cue.kind === 'spellImpact' && e.type === 'CARD_PLAYED') {
      const caster = this.host.unit(e.casterId);
      const catalog=this.catalogActions.get(e);
      if(fx.catalog?.handles?.(catalog)) {
        if(cue.key==='magma_fissure')fx.magmaFissure(e.affectedTiles,'impact');
        fx.catalog.impact(catalog,this.position(e.casterId)??e.impact,e.impact,e.affectedTiles);
        if (catalog.bank === 'thunder-premium') this.host.impulse(cue.key === 'tempest_judgment' ? 'MEDIUM' : 'LIGHT', reduced);
        return;
      }
      if (isArrowVisual(cue.key) && caster?.defId === ARCHER_VISUAL_ID) {
        if (specialArrow(cue.key)) fx.specialArrowImpact(e.impact, cue.key, e.affectedTiles);
        else if (e.cardId === 'heart_shot') {
          const perfect = !!this.archerShot?.perfect;
          fx.heartImpact(e.impact, perfect);
          this.host.impulse(perfect ? 'MEDIUM' : 'LIGHT', reduced);
        } else fx.physicalArrowImpact(e.impact);
        return;
      }
      if (cue.key==='silence_seal'||cue.key==='alpha_instinct'||cue.key==='guard_breaker') {
        fx.arsenalShowcase(e.impact,cue.key);
        return;
      }
      if(cue.key==='arcane_chain') {fx.tacticalBond(this.position(e.casterId)??e.impact,e.impact,false);fx.glyph(e.impact,'ICE',reduced?90:220,22);return;}
      if(cue.key==='forbidden_bond') {fx.ritual(e.impact,'MAJOR','seal');return;} // The sacrifice and the seal follow their own events.
      if(cue.key==='pack_call'||cue.key==='bond_sacrifice') {fx.glyph(e.impact,'ARCANE',reduced?90:220,26);return;}
      if(cue.key==='mirror_step') {fx.glyph(this.position(e.casterId)??e.impact,'ICE',reduced?90:220,22);return;}
      if(cue.key==='smoke_bomb') {fx.area(e.affectedTiles,'FORCE',reduced?90:220,e.impact);return;}
      if(cue.key==='grappling_hook') {fx.streak(this.position(e.casterId)??e.impact,e.impact);return;}
      if(cue.key==='field_ration') {fx.glyph(e.impact,'BARRIER',reduced?90:180,16);return;}
      if(cue.key==='binder_strike') {
        const companion=bondCompanion(this.visual?.units??[],e.casterId,e.impact);
        fx.tacticalBond(companion?.pos??this.position(e.casterId)??e.impact,e.impact,!!companion);
        return;
      }
      if(cue.key==='binding_ward'||cue.key==='mark_prey')return; // Authoritative shield/status event supplies the cue.
      if (cue.key === 'bastion_blow' && fx.bastion?.ready) {
        caster?.contactImpact(0);
        fx.bastion.impact(this.position(e.casterId) ?? e.impact, e.impact);
        this.host.impulse('LIGHT', reduced);
        return;
      }
      if (cue.key === 'summon_pact_golem' && fx.pactSummon?.ready) return;
      if (caster && hasMartialAnimation(caster.defId)) {
        const hint = this.host.card(e.cardId)?.presentation.castAnimation;
        if (hint === 'charge') return; // Contact follows UNIT_MOVED, never the anticipation beat.

        if(e.cardId==='forge_strike'){fx.burst(e.impact,'FIRE',!!e.empowered,reduced?80:160);fx.glyph(e.impact,'FORCE',reduced?80:180,e.empowered?27:21);}
        if (hint === 'guard') fx.martialGuard(e.impact, shieldSide(caster.directionalFacing));
        else if (hint === 'ability') fx.martialPulse(e.impact, 'recovery', !!e.empowered);
        else {
          for (const pos of e.affectedTiles.length ? e.affectedTiles : [e.impact])
            fx.martialPulse(pos, 'impact', !!e.empowered);
          if (e.cardId === 'sweep') fx.sweepArc(this.position(e.casterId) ?? e.impact);
          this.host.impulse(e.empowered ? 'MEDIUM' : 'LIGHT', reduced);
        }
        return;
      }
      if (mageRecipeEnabled(cue.key) && fx.mage?.handles(cue.key)) {
        fx.mage.impact(cue.key, e.impact, e.affectedTiles);
        this.host.impulse('LIGHT', reduced);
        return;
      }
      if (cue.key === 'fireball' && fx.fireball?.ready) {
        fx.fireball.impact(e.impact);
        this.host.impulse('MEDIUM', reduced);
        const affected = e.affectedTiles.length ? e.affectedTiles : [e.impact];
        for (const unit of this.visual?.units ?? [])
          if (affected.some(p => p.x === unit.pos.x && p.y === unit.pos.y))
            this.host.unit(unit.id)?.pulseLight(lightColor(f), reduced ? 100 : 170);
        return;
      }
      fx.light(e.impact, f);
      const affected = e.affectedTiles.length ? e.affectedTiles : [e.impact];
      for (const unit of this.visual?.units ?? [])
        if (affected.some((tile) => tile.x === unit.pos.x && tile.y === unit.pos.y))
          this.host.unit(unit.id)?.pulseLight(lightColor(f), reduced ? 100 : 170);
      if (cue.key.startsWith('summon_')) {
        fx.glyph(e.impact, 'ARCANE', reduced ? 160 : 340, 32);
        fx.sparksAt(fx.center(e.impact).x, fx.center(e.impact).y, 'ARCANE', reduced ? 2 : 8, 18);
      }
      switch (cue.key) {
        case 'magma_fissure':
          fx.magmaFissure(e.affectedTiles,'impact');
          break;
        case 'fireball':
          fx.burst(e.impact, 'FIRE', true);
          this.host.impulse('MEDIUM', reduced);
          break;
        case 'magic_missile':
          fx.burst(e.impact, 'ARCANE', false, 130);
          this.host.impulse('LIGHT', reduced);
          break;
        case 'arcane_burst':
          fx.glyph(e.impact, 'ARCANE');
          fx.area(e.affectedTiles, 'ARCANE', 260, e.impact);
          break;
        case 'frost_nova':
          fx.glyph(e.impact, 'ICE', 260, 34);
          fx.area(e.affectedTiles, 'ICE', 260);
          break;
        case 'barrier':
          fx.glyph(e.impact, 'BARRIER', reduced ? 120 : 380, 30);
          fx.charge(e.impact, 'BARRIER', reduced ? 100 : 280);
          break;
        case 'ice_wall':
        case 'glacial_field':
          fx.area(affected, 'ICE', reduced ? 120 : 420);
          fx.glyph(e.impact, 'ICE', reduced ? 120 : 420, 32);
          break;
        case 'force_push':
          fx.area(affected, 'FORCE', reduced ? 100 : 300, e.impact);
          fx.burst(e.impact, 'FORCE');
          break;
        case 'dispel':
          fx.glyph(e.impact, 'ARCANE');
          fx.area(e.affectedTiles, 'ARCANE', 200);
          break;
        case 'arcane_surge':
          fx.glyph(e.impact, 'ARCANE', 280);
          break;
        case 'phase_step':
          fx.glyph(e.impact, 'ARCANE', 200, 21);
          break;
      }
      return;
    }
    if (cue.kind === 'move') {
      if (e.type === 'UNIT_MOVED' && (cue.key === 'stalker_step' || cue.key === 'tactical_retreat'))
        fx.stalkerTrail(e.path, cue.key === 'tactical_retreat');
      if (e.type === 'UNIT_MOVED') this.host.walk(e, reduced);
      else if (e.type === 'UNIT_TELEPORTED' || e.type === 'UNIT_PUSHED')
        this.move(e, cue.duration, reduced);
      return;
    }
    if (cue.kind !== 'event') return;
    if (e.type === 'CARD_RESOLVED') this.host.castCard?.(null);
    const oldPosition = 'unitId' in e ? this.position(e.unitId) : undefined;
    let deferCommit = false;
    // Read the pre-event position for removals / shield responses before projection commits.
    switch (e.type) {
      case 'GLYPH_ACTIVATED': {
        const recipe=this.catalogActions.get(e);
        if(recipe&&fx.catalog?.handles?.(recipe))for(const target of e.targets)fx.catalog.projectile(recipe,e.origin,target.pos,reduced?60:180);
        break;
      }
      case 'ARROW_REBOUNDED':
        if (e.element === 'THUNDER') fx.catalog?.impact({...familyRecipe('arcane'),mageElement:'thunder',bank:'mage-elements',tint:0xa5dfff},e.fromPos,e.pos,[e.pos]);
        else fx.specialArrowImpact(e.pos, 'rebound_arrow');
        break;
      case 'ENEMY_ACTION_ENDED':
        this.host.enemyAction?.(null);
        break;
      case 'ENEMY_ACTION_STARTED': {
        this.host.enemyAction?.(e);
        const enemy = this.host.unit(e.enemyId),
          intent = e.intent,
          from = this.position(e.enemyId);
        if (from) {
          if ('targetUnitId' in intent) {
            const target = this.position(intent.targetUnitId);
            if (target) enemy?.faceTarget(from,target,true);
          } else if ('center' in intent) enemy?.faceTarget(from,intent.center,true);
          else if ('direction' in intent) {
            if (intent.direction === 'RIGHT') enemy?.faceHorizontal(1);
            else if (intent.direction === 'LEFT') enemy?.faceHorizontal(-1);
          }
        }
        if(from && enemy?.defId==='ash_shaman')fx.charge(from,'FIRE',reduced?30:120);
        if(from && enemy?.defId==='veil_guardian')fx.glyph(from,'ARCANE',reduced?50:150,27);
        if (intent.kind === 'AREA_SPELL') {
          enemy?.playAnimation('cast', reduced ? 20 : 70);
          const family=this.attackFamilies.get(e),recipe=family&&familyRecipe(family,'area');
          if(from&&recipe&&fx.catalog?.handles?.(recipe))fx.catalog.charge(recipe,from,reduced?20:70,enemy?.castOrigin()??undefined);
        }
        break;
      }
      case 'TURN_STARTED':
        fx.catalog?.advanceRound?.(e.round);
        this.host.turnBanner(e.faction, e.round);
        break;
      case 'BACKSTAB':
        fx.backstab(e.pos);
        break;
      case 'UNIT_DAMAGED': {
        const catalog=this.catalogActions.get(e);
        if(catalog?.contactOnDamage)fx.catalog?.contact?.(catalog.family,this.position(e.sourceId)??e.pos,e.pos);
        const thunder = (catalog?.bank === 'thunder-premium' || catalog?.variant === 'paralyzing_pulse') && !!fx.catalog?.handles?.(catalog);
        if (thunder && (e.hpLost > 0 || e.shieldAbsorbed > 0 || e.armorMitigated > 0)) fx.catalog?.thunderTarget(catalog!, e.pos);
        const reaction = damageReaction(e), universal = universalReactionsEnabled();
        if(e.damageType==='PHYSICAL' && (e.hpLost || e.shieldAbsorbed))this.host.groundImpact?.(e.unitId,e.pos,e.hpLost>=3);
        const source = this.host.unit(e.sourceId),
          martial = !!source && hasMartialAnimation(source.defId);
        if (martial && e.damageType === 'PHYSICAL') {
          if (this.host.card(cue.key)?.presentation.castAnimation === 'charge') {
            fx.martialPulse(e.pos, 'impact', e.hpLost >= 3);
            this.host.impulse('LIGHT', reduced);
          }
          if (!reduced && source!.contactImpact(24)) this.host.unit(e.unitId)?.holdAnimation(24);
        }
        if (e.hpLost) {
          this.host.unit(e.unitId)?.animateHealthChange?.();
          fx.number(e.unitId, e.pos, e.hpLost, 'damage');
          if (!universal && cue.key === 'fireball' && e.damageType === 'FIRE' && fx.fireball?.ready)
            fx.fireball.reaction?.(e.unitId, () => this.position(e.unitId));
        }
        if (e.shieldAbsorbed) {
          fx.number(e.unitId, e.pos, e.shieldAbsorbed, 'shield');
          const defender = this.host.unit(e.unitId);
          if (defender && hasMartialAnimation(defender.defId))
            fx.martialGuard(e.pos, shieldSide(defender.directionalFacing), true);
          else fx.shell(e.pos);
        }
        if (!e.hpLost && !e.shieldAbsorbed && e.armorMitigated)
          fx.number(e.unitId, e.pos, e.armorMitigated, 'armor');
        if (universal) fx.unitReaction?.(e.unitId, () => this.position(e.unitId), reaction);
        else fx.sparksAt(fx.lift(e.pos, .45).x, fx.lift(e.pos, .45).y, family(e.damageType), reduced ? 1 : 5, 24);
        if (e.hpLost) this.hit(e.unitId, e.sourceId, reduced, thunder ? 0xb3eaff : universal ? REACTION_COLOR[reaction] : 0xffc3aa);
        const defender = this.host.unit(e.unitId);
        if (reaction !== 'none') defender?.playAnimation(!e.hpLost ? 'block' : 'hit');
        if (reaction !== 'none') defender?.pulseLight(thunder && e.hpLost > 0 ? 0xb3eaff : universal ? REACTION_COLOR[reaction] : e.hpLost && e.damageType === 'FIRE' ? 0xff6045 : lightColor(family(e.damageType)), reduced ? 90 : 150);
        break;
      }
      case 'UNIT_DEFEATED': {
        fx.clearUnitReaction?.(e.unitId);
        fx.fireball?.clearReaction?.(e.unitId);
        this.hitCancels.get(e.unitId)?.();
        this.hitCancels.delete(e.unitId);
        const defeated = this.host.unit(e.unitId);
        if(this.catalogActions.get(e)?.recall && oldPosition && fx.catalog?.pulse?.('summon',oldPosition)) {
          defeated?.playAnimation('idle');
          if(defeated&&!reduced){const alpha=defeated.root.alpha;fx.animate(cue.duration||600,t=>{if(!defeated.root.destroyed)defeated.root.alpha=alpha*(1-t);},()=>{if(!defeated.root.destroyed)defeated.root.alpha=alpha;});}
        } else defeated?.playAnimation('death', cue.duration || 600);
        if (defeated?.defId === 'temple_guardian' && oldPosition) this.host.groundImpact?.(e.unitId, oldPosition, true);
        deferCommit = true;
        break;
      }
      case 'HP_SACRIFICED':
        this.host.unit(e.unitId)?.animateHealthChange?.();
        if (oldPosition) {
          fx.forbiddenBond(oldPosition, 'sacrifice');
          fx.number(e.unitId, oldPosition, e.amount, 'damage');
          this.host.unit(e.unitId)?.pulseLight(0xff3d6e, reduced ? 90 : 220);
        }
        break;
      case 'SUMMON_CAPACITY_CHANGED':
        if (oldPosition) {
          fx.forbiddenBond(oldPosition, 'seal');
          this.host.unit(e.unitId)?.pulseLight(0x9a72ff, reduced ? 90 : 260);
        }
        break;
      case 'FORM_CHANGED':
        if(oldPosition&&!fx.catalog?.arrival?.(oldPosition,true)){fx.glyph(oldPosition,'ARCANE',reduced?100:300,28);fx.charge(oldPosition,'ARCANE',reduced?100:300);}
        break;
      case 'FORM_TRIGGER':
      case 'SUMMON_ORDERED':
      case 'COST_DISCOUNT_GRANTED':
      case 'DEATH_PREVENTED':
        if(oldPosition)fx.catalog?.pulse?.(e.type==='DEATH_PREVENTED'?'defense':'tactic',oldPosition);
        break;
      case 'SHIELD_SHATTERED':
        if(oldPosition){fx.shell(oldPosition,true);fx.catalog?.pulse?.('defense',oldPosition);}
        break;
      case 'UNIT_HEALED':
        if (e.amount > 0) {
          this.host.unit(e.unitId)?.animateHealthChange?.();
          if (universalReactionsEnabled()) {
            this.hitCancels.get(e.unitId)?.(); this.hitCancels.delete(e.unitId);
            fx.unitReaction?.(e.unitId, () => this.position(e.unitId), 'heal');
            this.host.unit(e.unitId)?.pulseLight(REACTION_COLOR.heal, reduced ? 90 : 180);
          } else if (oldPosition && hasMartialAnimation(this.host.unit(e.unitId)?.defId ?? '')) fx.martialPulse(oldPosition, 'recovery');
          if (oldPosition) fx.number(e.unitId, oldPosition, e.amount, 'heal');
        }
        break;
      case 'SHIELD_GAINED':
        if (oldPosition) {
          const unit = this.host.unit(e.unitId);
          if(cue.key==='binding_ward')fx.bindingWard(oldPosition,e.amount>=5);
          else if (
            unit &&
            (hasMartialAnimation(unit.defId) ||
              hasMartialAnimation(this.host.unit(e.sourceId)?.defId ?? ''))
          )
            fx.martialGuard(oldPosition, shieldSide(unit.directionalFacing));
          else if(cue.key==='ritual:ancestral_shell')fx.ritual(oldPosition,'MINOR','arrival');
          else {
            fx.glyph(oldPosition, 'BARRIER');
            fx.shell(oldPosition);
          }
          fx.number(e.unitId, oldPosition, e.amount, 'shield');
        }
        break;
      case 'SHIELD_BROKEN':
      case 'SHIELD_EXPIRED':
        if (oldPosition) {
          const unit = this.host.unit(e.unitId);
          if (unit && hasMartialAnimation(unit.defId))
            fx.martialGuard(oldPosition, shieldSide(unit.directionalFacing), true);
          else fx.shell(oldPosition, true);
        }
        break;
      case 'MOMENTUM_CHANGED':
        if (oldPosition)
          fx.martialPulse(oldPosition, e.reason === 'SPENT' ? 'spend' : 'momentum', e.to === e.max);
        break;
      case 'FINISHER_TRIGGERED':
        if (oldPosition) fx.finisher(oldPosition);
        if (!reduced) this.host.unit(e.casterId)?.contactImpact(32);
        this.host.impulse('MEDIUM', reduced);
        break;
      case 'COUNTER_ATTACK': {
        const unit = this.host.unit(e.unitId),
          target = this.position(e.targetId);
        if (unit && oldPosition && target) {
          unit.faceTarget(oldPosition, target, true);
          unit.playAnimation('attack', cue.duration);
        }
        break;
      }
      case 'STATUS_APPLIED':
        if(cue.key==='paralyzing_pulse'&&e.status==='SLOWED'&&oldPosition){
          const recipe=this.catalogActions.get(e);
          if(recipe&&fx.catalog?.handles?.(recipe)){fx.catalog.pulseStatus(recipe,oldPosition,e.turnsLeft);break;}
        }
        if(oldPosition&&!['UNLEASHED_HUNT','HUNT_PURSUIT','MARKED_PREY','PREY'].includes(e.status))fx.catalog?.pulse?.('tactic',oldPosition);
        if(e.status==='UNLEASHED_HUNT'&&oldPosition){fx.unleashedHunt(oldPosition);if(!reduced)this.host.unit(e.unitId)?.pulseLight(0xc296ed,200);}
        if(e.status==='HUNT_PURSUIT'&&oldPosition){fx.unleashedHunt(oldPosition,true);if(!reduced)this.host.unit(e.unitId)?.pulseLight(0xdc94bc,120);}
        if(e.status==='MARKED_PREY'&&oldPosition)fx.preyCue(oldPosition);
        if(e.status==='PREY'&&oldPosition)fx.huntReticle(oldPosition);
        break;
      case 'FOCUS_CHANGED':
        if (oldPosition) fx.focusTick(oldPosition, e.reason !== 'SPENT', e.to === e.max);
        break;
      case 'TRAP_PLACED':
        if(e.kind==='lightning_wall') { const recipe=this.catalogActions.get(e);if(recipe&&fx.catalog?.handles?.(recipe))fx.catalog.impact(recipe,e.pos,e.pos,[e.pos]); }
        else fx.trapSet(e.pos);
        break;
      case 'TRAP_TRIGGERED':
        if(e.kind==='lightning_wall') { const recipe=this.catalogActions.get(e);if(recipe&&fx.catalog?.handles?.(recipe))fx.catalog.impact(recipe,e.pos,e.pos,[e.pos]); }
        else fx.trapSprung(e.pos);
        this.host.impulse('LIGHT', reduced);
        break;
      case 'STATUS_REMOVED':
        if (
          e.reason === 'CLEANSED' &&
          oldPosition &&
          hasMartialAnimation(this.host.unit(e.unitId)?.defId ?? '')
        )
          fx.martialPulse(oldPosition, 'recovery', true);
        break;
      case 'TERRAIN_CREATED':
        fx.glyph(e.pos, family(e.terrain));
        fx.burst(e.pos, family(e.terrain));
        break;
      case 'TERRAIN_REMOVED':
        fx.glyph(e.pos, family(e.terrain), 180, 20);
        fx.sparksAt(fx.center(e.pos).x, fx.center(e.pos).y, family(e.terrain), reduced ? 1 : 5, 15);
        break;
      case 'OBSTACLE_REMOVED':
        fx.burst(e.pos, 'ICE');
        break;
      case 'RITUAL_PIECE_COMMITTED':
      case 'RITUAL_PIECE_RELEASED': {
        const pos=this.position(e.casterId);
        if(pos)fx.ritual(pos,'MINOR',e.type==='RITUAL_PIECE_COMMITTED'?'seal':'release');
        break;
      }
      case 'RITUAL_RESOLVED':
        presentPublicRitual(null);
        break;
      case 'RITUAL_ACTIVATED':
        if (e.pieces.length === 4) presentPublicRitual(e);
        else fx.ritual(e.impact,e.tier);
        break;
      case 'UNIT_SPAWNED':
        if (e.kind === 'SUMMON') {
          motionCues.emit('summon_arrival');
          const ritualCreature=final.units.find(u=>u.id===e.unitId)?.defId;
          if(ritualCreature==='primordial_dragon')fx.ritual(e.pos,'LEGENDARY','arrival');
          if(ritualCreature==='ancient_turtle'||ritualCreature==='ancient_wolf')fx.ritual(e.pos,ritualCreature==='ancient_wolf'?'MAJOR':'MINOR','arrival');
          if(final.units.find(u=>u.id===e.unitId)?.defId==='ash_hound'){this.host.unit(e.unitId)?.playAnimation('arrival',90);fx.burst(e.pos,'FIRE',false,reduced?80:220);}
          if (ritualCreature === 'pact_golem' && fx.pactSummon?.ready) fx.pactSummon.arrive(e.pos);
          else if(!fx.catalog?.arrival?.(e.pos)) {
          fx.glyph(e.pos, final.units.find(u=>u.id===e.unitId)?.defId==='war_drake'?'FIRE':'ARCANE', 240);
          fx.burst(e.pos, 'ARCANE');
          }
        }
        break;
      case 'SUMMON_BREATH': {
        const view = this.host.unit(e.unitId);
        view?.faceTarget(e.from, {x:e.from.x+e.direction.x,y:e.from.y+e.direction.y}, true);
        view?.playAnimation('attack', reduced ? 80 : 420);
        view?.pulseLight(0xd69aff, reduced ? 80 : 180);
        fx.primordialBreath(e.from,e.tiles);
        this.host.impulse('LIGHT',reduced);
        break;
      }
      case 'SUMMON_ATTACKED':
        if(attackingMarkedPrey(this.visual?.units??[],e.unitId,e.targetId)){if(!reduced)this.host.unit(e.unitId)?.pulseLight(0xc6a6ef,120);fx.preyCue(e.to);}
        this.host.unit(e.unitId)?.faceTarget(e.from,e.to,true);
        this.host.unit(e.unitId)?.playAnimation('attack', reduced ? 40 : 180);
        if(this.host.unit(e.unitId)?.defId==='war_drake')fx.dragonBreath(e.from,e.to);
        else if(e.ranged) {
          const recipe=familyRecipe(this.attackFamilies.get(e)??'tactic','projectile');
          if(fx.catalog?.handles?.(recipe))fx.catalog.projectile(recipe,e.from,e.to,cue.duration,this.host.unit(e.unitId)?.castOrigin()??undefined);
        }
        break;
      case 'ENEMY_ATTACKED': {
        const attacker = this.host.unit(e.enemyId), from = this.position(e.enemyId);
        const target = this.position(e.targetUnitIds[0] ?? '') ?? e.tiles[0];
        if (attacker && from && target) attacker.faceTarget(from, target, true);
        if (e.intentKind === 'MELEE_ATTACK') attacker?.playAnimation('attack', cue.duration);
        break;
      }
      case 'CARD_DRAWN':
        if (cue.key === 'arcane_surge') {
          const pos = this.visual?.units.find((u) => u.kind === 'HERO')?.pos;
          if (pos) fx.drawCards(pos, 1);
          this.host.handPulse(1);
        }
        break;
      case 'UNIT_PUSHED':
        if (e.collision) {
          fx.martialPulse(e.to, 'impact', true);
          this.host.impulse('MEDIUM', reduced);
        }
        break;
    }
    if (e.type === 'UNIT_TELEPORTED' || e.type === 'UNIT_PUSHED') this.moving.delete(e.unitId);
    if (!deferCommit) this.commit(e, final);
    if(e.type==='FORM_CHANGED') {
      const view=this.host.unit(e.unitId);
      view?.pulseLight(0x97e4d0,reduced?100:260);
      if(view&&!reduced){const alpha=view.root.alpha;fx.animate(260,t=>{if(!view.root.destroyed)view.root.alpha=alpha*(.45+.55*t);},()=>{if(!view.root.destroyed)view.root.alpha=alpha;});}
    }
    if (e.type === 'UNIT_SPAWNED' && e.kind === 'SUMMON') {
      const view = this.host.unit(e.unitId);
      view?.playAnimation('arrival', reduced ? 100 : 240);
      if (view && !reduced) {
        view.root.alpha = 0;
        const duration = 600;
        fx.animate(
          duration,
          (t) => {
            if (!view.root.destroyed) view.root.alpha = Math.min(1, t * 1.2);
          },
          () => {
            if (!view.root.destroyed) view.root.alpha = 1;
          },
        );
      }
    }
    if (e.type === 'OBSTACLE_CREATED') {
      fx.glyph(e.pos, 'ICE', 280);
      const body = this.host.obstacle(e.obstacleId);
      if (body && !reduced) {
        // The obstacle body's origin is its ground anchor: scaling y grows it out of the floor.
        const scale = body.scale.y;
        fx.animate(
          280,
          (t) => {
            if (!body.destroyed) body.scale.y = scale * (0.04 + 0.96 * Math.min(1, t * 1.2));
          },
          () => {
            if (!body.destroyed) body.scale.y = scale;
          },
        );
      }
    }
  }

  private hit(id: string, sourceId: string, reduced: boolean, color = 0xffc3aa): void {
    this.hitCancels.get(id)?.();
    const body = this.host.unit(id)?.body,
      pos = this.position(id),
      source = this.position(sourceId);
    if (!body || !pos) return;
    const x = body.x,
      y = body.y,
      tint = body.tint;
    const angle = source ? Math.atan2(pos.y - source.y, pos.x - source.x) : 0;
    const cancel = this.effects.animate(
      120,
      (t) => {
        if (body.destroyed) return;
        const recoil = reduced ? 0 : Math.sin(t * Math.PI) * 4;
        body.position.set(x + Math.cos(angle) * recoil, y + Math.sin(angle) * recoil);
        body.tint = t < 0.35 && !reduced ? color : tint;
      },
      () => {
        if (!body.destroyed) {
          body.position.set(x, y);
          body.tint = tint;
        }
        this.hitCancels.delete(id);
      },
    );
    this.hitCancels.set(id, cancel);
  }
  private phase(id: string, reduced: boolean): void {
    const body = this.host.unit(id)?.body;
    if (!body) return;
    const alpha = body.alpha;
    this.effects.animate(
      230,
      (t) => {
        if (!body.destroyed) body.alpha = alpha * (reduced ? 1 : 0.5 + Math.abs(t - 0.5));
      },
      () => {
        if (!body.destroyed) body.alpha = alpha;
      },
    );
  }
  private move(
    e: EventOfType<'UNIT_TELEPORTED'> | EventOfType<'UNIT_PUSHED'>,
    duration: number,
    reduced: boolean,
  ): void {
    const view = this.host.unit(e.unitId);
    if (!view) return;
    const root = view.root,
      a = this.effects.center(e.from),
      b = this.effects.center(e.to);
    const alpha = root.alpha,
      sx = root.scale.x,
      sy = root.scale.y;
    const teleport = e.type === 'UNIT_TELEPORTED';
    if (!teleport && hasDirectionalAtlas(view.defId)) view.faceMovement(e.from, e.to);
    this.moving.add(e.unitId);
    if (teleport) {
      this.effects.glyph(e.from, 'ARCANE', 230);
      this.effects.glyph(e.to, 'ARCANE', 300);
    } else this.effects.streak(e.from, e.to);
    this.effects.animate(
      Math.max(1, duration),
      (t) => {
        if (root.destroyed) return;
        if (teleport) {
          root.position.set(t < 0.5 ? a.x : b.x, t < 0.5 ? a.y : b.y);
          root.alpha = reduced ? alpha : alpha * Math.abs(2 * t - 1);
          root.scale.set(sx * (reduced ? 1 : 0.4 + 0.6 * Math.abs(2 * t - 1)), sy);
          if (!reduced && (t < 0.2 || t > 0.8))
            this.effects.sparksAt(root.x, root.y, 'ARCANE', 1, 24);
        } else {
          const eased = 1 - (1 - t) ** 3;
          root.position.set(a.x + (b.x - a.x) * eased, a.y + (b.y - a.y) * eased);
        }
      },
      () => {
        if (!root.destroyed) {
          root.position.set(b.x, b.y);
          root.alpha = alpha;
          root.scale.set(sx, sy);
        }
        this.moving.delete(e.unitId);
      },
    );
  }
}
