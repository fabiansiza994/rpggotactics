import { OpponentNotices, noticeLane, type OpponentNotice, type NoticeLane } from '../mobile/OpponentNotices';
import { mobileCameraTurn } from '../react/mobileCombat';
import { ElementalTargetingPreview } from '../vfx/ElementalTargetingPreview';
import { EnvironmentEffects } from '../vfx/EnvironmentEffects';
import { cornerLight, blendLight } from './localLighting';
import { encounterIdentity } from '../assets/visualIdentity';
import { catalogEventRecipes } from '../vfx/catalogRecipes';
import { mageRecipeEnabled } from '../vfx/mageRecipes';
import { universalReactionsEnabled } from '../vfx/hitReactions';
import { PresentationAssetGate } from '../loading/PresentationAssetGate';
import { sceneAssetIds, sceneAssetKey } from '../loading/sceneAssets';
import { PresentationClock } from '../motion/PresentationClock';
import { loadingMark } from '../performance/marks';
import { presentPublicCast, presentPublicAction } from '../cards/publicCast';
import { Act3Journey, adjacentTempleSegment } from './Act3Journey';
import { presentMechanisms } from '../mechanisms/mechanismPlayback';
import { GUARDIAN_FLOOR, tacticalTileStyle } from './tacticalLayers';
import { mechanismView } from '../../game/domain/mechanisms/mechanism-view';
import { Act3Environment, TEMPLE_PLACES, loadTempleEnvironment, templeSurface } from './Act3Environment';
import { boardActionWins } from './boardInput';
import { FootfallTracker } from '../vfx/FootfallTracker';
import { GroundParticles } from '../vfx/GroundParticles';
import { AIRBORNE_VISUALS, groundMaterial, footfallBudget } from '../vfx/groundFeel';
import { MechanismLayer } from './MechanismLayer';
import { RotatingSections } from './RotatingSections';
import { shapeshifterPresentationEnabled } from '../shapeshifterRelease';
import { gaitGeometry } from '../qa/locomotion/gaitGeometry';
import { characterSpec } from './renderContract';
import { verticalAsset, verticalGeometry } from '../qa/locomotion/directionalProfiles';
import { shapeshifterQaEnabled } from '../qa/shapeshifter/access';
import { formVisual } from '../qa/shapeshifter/visuals';
import { CHARACTER_ANIMATIONS, hasDirectionalAtlas, hasDirectionalArt, INFERNAL_ANIMATION_IDS } from './characterAnimations';
import { resolvedFacingTarget } from './wizardFacing.ts';
import {
  Application,
  Rectangle,
  Container,
  FederatedPointerEvent,
  Graphics,
  PerspectiveMesh,
  RenderTexture,
  Text,
  type TextStyleOptions,
} from 'pixi.js';
import type { GameEvent, GameState, Pos } from '../../game';
import { ElementEffects, type FxGeometry } from '../vfx/ElementEffects';
import { VfxDirector } from '../vfx/VfxDirector';
import { CameraController } from './CameraController';
import { visualSettings } from '../vfx/visualSettings';
import { PALETTE } from './palette';
import type { BoardViewModel } from './viewModel';
import {
  drawObstacle,
  drawObjectiveFocus,
  drawPlatform,
  drawSurface,
  drawSurfaceDetails,
} from './arenaArt';
import { UnitView } from './UnitView';
import { CollectibleView } from './CollectibleView';
import type { CharacterMotion, Facing } from './CharacterAnimator.ts';
import { GridDash } from './GridDash';
import { GridWalk } from './GridWalk';
import { EncounterAmbience } from './EncounterAmbience';
import { loadPaintedCharacters } from './paintedTextures';
import { GridProjection, projectionPreset, type Point } from './GridProjection';
import { OCCLUDING_OBSTACLES, TILE, obstacleSpec, visualHeight } from './renderContract';
import { drawOverlay, drawRanges } from './BoardOverlays';
import { unitVisualId, unitVisualScale, unitVisualTint } from '../assets/visualIdentity';
import { enemyPhase } from '../../game/domain/ai/ai';
import { BattleIntroDirector } from '../motion/BattleIntroDirector';
import { introTimeline, type IntroBeat, type IntroVariant } from '../motion/introTimeline';
import { INTRO, easing } from '../motion/tokens';
import { motionCues } from '../motion/motionCues';

import { fitBattlefield } from '../responsive/battleFit';
import { resolveMouseTarget } from '../input/aim';

export { TILE };
/** Room above the far edge for back-row figures (≈ tallest figure minus half a back row). */
const HEADROOM = TILE * 1.02;
/** Rim + front props beyond the playable surface, in world units. */
const RIM_MARGIN = 44;
const PADDING = 20;
/** Alpha of a tall obstacle while a unit stands right behind it. */
const OCCLUDER_ALPHA = 0.42;

export interface BattleCanvasCallbacks {
  onOpponentNotices?(rows: OpponentNotice[]): void;
  onNoticeLane?(lane: NoticeLane): void;
  onTileHover(pos: Pos | null): void;
  /** Mouse click: acts at once (hover already previewed). */
  onTileClick(pos: Pos): void;
  /** Touch/pen tap: ground tile first, then tiles of unit bodies under the finger (front-most first). */
  onInspectUnit?(positions: readonly Pos[]): boolean;
  onTileTap(candidates: Pos[]): void;
  onCancel(): void;
  onPlaybackChange(busy: boolean): void;
  onHandPulse(count: number): void;
  /** Which intro the next battle start should play (new encounter vs. restart). */
  introVariant(): IntroVariant;
  onIntroBeat(beat: IntroBeat): void;
  onTurnBanner(faction: 'PLAYER' | 'ENEMY', round: number): void;
}

const label = (text: string, style: TextStyleOptions): Text =>
  new Text({ text, style: { fontFamily: 'system-ui, sans-serif', fill: PALETTE.text, ...style } });

function clearLayer(layer: Container): void {
  for (const child of layer.removeChildren()) child.destroy({ children: true });
}

type ObstacleView = { root: Container; body: Container; turns: Text; defId: string };

/**
 * Tactical arena renderer (PixiJS v8). All battlefield geometry comes from one GridProjection.
 *
 * introRoot  (battle intro: the whole battlefield rises from below into place)
 * cameraRoot (CameraController: offset-only shake; HUD/cards are DOM and never inside it)
 *  └ world (uniform scale + translate only; layout)
 *     ├── ambience         edge light pools and motes
 *     ├── platformLayer    platform shadow, supports, fascia, rim, parapet, back corner props
 *     ├── terrainLayer     painted tile surface mapped in perspective, BLOCKED pits, labels
 *     ├── tileLayer        move / target ranges (projected)
 *     ├── overlayLayer     telegraphs, card AoE preview, hover, paths (projected)
 *     ├── groundFxLayer    glyphs, areas, impact light, fire embers (on the surface)
 *     ├── actorLayer       Y-sorted: units, obstacles, front props, afterimages, projectiles
 *     ├── chromeLayer      HP / shield / status / intent plates (always readable)
 *     ├── annotationLayer  predicted results
 *     └── vfxLayer         bursts, numbers, particles
 *
 * Logical state is already final when events arrive and is never changed by playback.
 */
export class BattleCanvas {
  readonly app = new Application();
  private readonly introRoot = new Container();
  private readonly cameraRoot = new Container();
  private readonly camera = new CameraController(this.cameraRoot);
  private readonly world = new Container();
  private readonly platformLayer = new Container();
  private readonly terrainLayer = new Container();
  private readonly terrainPulse = new Container();
  private readonly tacticalLayer = new Container();
  private readonly objectiveLayer = new Container();
  private terrainTime = 0;
  private readonly tileLayer = new Container();
  private readonly overlayLayer = new Container();
  private readonly forgePulse = new Graphics();
  private forgePhaseRound = 0;
  private readonly groundFxLayer = new Container();
  private readonly footfalls = new FootfallTracker();
  private readonly groundParticles = new GroundParticles(this.groundFxLayer);
  private readonly actorLayer = new Container({ sortableChildren: true });
  private readonly templeEnvironment = new Act3Environment(this.actorLayer);
  private templeLoading = false;
  private readonly mechanisms = new MechanismLayer(this.actorLayer, id=>this.units.get(id),(point,reduced)=>{
    if(reduced)return;
    this.groundParticles.emit(point.x,point.y,0,0,this.compactAmbient?4:8,true,false,true);
    this.camera.impulse('LIGHT',false);
  });
  /** Act III phase 3: rotating board sections (plate, telegraph, lift → turn → lock). */
  private readonly sections = new RotatingSections(id=>this.units.get(id)?.root,id=>this.obstacles.get(id)?.root,(points,reduced)=>{
    if(reduced)return;
    for(const p of points)this.groundParticles.emit(p.x,p.y,0,0,this.compactAmbient?2:4,true,false,true);
    this.camera.impulse('LIGHT',false);
  }, id => this.mechanisms.rootFor(id));
  private readonly chromeLayer = new Container();
  private readonly annotationLayer = new Container();
  readonly vfxLayer = new Container();
  /** Projectiles are Y-sorted with the actors they fly past. */
  readonly projectileLayer = this.actorLayer;

  private proj = new GridProjection({
    cols: 7,
    rows: 5,
    tile: TILE,
    ...projectionPreset(1440, 900),
  });
  private surfaceTexture: RenderTexture | null = null;
  private props: Container[] = [];

  private readonly units = new Map<string, UnitView>();
  private readonly dash = new GridDash(this.actorLayer, (p) => this.proj.getUnitAnchor(p), (id,to)=>{
    if(!this.vm?.state.mechanisms || this.effects.reduced)return;
    const view=this.units.get(id);if(!view||AIRBORNE_VISUALS.has(view.defId))return;
    const material=groundMaterial(this.vm.state.board.tiles[to.y*this.boardSize.w+to.x]?.terrain);
    if(!material)return;
    const p=this.proj.getUnitAnchor(to),heavy=view.height>TILE*1.45;
    this.groundParticles.emit(p.x,p.y,0,0,this.compactAmbient?4:8,heavy,material==='frost',heavy);
    if(heavy)this.camera.impulse('LIGHT',false);
  });
  private readonly walk = new GridWalk(
    (p) => this.proj.getUnitAnchor(p),
    (id) => {
      const unit = this.vm?.state.units.find((candidate) => candidate.id === id);
      const delta = unit && this.vm ? this.facingDelta(unit, this.vm.state) : null;
      if (delta !== null && delta !== undefined) {
        const view = this.units.get(id);
        if (view && !(shapeshifterPresentationEnabled ? hasDirectionalArt(view.defId) : hasDirectionalAtlas(view.defId))) view.faceHorizontal(delta);
      }
    },
    shapeshifterPresentationEnabled,

  );
  private readonly obstacles = new Map<string, ObstacleView>();
  /** Keyed `scenario:id` so a new encounter never reuses another's pickup art. */
  private readonly pickups = new Map<string, CollectibleView>();
  private readonly geometry: FxGeometry = {
    center: (p) => this.proj.getUnitAnchor(p),
    footprint: (p) => this.proj.footprint(p),
    quad: (p, inset) => this.proj.getInsetPolygon(p, inset),
    depth: (point) => this.proj.depthAtPoint(point),
  };
  private readonly targetingPreview = new ElementalTargetingPreview(this.geometry);
  private readonly environment = new EnvironmentEffects(this.actorLayer, this.groundFxLayer, this.geometry);
  private readonly ambience = new EncounterAmbience(this.environment);
  private readonly effects = new ElementEffects(
    this.vfxLayer,
    this.actorLayer,
    this.geometry,
    this.groundFxLayer,
  );
  private readonly journey = new Act3Journey(this.introRoot, this.app.stage, value => this.reportPlaybackBusy(value || this.director.busy || this.mechanisms.busy));
  private readonly director: VfxDirector;
  private readonly intro = new BattleIntroDirector((step) => this.callbacks.onIntroBeat(step.beat));
  /** The intro owns the root transform / canvas opacity until it has settled them once. */
  private introSettled = true;
  private readonly portraitQuery = window.matchMedia(
    '(orientation: portrait) and (max-width: 600px)',
  );
  private portraitCamera: { key: string; turn: 0 | 1 | 2 | 3 } | null = null;
  private projectionPending = false;
  private readonly motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  private readonly clock = new PresentationClock();
  private readonly animateWorld = () => {
    this.effects.reduced = visualSettings.reducedEffects || (this.motionQuery?.matches ?? false);
    // Resume a suspended tab without emitting an entire spell's cues in one stale frame.
    const elapsed = this.clock.advance(performance.now()) * visualSettings.timeScale;
    this.terrainTime += elapsed;
    this.templeEnvironment.tick(elapsed, this.effects.reduced);
    this.terrainPulse.alpha = this.effects.reduced
      ? 0.24
      : 0.22 + Math.sin(this.terrainTime / 850) * 0.08;
    this.forgePulse.alpha = this.effects.reduced ? .45 : .4 + Math.sin(this.terrainTime / 260) * .18;
    this.intro.tick(elapsed);
    this.applyIntro();
    this.journey.tick(elapsed, this.effects.reduced, this.app.screen.width);
    this.dash.tick(elapsed);
    this.walk.tick(elapsed);
    this.director.tick(elapsed);
    this.groundParticles.tick(elapsed,this.effects.reduced);
    if (this.projectionPending && !this.director.busy) {
      this.projectionPending = false;
      this.layout();
    }
    this.camera.tick(elapsed);
    const mechanismBusy = this.mechanisms.busy;
    this.mechanisms.tick(elapsed, this.effects.reduced);
    if(mechanismBusy && !this.mechanisms.busy)this.reportPlaybackBusy(this.director.busy || this.sections.busy);
    const sectionBusy = this.sections.busy;
    this.sections.tick(elapsed, this.effects.reduced);
    if(sectionBusy && !this.sections.busy)this.reportPlaybackBusy(this.director.busy || this.mechanisms.busy);
    this.ambience.tick(elapsed, this.effects.reduced, this.compactAmbient);
    this.environment.reduced = this.effects.reduced;
    this.environment.tick(elapsed);
    this.targetingPreview.reduced = this.effects.reduced;
    this.targetingPreview.tick(elapsed);
    for (const [id, view] of this.units) {
      view.tick(
        elapsed,
        this.effects.reduced,
        this.dash.has(id) || this.walk.has(id) || this.director.ownsPosition(id),
      );
      const snap=view.animationSnapshot(),layout=CHARACTER_ANIMATIONS[view.defId];
      const gait=['walk','run','walk_heavy'].includes(snap.motion);
      const count=verticalAsset(view.defId) && ['N','S'].includes(snap.facing) ? 3 : layout?.clips[snap.motion]?.count??0;
      const contact=this.footfalls.update(id,snap.frame,count,view.root.x,view.root.y,
        this.walk.has(id)&&gait&&!this.effects.reduced&&!!this.vm?.state.mechanisms&&!AIRBORNE_VISUALS.has(view.defId));
      if(contact && this.vm){
        const cell=this.proj.screenToGrid(view.root.position);
        const terrain=cell&&this.vm.state.board.tiles[cell.y*this.boardSize.w+cell.x]?.terrain;
        const material=groundMaterial(terrain??undefined);
        if(material){const heavy=view.height>TILE*1.45;
          this.groundParticles.emit(view.root.x+(contact.foot?3:-3),view.root.y,contact.dx,contact.dy,
            footfallBudget(snap.motion==='run',heavy,this.compactAmbient,this.effects.reduced),heavy,material==='frost');
        }
      }
    }
    for (const pickup of this.pickups.values()) pickup.tick(elapsed, this.effects.reduced);
    this.updateWizardFacing();
    this.syncActors(elapsed);
  };
  private menuPaused = false;
  setMenuPaused(paused: boolean): void { this.menuPaused = paused; this.syncVisibility(); }
  private readonly syncVisibility = () => {
    if (!this.ready || this.destroyed) return;
    const paused = this.menuPaused || document.hidden;
    this.host?.closest('.battle')?.toggleAttribute('data-scene-paused', paused);
    this.clock.setSuspended(paused, performance.now());
    if (paused) this.app.ticker.stop();
    else this.app.ticker.start();
  };
  private pointerFacingTarget: Pos | null = null;
  private updateWizardFacing(): void {
    const vm = this.vm;
    if (!vm) return;
    const hero = (this.director.state ?? vm.state).units.find((u) => u.id === vm.heroId);
    const view = hero && this.units.get(hero.id);
    if (!hero || !view || this.director.busy || this.walk.has(hero.id) || this.dash.has(hero.id))
      return;
    view.setFacingLock(false);
    view.faceTarget(
      hero.pos,
      resolvedFacingTarget({
        preview: vm.preview?.impact,
        pointer: hasDirectionalAtlas(view.defId) || verticalAsset(view.defId) ? null : this.pointerFacingTarget,
        inside: !hasDirectionalAtlas(view.defId) && !verticalAsset(view.defId) && !!this.pointerFacingTarget,
      }),
    );
  }
  wizardFacingSnapshot() {
    const hero = this.vm?.state.units.find((u) => u.id === this.vm?.heroId);
    const view = hero && this.units.get(hero.id);
    return view
      ? {
          facing: view.directionalFacing,
          x: view.root.x,
          y: view.root.y,
          scale: view.scale,
          cast: view.castState,
        }
      : null;
  }
  private compactAmbient = false;
  private ready = false;
  private host: HTMLElement | null = null;
  private hostObserver: ResizeObserver | null = null;
  private destroyed = false;
  private vm: BoardViewModel | null = null;
  private refreshFacing = false;
  private lastSceneKey = '';
  private lastRangesKey = '';
  /** Logical board size of the scene being drawn; read from GameState on every draw. */
  private boardSize = { w: this.proj.cols, h: this.proj.rows };

  private readonly opponentNotices: OpponentNotices;
  constructor(private readonly callbacks: BattleCanvasCallbacks) {
    this.opponentNotices = new OpponentNotices(rows => this.callbacks.onOpponentNotices?.(rows));
    this.director = new VfxDirector(this.effects, {
      readableCards: import.meta.env.DEV && location.pathname === '/act3-qa',
      enemyAction: event => presentPublicAction(event),
      castCard: event => presentPublicCast(event),
      redraw: (state) => {
        if (this.vm) this.draw({ ...this.vm, state, mechanisms: mechanismView(state) });
      },
      presentEvent: (event) => {
        if (this.portraitQuery.matches && this.director.state) this.opponentNotices.present(event, this.director.state);
        if (event.type === 'MECHANISM_CHANGED' && event.kind === 'REGION' && this.director.state) {
          this.sections.playEvents([event], this.director.state, this.effects.reduced);
          if (this.sections.busy) this.reportPlaybackBusy(true);
        }
        if (event.type === 'GUARDIAN_STATE' || (event.type === 'MECHANISM_CHANGED' && event.kind !== 'PLATFORM')) this.mechanisms.playEvents([event]);
        if (event.type === 'GUARDIAN_STATE') this.camera.impulse('LIGHT', this.effects.reduced);
        if (event.type === 'MECHANISM_CHANGED' && event.cue === 'GATE_OPENED') {
          this.camera.impulse('LIGHT', this.effects.reduced);
          if (!this.effects.reduced) for (const o of this.director.state?.mechanisms?.objects ?? []) {
            if (o.def.kind === 'PRESSURE_PLATE' && o.active) this.effects.streak(o.pos,event.pos);
          }
          this.effects.ritual(event.pos,'MINOR','release');
        }
        if (event.type === 'GUARDIAN_STATE' && event.cue === 'GUARDIAN_EXPOSED' && this.director.state?.scenarioId === 'w3_e05' && !this.effects.reduced) {
          const display = this.director.state;
          const source = display?.mechanisms?.objects.find(o=>o.def.id===event.causeId);
          const guardian = display?.units.find(u=>u.id===event.unitId);
          const center = {x:GUARDIAN_FLOOR.x-0.5,y:GUARDIAN_FLOOR.y-0.5};
          if (source) this.effects.streak(source.pos,center);
          if (guardian) this.effects.streak(center,guardian.pos);
        }
        if (event.type === 'MECHANISM_CHANGED' && ['STATUE_PUSHED','GATE_CLOSED'].includes(event.cue) && !this.effects.reduced) {
          const p = this.proj.getUnitAnchor(event.pos);
          this.groundParticles.emit(p.x,p.y,0,0,this.compactAmbient?4:8,true,false,true);
        }
      },
      unit: (id) => this.units.get(id),
      obstacle: (id) => this.obstacles.get(id)?.body,
      walk: (event, reduced) => {
        const view = this.units.get(event.unitId);
        if (!view) return;
        if (event.mode === 'WALK') this.walk.enqueue(event.unitId, view, event, reduced);
        else {
          view.faceMovement(event.from, event.to);
          if (view.hasChargeAnimation) {
            view.playAnimation('charge');
            if (!reduced) {
              this.effects.streak(event.from, event.to);
              this.effects.burst(event.from, 'FORCE');
            }
          }
          this.dash.enqueue(event.unitId, view, event, reduced);
        }
      },
      busy: (value) => this.reportPlaybackBusy(value || this.mechanisms.busy || this.sections.busy),
      impulse: (kind, reduced) => this.camera.impulse(kind, reduced),
      groundImpact: (id,pos,strong) => {
        if(!this.vm?.state.mechanisms || this.effects.reduced)return;
        const material=groundMaterial(this.vm.state.board.tiles[pos.y*this.boardSize.w+pos.x]?.terrain);
        if(!material)return;
        const p=this.proj.getUnitAnchor(pos),view=this.units.get(id);
        this.groundParticles.emit(p.x,p.y,0,0,this.compactAmbient?3:6,strong,material==='frost',strong);
        if(strong && view)this.camera.impulse('LIGHT',false);
      },
      handPulse: (count) => this.callbacks.onHandPulse(count),
      card: (id) => this.vm?.content.cards[id],
      turnBanner: (faction, round) => {
        motionCues.emit('turn_start');
        this.callbacks.onTurnBanner(faction, round);
      },
    });
  }

  /** Current projection (read-only use: QA hooks and tests). */
  get projection(): GridProjection {
    return this.proj;
  }

  /** Dev-only visual test controls, exposed only by BoardView when import.meta.env.DEV is true. */
  qaPlayCharacterAnimation(unitId: string, motion: CharacterMotion, cueMs = 90): boolean {
    return this.units.get(unitId)?.playAnimation(motion, cueMs) ?? false;
  }
  qaArcherShot(sourceId: string, targetId: string): boolean {
    return shapeshifterQaEnabled && this.director.previewArcherShot(sourceId,targetId,
      visualSettings.reducedEffects || (this.motionQuery?.matches ?? false));
  }

  qaFaceTarget(unitId: string, target: Pos): boolean {
    const view = this.units.get(unitId),
      unit = this.vm?.state.units.find((u) => u.id === unitId);
    if (!view || !unit) return false;
    view.faceTarget(unit.pos, target, true);
    return true;
  }

  qaPauseFrame(paused: boolean): void {
    if (!shapeshifterQaEnabled) return;
    this.setMenuPaused(paused);
    if (paused) this.app.render();
  }

  qaPresentationSnapshot() {
    return shapeshifterQaEnabled ? this.director.state : null;
  }
  qaFeelSnapshot(){if(!this.ready || this.destroyed)return null;return {catalog:this.effects.catalog.snapshot,fps:this.app.ticker.FPS,particles:this.groundParticles.activeCount,reactions:this.effects.reactionSnapshot,actorChildren:this.actorLayer.children.length,groundChildren:this.groundFxLayer.children.length,vfxChildren:this.vfxLayer.children.length,mage:this.effects.mage.snapshot,fireball:this.effects.fireball.snapshot,bastion:this.effects.bastion.snapshot,pactSummon:this.effects.pactSummon.snapshot};}
  qaAnimationSnapshot(unitId: string) {
    return this.units.get(unitId)?.animationSnapshot() ?? null;
  }

  qaFaceCharacter(unitId: string, facing: Facing): boolean {
    const view = this.units.get(unitId);
    if (!view) return false;
    view.face(facing);
    return true;
  }

  private preparedScenes = new Set<string>();
  private readonly assetGate = new PresentationAssetGate(()=>this.reportPlaybackBusy(this.director.busy||this.mechanisms.busy||this.sections.busy||this.journey.active));
  private reportPlaybackBusy(value: boolean): void { this.callbacks.onPlaybackChange(value || this.assetGate.busy); }
  private async prepareSceneAssets(vm: BoardViewModel): Promise<void> {
    const key=sceneAssetKey(vm.state);if(this.preparedScenes.has(key))return;
    loadingMark('scene-assets-start');
    await Promise.all([
      loadPaintedCharacters(sceneAssetIds(vm.state)),
      this.mechanisms.prepare({...vm,mechanisms:mechanismView(vm.state)}),
      vm.state.mechanisms ? loadTempleEnvironment(vm.state) : Promise.resolve(),
    ]);
    this.preparedScenes.add(key);loadingMark('scene-assets-end');
  }
  async mount(host: HTMLElement, initialVm?: BoardViewModel): Promise<void> {
    if(initialVm)this.vm=initialVm;
    loadingMark('canvas-start');loadingMark('renderer-start');
    const renderer=this.app.init({background:0x000000,backgroundAlpha:0,antialias:true,resizeTo:host,autoDensity:true,resolution:Math.min(2,window.devicePixelRatio||1)}).then(()=>loadingMark('renderer-end'));
    await Promise.all([renderer,this.vm?this.prepareSceneAssets(this.vm):Promise.resolve()]);
    if(this.vm&&!this.preparedScenes.has(sceneAssetKey(this.vm.state)))await this.prepareSceneAssets(this.vm);
    if (this.destroyed) {
      this.app.destroy(true, { children: true });
      return;
    }
    this.host = host;
    host.appendChild(this.app.canvas);
    this.hostObserver = new ResizeObserver(() => {
      if (!this.destroyed) this.app.resize();
    });
    this.hostObserver.observe(host);
    this.world.addChild(
      this.ambience.art,
      this.platformLayer,
      this.templeEnvironment.back,
      this.terrainLayer,
      this.templeEnvironment.floor,
      this.sections.floor,
      this.ambience.lighting,
      this.targetingPreview.root,
      this.tacticalLayer,
      this.objectiveLayer,
      this.tileLayer,
      this.overlayLayer,
      this.groundFxLayer,
      this.actorLayer,
      this.ambience.foreground,
      this.templeEnvironment.foreground,
      this.chromeLayer,
      this.annotationLayer,
      this.vfxLayer,
    );
    for (const layer of [
      this.platformLayer,
      this.terrainLayer,
      this.targetingPreview.root,
      this.tacticalLayer,
      this.objectiveLayer,
      this.chromeLayer,
      this.annotationLayer,
    ])
      layer.eventMode = 'none';
    this.cameraRoot.addChild(this.world);
    this.introRoot.addChild(this.cameraRoot);
    this.app.stage.addChild(this.introRoot);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointerleave', () => {
      this.pointerFacingTarget = null;
      this.callbacks.onTileHover(null);
    });
    this.app.stage.on('pointermove', (e) => {
      if (e.pointerType !== 'touch' && !this.portraitQuery.matches) {
        const tile = this.mouseTarget(e);
        const candidates = this.tapCandidates(e);
        const hero = this.vm?.state.units.find((unit) => unit.id === this.vm?.heroId);
        const bodyTarget = candidates
          .slice(1)
          .find((pos) => !hero || pos.x !== hero.pos.x || pos.y !== hero.pos.y);
        this.pointerFacingTarget = tile ? (bodyTarget ?? tile) : null;
        this.callbacks.onTileHover(tile);
      }
    });
    // One pointer pipeline; the device only decides how the aimed tile is confirmed.
    this.app.stage.on('pointertap', (e) => {
      if (e.button === 2) return this.callbacks.onCancel();
      const ground = this.tileFromEvent(e);
      // Legal board actions win over secondary body inspection, even under tall artwork.
      const boardFirst = boardActionWins(ground, this.vm?.moveTiles.map(n=>n.pos) ?? [], this.vm?.targetTiles ?? []);
      if (!boardFirst && this.callbacks.onInspectUnit?.(this.tapCandidates(e, false))) return;
      if (e.pointerType === 'mouse' && !this.portraitQuery.matches) {
        const tile = this.mouseTarget(e);
        if (tile) this.callbacks.onTileClick(tile);
        return;
      }
      this.callbacks.onTileTap(this.tapCandidates(e));
    });
    this.app.renderer.on('resize', () => this.layout());
    this.app.ticker.add(this.animateWorld);
    this.ready = true;
    loadingMark("canvas-ready");
    document.addEventListener('visibilitychange', this.syncVisibility);
    this.portraitQuery.addEventListener('change', this.syncVisibility);
    this.syncVisibility();
    if (this.vm) this.render(this.vm);
    this.beginIntro();
  }

  destroy(): void {
    this.destroyed = true;
    this.journey.finish();
    this.mechanisms.destroy();
    this.sections.destroy();
    this.templeEnvironment.destroy();
    this.groundParticles.destroy();
    this.intro.finish(); // never leave input locked behind a torn-down canvas
    document.removeEventListener('visibilitychange', this.syncVisibility);
    this.portraitQuery.removeEventListener('change', this.syncVisibility);
    this.hostObserver?.disconnect();
    this.ambience.destroy();
    this.environment.destroy();
    this.targetingPreview.destroy();
    this.resetPlayback();
    this.director.destroy();
    this.opponentNotices.destroy();
    if (this.ready) {
      this.app.ticker.remove(this.animateWorld);
      for (const view of this.units.values()) view.destroy();
      this.units.clear();
      this.obstacles.clear();
      this.app.destroy(true, { children: true });
    }
    this.surfaceTexture?.destroy(true);
    this.surfaceTexture = null;
  }

  /** Screen → world (camera/world inverse) → projected board → logical tile. */
  private tileFromEvent(e: FederatedPointerEvent): Pos | null {
    return this.proj.screenToGrid(this.world.toLocal(e.global));
  }

  private mouseTarget(e: FederatedPointerEvent): Pos | null {
    return resolveMouseTarget(
      this.tileFromEvent(e),
      this.tapCandidates(e, false),
      !!this.vm?.unitTargeting,
      this.vm?.targetTiles ?? [],
    );
  }

  /**
   * Touch picking: the (edge-tolerant) ground tile, then every unit whose standing figure covers
   * the point, front-most first. Tall figures hide the tile behind them; tapping the body should
   * still reach the unit. Uses the figure's live head point, so it follows the actual art size.
   */
  private tapCandidates(e: FederatedPointerEvent, includeGround = true): Pos[] {
    const p = this.world.toLocal(e.global);
    const ground = this.proj.screenToGridNear(p, 0.3);
    const bodies: { pos: Pos; depth: number }[] = [];
    for (const unit of this.vm?.state.units ?? []) {
      const view = this.units.get(unit.id);
      if (!view?.root.visible) continue;
      const head = view.headPoint();
      const halfWidth = this.proj.footprint(unit.pos).w * 0.36;
      const feet = view.root.y + this.proj.footprint(unit.pos).h * 0.3;
      if (Math.abs(p.x - view.root.x) <= halfWidth && p.y >= head.y && p.y <= feet)
        bodies.push({ pos: unit.pos, depth: view.root.y });
    }
    bodies.sort((a, b) => b.depth - a.depth);
    return [...(includeGround && ground ? [ground] : []), ...bodies.map((b) => b.pos)];
  }

  /** Dev QA: a point on the live figure, above its ground tile. */
  unitBodyToClient(id: string): { x: number; y: number } | null {
    const view = this.units.get(id);
    if (!this.ready || !view || !this.host) return null;
    const head = view.headPoint();
    const point = this.world.toGlobal({
      x: view.root.x,
      y: head.y + (view.root.y - head.y) * 0.35,
    });
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  }

  /** Client pixels → logical tile through the same path as pointer input (QA / e2e). */
  clientToTile(clientX: number, clientY: number): Pos | null {
    if (!this.ready) return null;
    const rect = this.app.canvas.getBoundingClientRect();
    return this.proj.screenToGrid(
      this.world.toLocal({ x: clientX - rect.left, y: clientY - rect.top }),
    );
  }

  /** Canvas pixels the board may bleed into below its framed area (CSS negative margin). */
  private bleed(): number {
    if (!this.host) return 0;
    const margin = parseFloat(getComputedStyle(this.host).marginBottom) || 0;
    return Math.max(0, -margin);
  }

  /** Rebuild the projection when the viewport class or board size changes. Returns true if it did. */
  private ensureProjection(): boolean {
    const { width, height } = this.app.screen;
    const base = projectionPreset(width, height - this.bleed());
    // CSS owns the responsive composition; the same projection still draws and picks every tile.
    const depth = this.host
      ? parseFloat(getComputedStyle(this.host).getPropertyValue('--battle-depth'))
      : NaN;
    const key = `${this.vm?.state.scenarioId}:${this.vm?.heroId}`;
    if (this.vm && this.portraitCamera?.key !== key) {
      const hero = this.vm.state.units.find(u => u.id === this.vm?.heroId);
      this.portraitCamera = { key, turn: mobileCameraTurn(this.vm.cameraOrigin ?? hero?.pos ?? {x:0,y:0}, this.boardSize.w, this.boardSize.h) };
    }
    const quarterTurn: 0 | 1 | 2 | 3 = this.portraitQuery.matches ? this.portraitCamera?.turn ?? 1 : 0;
    const preset = { ...base, quarterTurn, depth: Number.isFinite(depth) ? depth : base.depth, oblique: TEMPLE_PLACES[this.vm?.state.scenarioId ?? ''] ? .58 : 0 };
    const { w, h } = this.boardSize;
    if (
      this.proj.cols === w &&
      this.proj.rows === h &&
      this.proj.perspective === preset.perspective &&
      this.proj.depthRatio === preset.depth && this.proj.oblique === preset.oblique && this.proj.quarterTurn === quarterTurn
    )
      return false;
    // Active spells retain their world geometry; resizing still fits that same world.
    // Apply any new perspective preset after playback releases its cached endpoints.
    if (this.director.busy && this.proj.cols === w && this.proj.rows === h) {
      this.projectionPending = true;
      return false;
    }
    this.proj = new GridProjection({ cols: w, rows: h, tile: TILE, ...preset });
    this.lastSceneKey = '';
    this.lastRangesKey = '';
    return true;
  }

  /** World bounds that must stay on screen: rim, front props and back-row headroom. */
  private framingBounds() {
    const p = this.proj;
    const half = p.frontWidth / 2 + Math.abs(p.oblique)*p.height/2 + TILE * (p.quarterTurn ? .25 : 1.05);
    const frame = this.host
      ? parseFloat(getComputedStyle(this.host).getPropertyValue('--battle-front-frame'))
      : NaN;
    // Mobile spends its height on playable tiles; the decorative platform may extend below them.
    return {
      left: -half,
      right: half,
      top: -Math.max(HEADROOM, ...(shapeshifterPresentationEnabled ? (this.vm?.state.units ?? []).map(unit=>{
        const id=unit.defId==='shapeshifter'?`qa_form_${formVisual(unit.activeForm).id}`:unitVisualId(unit.defId);
        const spec=characterSpec(id),vertical=verticalAsset(id)?verticalGeometry(id,256):null;
        const gait=gaitGeometry(id,spec,TILE,256);
        return Math.max(visualHeight(spec,TILE),vertical?.topClearance??0,gait?.topClearance??0)*unitVisualScale(unit.defId)+24;
      }) : [])),
      bottom: p.height + (Number.isFinite(frame) ? frame : 64),
    };
  }

  private layout(): void {
    if (!this.ready) return;
    if (this.ensureProjection() && this.vm) {
      this.draw({ ...this.vm, state: this.director.state ?? this.vm.state });
      return; // draw() re-enters layout() after rebuilding the scene.
    }
    const { width, height } = this.app.screen;
    const bounds = this.framingBounds();
    // Reserve a small non-tactical lane below the surface; the surface itself stays fully visible.
    const noticeSpace = this.portraitQuery.matches ? (height >= 550 ? 76 : 44) : 0;
    const framedHeight = Math.max(1, height - this.bleed() - noticeSpace);
    const fit = fitBattlefield(width, framedHeight, bounds, PADDING);
    // DOM controls retain their own sizes. Only the shared projected world fits this viewport.
    this.world.scale.set(fit.scale);
    for (const view of this.units.values()) view.setStatusScale(1 / fit.scale);
    this.mechanisms.setLabelScale(1 / fit.scale);
    this.world.position.set(fit.x, fit.y);
    if(this.host && this.portraitQuery.matches){
      const rect=this.app.canvas.getBoundingClientRect();
      const edge=[{x:0,y:0},{x:this.boardSize.w-1,y:0},{x:0,y:this.boardSize.h-1},{x:this.boardSize.w-1,y:this.boardSize.h-1}];
      const bottom=Math.max(...edge.flatMap(p=>this.proj.getTilePolygon(p).map(v=>rect.top + (fit.y + v.y * fit.scale) * rect.height / height)));
      const lane=noticeLane(rect.left,bottom,rect.right,rect.bottom-4);
      this.opponentNotices.setCapacity(lane.capacity);this.callbacks.onNoticeLane?.(lane);
    } else this.opponentNotices.setCapacity(0);
    this.compactAmbient = window.matchMedia(
      '(orientation: landscape) and (max-height: 500px)',
    ).matches;
  }

  tileCenter = (p: Pos): Point => this.proj.getTileCenter(p);

  /** Tile centre in page (client) pixels — used by e2e tests and DOM overlays. */
  tileToClient(p: Pos): { x: number; y: number } | null {
    if (!this.ready) return null;
    return this.worldToClient(this.proj.getTileCenter(p));
  }

  /** Projected tile corners in page pixels (TL, TR, BR, BL) — QA of edges and corners. */
  tilePolygonToClient(p: Pos): { x: number; y: number }[] | null {
    if (!this.ready) return null;
    return this.proj.getTilePolygon(p).map((c) => this.worldToClient(c));
  }

  private worldToClient(point: Point): { x: number; y: number } {
    const global = this.world.toGlobal(point);
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: rect.left + global.x, y: rect.top + global.y };
  }

  render(vm: BoardViewModel): void {
    const previous = this.vm?.state;
    if (this.ready && import.meta.env.DEV && location.pathname === '/act3-qa' && previous && previous.scenarioId !== vm.state.scenarioId) {
      const reduced = visualSettings.reducedEffects || (this.motionQuery?.matches ?? false);
      const advance = import.meta.env.DEV && location.pathname === '/act3-qa' &&
        adjacentTempleSegment(previous.scenarioId, vm.state.scenarioId, previous.outcome?.result === 'WON');
      this.journey.finish();
      this.resetPlayback();
      if (advance && !reduced) {
        const {width,height} = this.app.screen;
        try {
          const texture=this.app.renderer.generateTexture({target:this.introRoot, frame:new Rectangle(0,0,width,height), resolution:Math.min(1,1280/width,720/height)});
          this.journey.start(texture,width,height);
        } catch { /* Rendering failure must never block continuing the run. */ }
      }
    }
    if (previous && previous.scenarioId !== vm.state.scenarioId) { this.environment.clear(); this.opponentNotices.reset(); }
    this.vm = vm;
    if (!this.ready || this.assetGate.busy) return;
    if(!this.preparedScenes.has(sceneAssetKey(vm.state))){
      this.assetGate.enqueue(()=>this.prepareSceneAssets(vm),()=>{if(!this.destroyed){this.director.sync(vm.state);this.draw({...vm,state:this.director.state??vm.state});}});
      return;
    }
    this.director.sync(vm.state);
    this.draw({ ...vm, state: this.director.state ?? vm.state });
  }

  private draw(vm: BoardViewModel): void {
    presentMechanisms(vm.state);
    vm = { ...vm, mechanisms: mechanismView(vm.state) };
    if (this.director.busy || this.journey.active)
      vm = {
        ...vm,
        interactive: false,
        hoverTile: null,
        aimArmed: false,
        moveTiles: [],
        targetTiles: [],
        preview: null,
        intents: [],
        hoverPath: [],
      };
    this.boardSize = { w: vm.state.board.width, h: vm.state.board.height };
    this.ensureProjection();
    const sceneKey = JSON.stringify([vm.state.scenarioId, vm.state.board, vm.state.obstacles]);
    if (sceneKey !== this.lastSceneKey) {
      this.drawTerrain(vm);
      this.environment.syncTerrain(vm.state, this.proj);
      this.drawObstacles(vm);
      this.lastSceneKey = sceneKey;
      this.ambience.configure(
        vm.state.scenarioId,
        this.proj.frontWidth + RIM_MARGIN * 2,
        this.proj.height,
        -this.proj.frontWidth / 2 - RIM_MARGIN,
        this.proj,
      );
      this.layout();
    }
    this.templeEnvironment.react(vm.state);
    this.drawUnits(vm); // Persistent art; update status chrome only when its data changes.
    this.drawPickups(vm);
    const rangesKey = JSON.stringify([vm.moveTiles.map((n) => n.pos), vm.targetTiles, vm.mechanisms ? !!vm.hoverTile : false]);
    if (rangesKey !== this.lastRangesKey) {
      clearLayer(this.tileLayer);
      const g = new Graphics();
      drawRanges(g, this.proj, vm);
      this.tileLayer.addChild(g);
      this.lastRangesKey = rangesKey;
    }
    this.mechanisms.update(vm, this.proj);
    this.sections.update(vm, this.proj);
    this.targetingPreview.sync(vm, this.proj);
    this.drawOverlay(vm);
  }

  playEvents(events: readonly GameEvent[], state: Readonly<GameState>): void {
    this.targetingPreview.reset();
    if (!this.ready || !this.vm) return;
    if(events.some(e=>e.type==='BATTLE_STARTED'))this.resetPlayback();
    if(this.portraitQuery.matches)this.opponentNotices.register(events,state,this.vm.content,this.vm.heroId,this.director.state ?? this.vm.state);
    const vm={...this.vm,state,mechanisms:mechanismView(state)};
    const recipes = [
      { key: 'frost_nova', effect: this.effects.mage },
      { key: 'magic_missile', effect: this.effects.mage },
      { key: 'fireball', effect: this.effects.fireball },
      { key: 'bastion_blow', effect: this.effects.bastion },
      { key: 'summon_pact_golem', effect: this.effects.pactSummon },
    ].filter(r => r.effect.requested && events.some(e => e.type === 'CARD_PLAYED' && vm.content.cards[e.cardId]?.presentation.visualKey === r.key && (r.effect !== this.effects.mage || mageRecipeEnabled(r.key)) || (r.key === 'fireball' && universalReactionsEnabled() && e.type === 'UNIT_DAMAGED' && e.damageType === 'FIRE' && e.hpLost > 0)));
    const catalog=this.effects.catalog.requested?catalogEventRecipes(events,id=>vm.content.cards[id]):[];
    const forms=events.filter((e):e is Extract<GameEvent,{type:'FORM_CHANGED'}>=>e.type==='FORM_CHANGED');
    if (this.assetGate.busy || !this.preparedScenes.has(sceneAssetKey(state)) || recipes.length || catalog.length || forms.length)
      this.assetGate.enqueue(() => Promise.all([this.prepareSceneAssets(vm), ...recipes.map(r => r.effect.prepare()),
        this.effects.catalog.prepare(catalog), forms.length?loadPaintedCharacters(forms.map(e=>`qa_form_${formVisual(e.to).id}`)):Promise.resolve(),
      ]), () => { if (!this.destroyed) this.playLoadedEvents(events, state); });
    else this.playLoadedEvents(events,state);
  }
  private playLoadedEvents(events: readonly GameEvent[], state: Readonly<GameState>): void {
    const started=events.some(e=>e.type==='BATTLE_STARTED');
    const reduced = visualSettings.reducedEffects || (this.motionQuery?.matches ?? false);
    this.mechanisms.playEvents(events.filter(e => e.type === 'UNIT_MOVED' || (e.type === 'MECHANISM_CHANGED' && e.kind === 'PLATFORM')));
    if(this.mechanisms.busy || this.sections.busy)this.reportPlaybackBusy(true);
    this.director.enqueue(events.filter(e=>!(e.type==='UNIT_TELEPORTED' && e.sourceId?.startsWith('mechanism:'))), state, reduced);
    if (started) this.beginIntro();
  }

  // ── Battle intro ─────────────────────────────────────────────────────────────

  private beginIntro(): void {
    const reduced = visualSettings.reducedEffects || (this.motionQuery?.matches ?? false);
    this.introSettled = false;
    this.intro.start(introTimeline(this.callbacks.introVariant(), reduced));
    this.applyIntro(); // first frame already in the intro pose: no flash of the final board
  }

  /** Battlefield rise (transform + canvas fade) and environment awakening, per frame. */
  private applyIntro(): void {
    if (this.introSettled) return;
    const rise = this.intro.progress('battlefield');
    const lift = easing.outQuart(rise);
    const { width, height } = this.app.screen;
    const scale = INTRO.battlefieldScale + (1 - INTRO.battlefieldScale) * lift;
    // Scale about the board's visual centre so the platform grows toward the camera.
    this.introRoot.pivot.set(width / 2, height * 0.55);
    this.introRoot.position.set(width / 2, height * 0.55 + (1 - lift) * INTRO.battlefieldRise);
    this.introRoot.scale.set(scale);
    this.app.canvas.style.opacity =
      rise >= 1 ? '' : String(easing.outCubic(Math.min(1, rise * 1.6)));
    this.ambience.setWake(
      this.intro.progress('ambience_lights'),
      this.intro.progress('ambience_fog'),
      this.intro.progress('ambience_motes'),
    );
    if (!this.intro.active) {
      this.introRoot.pivot.set(0, 0);
      this.introRoot.position.set(0, 0);
      this.introRoot.scale.set(1);
      this.app.canvas.style.opacity = '';
      this.ambience.setWake(1, 1, 1);
      this.introSettled = true;
    }
  }

  private resetPlayback(): void {
    this.opponentNotices.reset();
    this.assetGate.clear();
    for (const view of this.units.values()) view.resetMotion();
    this.pointerFacingTarget = null;
    this.refreshFacing = true;
    this.dash.clear();
    this.walk.clear();
    this.director.clear();
    this.sections.clear();
    this.groundParticles.clear();
    this.footfalls.clear();
    this.camera.clear();
  }

  // ── Per-frame actor sync (cheap: ≤ a dozen actors) ───────────────────────────────────────

  private syncActors(elapsed: number): void {
    for (const view of this.units.values()) {
      const root = view.root;
      view.setDepthScale(this.proj.scaleAtY(root.y));
      root.zIndex = this.proj.depthAtPoint(root);
      view.syncChrome();
    }
    this.templeEnvironment.updateOcclusion([...this.units.values()].map(v=>v.root),this.proj,elapsed);
    // Occlusion aid: a tall obstacle fades while any figure stands right behind it.
    const blend = Math.min(1, elapsed / 90);
    for (const o of this.obstacles.values()) {
      if (!OCCLUDING_OBSTACLES.has(o.defId)) continue;
      const height = visualHeight(obstacleSpec(o.defId), TILE) * o.root.scale.y;
      const reach = this.proj.tileWidthAtY(o.root.y) * 0.62;
      let behind = false;
      for (const r of [...this.units.values()].map(view=>view.root).concat(this.mechanisms.occlusionAnchors())) {
        if (
          r.alpha > 0.05 &&
          r.y < o.root.y - 2 &&
          r.y > o.root.y - height * 0.85 &&
          Math.abs(r.x - o.root.x) < reach
        ) {
          behind = true;
          break;
        }
      }
      const target = behind ? OCCLUDER_ALPHA : 1;
      o.root.alpha += (target - o.root.alpha) * blend;
    }
  }

  // ── Layers ───────────────────────────────────────────────────────────────

  private drawTerrain(vm: BoardViewModel): void {
    this.terrainPulse.removeFromParent();
    clearLayer(this.terrainPulse);
    clearLayer(this.terrainLayer);
    clearLayer(this.tacticalLayer);
    clearLayer(this.objectiveLayer);
    clearLayer(this.platformLayer);
    for (const prop of this.props) prop.destroy({ children: true });
    this.props = [];
    const { board } = vm.state;
    const proj = this.proj;

    const temple = !!TEMPLE_PLACES[vm.state.scenarioId];
    this.templeEnvironment.configure(vm.state, proj);
    if (temple && !this.templeLoading) {
      this.templeLoading = true;
      void loadTempleEnvironment(vm.state).then(()=>{if(!this.destroyed&&this.vm){this.lastSceneKey='';this.draw(this.vm);}}).catch(()=>{this.templeLoading=false;});
    }
    // Act III direction reset: the temple also stands on the floating tactical platform.
    const platform = drawPlatform(vm.state, proj);
    this.platformLayer.addChild(platform.back);
    for (const prop of platform.props) this.actorLayer.addChild(prop);
    this.props = platform.props;

    // Painted surface: drawn flat once, then mapped onto the projected board in perspective.
    const w = board.width * TILE,
      h = board.height * TILE;
    if (
      !this.surfaceTexture ||
      this.surfaceTexture.width !== w ||
      this.surfaceTexture.height !== h
    ) {
      this.surfaceTexture?.destroy(true);
      this.surfaceTexture = RenderTexture.create({
        width: w,
        height: h,
        resolution: 2,
        antialias: true,
      });
    }
    const flat = templeSurface(vm.state, TILE) ?? drawSurface(vm.state, TILE);
    this.app.renderer.render({ container: flat, target: this.surfaceTexture, clear: true });
    flat.destroy({ context: true });
    // Subdivision aligned with tile edges: grid lines land exactly on projected tile borders.
    const mesh = new PerspectiveMesh({
      texture: this.surfaceTexture,
      verticesX: board.width * 4 + 1,
      verticesY: board.height * 4 + 1,
    });
    const [tl, tr, br, bl] = [
      proj.project(0, 0),
      proj.project(board.width, 0),
      proj.project(board.width, board.height),
      proj.project(0, board.height),
    ] as const;
    mesh.setCorners(tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y);
    this.terrainLayer.addChild(mesh);
    if (!temple) this.terrainLayer.addChild(drawSurfaceDetails(vm.state, proj));

    this.tacticalLayer.addChild(this.terrainPulse);
    board.tiles.forEach((tile, i) => {
      const cell = { x: i % board.width, y: Math.floor(i / board.width) };
      const s = proj.footprint(cell).w / TILE;
      const material = tacticalTileStyle(tile.terrain);
      if (material) {
        const shape = new Graphics();
        shape.poly(proj.getTilePolygon(cell).flatMap(p => [p.x, p.y]))
          .fill({ color: material.color, alpha: tile.terrain === 'FIRE' || tile.terrain === 'ICE' ? Math.min(.08, material.alpha) : material.alpha })
          .stroke({ color: material.color, alpha: 0.8, width: 2 });
        if (tile.terrain === 'SMOKE') {
          const c=proj.getTileCenter(cell), f=proj.footprint(cell);
          for (const offset of [-0.18,0,0.18]) shape.ellipse(c.x+offset*f.w,c.y+offset*f.h,f.w*0.23,f.h*0.22).fill({color:0xcac1d4,alpha:0.2});
        }
        this.tacticalLayer.addChild(shape);
      }
      if (tile.terrain === 'HAZARD' || tile.terrain === 'ARCANE' || tile.terrain === 'LAVA') {
        const glyph = new Graphics();
        const points = [
          [0.5, 0.2],
          [0.8, 0.5],
          [0.5, 0.8],
          [0.2, 0.5],
        ]
          .map(([u, v]) => proj.project(cell.x + u!, cell.y + v!))
          .flatMap((p) => [p.x, p.y]);
        glyph
          .poly(points)
          .stroke({ color: tile.terrain === 'ARCANE' ? 0xcaa4ff : 0xff9955, width: 3 });
        this.terrainPulse.addChild(glyph);
      }
      if (tile.terrainTurnsLeft !== null) {
        const turns = label(`${tile.terrainTurnsLeft}`, {
          fontSize: 12,
          fontWeight: '700',
          fill: 0xffe0b0,
          stroke: { color: 0x0a0d12, width: 3 },
        });
        turns.anchor.set(1, 0);
        turns.scale.set(s);
        const p = proj.project(cell.x + 0.94, cell.y + 0.06);
        turns.position.set(p.x, p.y);
        this.tacticalLayer.addChild(turns);
      }
      if (tile.terrain === 'OBJECTIVE') {
        const exit = label('SALIDA', {
          fontSize: 12,
          fontWeight: '800',
          fill: 0xf2c94c,
          stroke: { color: 0x0a0d12, width: 3 },
        });
        exit.anchor.set(0.5, 1);
        exit.scale.set(s);
        const p = proj.project(cell.x + 0.5, cell.y + 0.95);
        exit.position.set(p.x, p.y);
        this.objectiveLayer.addChild(exit);
      }
    });
  }

  private drawObstacles(vm: BoardViewModel): void {
    const live = new Set(vm.state.obstacles.map((o) => o.id));
    for (const [id, view] of this.obstacles) {
      if (!live.has(id)) {
        view.root.destroy({ children: true });
        this.obstacles.delete(id);
      }
    }
    for (const o of vm.state.obstacles) {
      let view = this.obstacles.get(o.id);
      if (!view) {
        const root = new Container(),
          body = drawObstacle(o.defId, TILE, vm.state.scenarioId.startsWith('w2_'), vm.state.scenarioId.startsWith('hunt_'));
        const turns = label('', {
          fontSize: 14,
          fontWeight: '800',
          fill: 0xe8fbff,
          stroke: { color: 0x0b2233, width: 3 },
        });
        turns.anchor.set(0.5, 1);
        turns.y = -visualHeight(obstacleSpec(o.defId), TILE) - 2;
        if (vm.state.scenarioId === 'w3_e06') body.scale.set(0.68);
        root.addChild(body, turns);
        root.eventMode = 'none';
        this.actorLayer.addChild(root);
        view = { root, body, turns, defId: o.defId };
        this.obstacles.set(o.id, view);
      }
      const anchor = this.proj.getUnitAnchor(o.pos);
      view.root.position.set(anchor.x, anchor.y);
      view.root.scale.set(this.proj.scaleAtY(anchor.y));
      view.root.zIndex = this.proj.depthAtPoint(anchor);
      view.turns.text = o.turnsLeft === null ? '' : String(o.turnsLeft);
    }
  }

  /** Objective pickups: Y-sorted with actors, just behind a unit sharing the tile. */
  private drawPickups(vm: BoardViewModel): void {
    const key = (id: string) => `${vm.state.scenarioId}:${id}`;
    const live = new Set(vm.state.collectibles.map((c) => key(c.id)));
    for (const [id, view] of this.pickups) {
      if (live.has(id)) continue;
      view.destroy();
      this.pickups.delete(id);
    }
    for (const c of vm.state.collectibles) {
      let view = this.pickups.get(key(c.id));
      if (!view) {
        view = new CollectibleView(c.kind);
        this.pickups.set(key(c.id), view);
        this.actorLayer.addChild(view.root);
      }
      const anchor = this.proj.getUnitAnchor(c.pos);
      view.root.position.set(anchor.x, anchor.y);
      view.root.scale.set(this.proj.scaleAtY(anchor.y));
      view.root.zIndex = this.proj.depthAtPoint(anchor) - 0.5;
      view.setCollected(c.collected);
    }
  }

  private drawUnits(vm: BoardViewModel): void {
    const live = new Set(vm.state.units.map((u) => u.id));
    for (const [id, view] of this.units) {
      if (!live.has(id)) {
        this.walk.cancel(id);
        this.dash.cancel(id);
        view.destroy();
        this.units.delete(id);
      }
    }
    if(vm.state.round === 1)this.forgePhaseRound = 0;
    for (const unit of vm.state.units) {
      const visualId = unit.kind === 'STRUCTURE' && vm.state.scenarioId.startsWith('hunt_') ? 'veil_relic' : shapeshifterPresentationEnabled && unit.defId === 'shapeshifter'
        ? `qa_form_${formVisual(unit.activeForm).id}` : unitVisualId(unit.defId);
      let view = this.units.get(unit.id);
      if (view && view.defId !== visualId) {
        this.walk.cancel(unit.id); this.dash.cancel(unit.id);
        view.destroy(); this.units.delete(unit.id); view = undefined;
      }
      if (!view) {
        view = new UnitView(
          visualId,
          unit.id,
          unitVisualScale(unit.defId),
          unitVisualTint(unit.defId),
        );
        if (shapeshifterPresentationEnabled && unit.defId === 'shapeshifter' && unit.activeForm) {
          view.pulseLight(0x80d9c5, this.motionQuery?.matches ? 0 : 600);
          if (!this.motionQuery?.matches) view.playAnimation('arrival', 600);
        }
        const delta = this.facingDelta(unit, vm.state);
        if (delta !== null) view.faceHorizontal(delta);
        if(INFERNAL_ANIMATION_IDS.some(id=>id===view!.defId)) {
          const target=vm.state.units.filter(u=>u.faction!==unit.faction).sort((a,b)=>Math.abs(a.pos.x-unit.pos.x)+Math.abs(a.pos.y-unit.pos.y)-Math.abs(b.pos.x-unit.pos.x)-Math.abs(b.pos.y-unit.pos.y))[0];
          if(target)view.faceTarget(unit.pos,target.pos,true);
        }
        this.units.set(unit.id, view);
        this.actorLayer.addChild(view.root);
        this.chromeLayer.addChild(view.chrome);
      }
      view.projectFacing = this.proj.quarterTurn ? this.tileCenter : undefined;
      view.stablePuzzleIdle = !!vm.mechanisms;
      const anchor = this.proj.getUnitAnchor(unit.pos);
      if (
        !this.dash.has(unit.id) &&
        !this.walk.has(unit.id) &&
        !this.director.ownsPosition(unit.id) && !this.mechanisms.ownsPosition(unit.id) && !this.sections.ownsPosition(unit.id)
      )
        view.root.position.set(anchor.x, anchor.y);
      const intent = vm.state.intents.find((i) => i.enemyId === unit.id);
      const def = vm.content.enemies[unit.defId];
      const phaseName = unit.defId.startsWith('veil_') && def ? enemyPhase(def,unit)?.name : undefined;
      view.update(unit, intent, vm.focusedEnemyId === unit.id, phaseName);
      if(unit.defId === 'forge_king' && [3,5,6].includes(vm.state.round) && this.forgePhaseRound !== vm.state.round && unit.hp > 0) {
        this.forgePhaseRound = vm.state.round;
        view.pulseLight(0xff9e51,450);
        view.playAnimation('ability',100);
      }
      if (unit.combatFacing && !this.walk.has(unit.id) && !this.dash.has(unit.id) && !this.director.ownsPosition(unit.id)) {
        const vectors = {UP:{x:0,y:-1},DOWN:{x:0,y:1},LEFT:{x:-1,y:0},RIGHT:{x:1,y:0}};
        view.faceMovement({x:0,y:0}, vectors[unit.combatFacing]);
      }
      const light = this.nearbyLight(unit, vm.state);
      view.setAmbientLight(light.color, light.strength);
    }
    if (this.refreshFacing) {
      for (const unit of vm.state.units) {
        const delta = this.facingDelta(unit, vm.state);
        if (delta !== null) {
          const view = this.units.get(unit.id);
          if (view && !(shapeshifterPresentationEnabled ? hasDirectionalArt(view.defId) : hasDirectionalAtlas(view.defId))) view.faceHorizontal(delta);
        }
      }
      this.refreshFacing = false;
    }
    this.syncActors(0);
  }

  /** Screen-horizontal target direction from already-resolved unit intents or nearest opponents. */
  private facingDelta(unit: GameState['units'][number], state: Readonly<GameState>): number | null {
    if (unit.combatFacing) return null;
    if (unit.kind === 'STRUCTURE') return null;
    const intent = state.intents.find((candidate) => candidate.enemyId === unit.id);
    if (intent && 'targetUnitId' in intent) {
      const target = state.units.find((candidate) => candidate.id === intent.targetUnitId);
      if (target) return target.pos.x - unit.pos.x;
    }
    if (intent && 'center' in intent) return intent.center.x - unit.pos.x;
    if (intent && 'direction' in intent) {
      if (intent.direction === 'RIGHT') return 1;
      if (intent.direction === 'LEFT') return -1;
    }
    const target = state.units
      .filter((candidate) => candidate.faction !== unit.faction)
      .sort(
        (a, b) =>
          Math.abs(a.pos.x - unit.pos.x) +
          Math.abs(a.pos.y - unit.pos.y) -
          (Math.abs(b.pos.x - unit.pos.x) + Math.abs(b.pos.y - unit.pos.y)),
      )[0];
    return target ? target.pos.x - unit.pos.x : null;
  }

  /** Local terrain light is a low-opacity presentation cue, never a rule or a sprite tint. */
  private nearbyLight(unit: GameState['units'][number], state: Readonly<GameState>) {
    if (unit.kind === 'STRUCTURE') return { color: 0xffd36f, strength: 0.26 };
    let color = unit.faction === 'ENEMY' ? 0xc78672 : 0x70bce8;
    let strength = unit.faction === 'ENEMY' ? 0.22 : 0.34;
    const theme = encounterIdentity(state.scenarioId).theme;
    const lamp = theme === 'fracture' ? 0 : cornerLight(unit.pos.x + 0.5, unit.pos.y + 0.5, state.board.width, state.board.height);
    color = blendLight(color, theme === 'sanctuary' ? 0x83c6de : 0xffa447, lamp / 0.42);
    strength = Math.max(strength, lamp);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 1) continue;
        const x = unit.pos.x + dx;
        const y = unit.pos.y + dy;
        if (x < 0 || y < 0 || x >= state.board.width || y >= state.board.height) continue;
        const terrain = state.board.tiles[y * state.board.width + x]?.terrain;
        if (terrain === 'FIRE' || terrain === 'LAVA') {
          color = 0xff854d;
          strength = 0.46;
        } else if (terrain === 'ICE' && strength < 0.4) {
          color = 0x7be5ff;
          strength = 0.4;
        }
      }
    return { color, strength };
  }

  private drawOverlay(vm: BoardViewModel): void {
    this.forgePulse.removeFromParent();
    this.forgePulse.clear();
    clearLayer(this.overlayLayer);
    clearLayer(this.annotationLayer);
    const g = new Graphics();
    drawObjectiveFocus(g, this.proj, vm.state);
    drawOverlay(g, this.proj, vm);
    this.overlayLayer.addChild(g);
    for (const plan of vm.intents) {
      if (vm.state.units.find(u => u.id === plan.enemyId)?.defId !== 'forge_king') continue;
      for (const tile of plan.attackTiles) {
        const polygon = this.proj.getInsetPolygon(tile,.1);
        this.forgePulse.poly(polygon.flatMap(p => [p.x,p.y])).stroke({color:0xffc379,width:3});
      }
    }
    this.overlayLayer.addChild(this.forgePulse);

    for (const [index, node] of (vm.state.dominion?.nodes ?? []).entries()) {
      const p = this.proj.project(node.pos.x + 0.82, node.pos.y + 0.8);
      const rune = label(String(index + 1), {
        fontSize: 15,
        fontWeight: '900',
        fill: 0xe7d7a9,
        stroke: { color: 0x08101a, width: 3 },
      });
      rune.anchor.set(0.5);
      rune.position.set(p.x, p.y);
      this.annotationLayer.addChild(rune);
    }

    for (const prediction of vm.preview?.predicted ?? []) {
      const unit = vm.state.units.find((u) => u.id === prediction.unitId);
      if (!unit) continue;
      const head = this.units.get(unit.id)?.headPoint() ?? this.proj.getUnitAnchor(unit.pos);
      const t = label(prediction.label, {
        fontSize: 13,
        fontWeight: '900',
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 4 },
      });
      t.anchor.set(0.5, 1);
      t.position.set(head.x - 22, head.y - 24);
      this.annotationLayer.addChild(t);
    }
  }
}
