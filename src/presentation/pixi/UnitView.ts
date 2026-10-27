import { premiumVfxEnabled } from '../vfx/premiumVfxRelease';
import { lightEnvelope, litTint, contactShadow, blendLight } from './localLighting';
import { HealthBarAnimation } from './HealthBarAnimation';
import { verticalAsset, verticalGeometry, isVerticalView, VERTICAL_TIMING } from '../qa/locomotion/directionalProfiles';
import { cardinalView } from './directionalFacing';
import { gaitGeometry } from '../qa/locomotion/gaitGeometry';
import { shapeshifterPresentationEnabled } from '../shapeshifterRelease';
import { locomotionClip } from './locomotion';
import { RootSnareView } from './RootSnareView';
import { VeilStatusView } from './VeilStatusView';
import { paintedCharacter } from './paintedTextures';
import { markedPrey } from '../cards/tacticalPresentation';
import { ColorMatrixFilter, Container, Graphics, GraphicsPath, Text, Sprite, type Texture } from 'pixi.js';
import type { Unit, EnemyIntent } from '../../game';
import { statusIcon } from '../combat/statusPresentation';
import { PaintedFigure, unitArt } from './unitArt.ts';
import {
  CharacterAnimator,
  type AnimationFrames,
  type CharacterMotion,
  type Facing,
} from './CharacterAnimator.ts';
import { wizardFacing, WIZARD_SECTORS, type WizardFacing } from './wizardFacing.ts';
import type { Pos } from '../../game';
import { idleTiming } from './idleBreathing.ts';
import { summonPose, summonFacingSign } from './summonMotion.ts';
import {
  GUARDIAN_EXPOSED_VISUAL_ID,
  hasDirectionalArt,
  hasDirectionalAtlas,
  CHARACTER_ANIMATIONS,
} from './characterAnimations.ts';
import { paintedAnimationClips } from './paintedTextures.ts';
import { characterDefinition } from '../assets/characterDefinitions.ts';
import { ICON_PATHS, type IconName } from '../assets/iconPaths.ts';
import { FOOT_Y, SHADOW_OFFSET, TILE, characterSpec, visualHeight } from './renderContract.ts';

const text = (value: string, x: number, y: number, color = 0xe2eaf0, size = 11) => {
  const t = new Text({
    text: value,
    style: {
      fontFamily: 'system-ui',
      fontSize: size,
      fontWeight: '700',
      fill: color,
      stroke: { color: 0x08101b, width: 3 },
    },
  });
  t.anchor.set(0.5);
  t.position.set(x, y);
  return t;
};

/** Vector fallback art was authored ~80 units tall; bring it to the contract height. */
const FALLBACK_SCALE = 1.45;

/**
 * Persistent unit view. Only the small status chrome changes when its data changes.
 *
 * root     (position = ground anchor on the projected tile, zIndex = depth) ← playback owns it
 *  └ scaler (subtle depth-by-row scale)
 *     ├ base   contact shadow, selection ring, shield shell
 *     └ figure (pivot at the feet: idle / cast microanimation)
 *        ├ body   painted figure, feet at the root origin
 *        └ aura
 * chrome   HP, shield, statuses, intent — lives in the canvas chrome layer (always readable),
 *          follows root every frame via syncChrome().
 */
export class UnitView {
  readonly root = new Container();
  readonly scaler = new Container();
  readonly base = new Graphics();
  private readonly contact = new Graphics();
  private readonly selection = new Graphics();
  private readonly clarity = new ColorMatrixFilter();
  private selected = false;
  private readonly rootSnare: RootSnareView | null;
  readonly body: ReturnType<typeof unitArt>;
  private readonly figure = new Container();
  private readonly aura = new Graphics();
  private readonly worldLight = new Graphics();
  private readonly crystalDamage = new Graphics();
  private readonly conditionFx = new VeilStatusView();
  private veilPhase: string | undefined;
  private crystalCrackLevel = 0;
  private ambientLightColor = 0x87cfff;
  private ambientLightStrength = 0;
  private pulseColor = 0x87cfff;
  private pulseRemaining = 0;
  private pulseDuration = 1;
  private clock = 0;
  private readonly idleTiming: ReturnType<typeof idleTiming>;
  private familiarMotion: CharacterMotion = 'idle';
  private familiarRemaining = 0;
  private familiarDuration = 1;
  private castRemaining = 0;
  private castDuration = 1;
  private readonly animator: CharacterAnimator | null;
  readonly chrome = new Container();
  private signature = '';
  private readonly healthAnimation = new HealthBarAnimation();
  private readonly healthInk = new Graphics();
  private healthColor = 0x7bcdad;
  private healthPaintKey = '';
  private animateNextHealth = false;
  animateHealthChange(): void { this.animateNextHealth = true; }
  snapHealth(): void { this.animateNextHealth = false; this.healthAnimation.snap(); this.drawHealth(); }
  private drawHealth(): void {
    const key = `${this.healthAnimation.front}:${this.healthAnimation.trail}:${this.healthColor}`;
    if (key === this.healthPaintKey) return;
    this.healthPaintKey = key;
    this.healthInk.clear().rect(-24, -4, 48 * this.healthAnimation.trail, 3).fill(0xe9c17c)
      .rect(-24, -4, 48 * this.healthAnimation.front, 3).fill(this.healthColor);
  }
  /** Contract height of the figure (world units at depth scale 1). */
  readonly height: number;
  private statusRow: Container | null = null;
  private statusScale = 1;
  setStatusScale(scale: number): void { this.statusScale = Math.max(1, scale); this.statusRow?.scale.set(this.statusScale); }
  private readonly chromeClearance: number;
  private depthScale = 1;

  /** `sizeScale` enlarges elite/boss figures; the ground ring and chrome keep tile size. */
  constructor(
    readonly defId: string,
    unitId = defId,
    private readonly sizeScale = 1,
    private readonly tint = 0xffffff,
  ) {
    this.idleTiming = idleTiming(unitId);
    const spec = characterSpec(defId);
    this.height = visualHeight(spec, TILE);
    const gait = CHARACTER_ANIMATIONS[defId]?.locomotionOnly ? gaitGeometry(defId, spec, TILE, 256) : null;
    const vertical = verticalAsset(defId) ? verticalGeometry(defId, 256) : null;
    this.chromeClearance = Math.max(0, (gait?.topClearance ?? this.height) - this.height, (vertical?.topClearance ?? this.height) - this.height);
    this.body = unitArt(defId);
    if (!(this.body instanceof PaintedFigure))
      this.body.scale.set(FALLBACK_SCALE * (defId === 'chicken' ? 0.7 : 1));
    const layout = CHARACTER_ANIMATIONS[defId],
      clips = paintedAnimationClips(defId);
    const animationConfig: Partial<Record<CharacterMotion, AnimationFrames>> = {};
    if (clips && layout)
      for (const [motion, frames] of clips) {
        const timing = layout.clips[motion];
        if (frames.length && timing)
          animationConfig[motion] = {
            count: frames.length,
            loop: timing.loop,
            frameMs: timing.frameMs,
            terminal: timing.terminal,
            loopStart: timing.loopStart,
            animatedIdle: timing.animatedIdle,
            queueAfterHit: timing.queueAfterHit,
            contactFrame: timing.contactFrame,
          };
      }
    this.animator =
      this.body instanceof PaintedFigure && clips
        ? new CharacterAnimator(
            animationConfig,
            (motion, frame) =>
              this.body instanceof PaintedFigure && this.body.setAnimationFrame(motion, frame),
            (facing) => this.applyFacing(facing),
          )
        : null;
    if (!hasDirectionalArt(defId)) this.applyFacing(this.animator?.direction ?? 'RIGHT');
    // Feet (body-local (0, FOOT_Y)) land exactly on the root origin = ground anchor.
    this.body.y = -FOOT_Y * this.body.scale.y;
    this.figure.pivot.set(0, 0);
    this.figure.position.set(0, 0);
    this.figure.scale.set(sizeScale);
    this.worldLight.eventMode = 'none';
    const accent = characterDefinition(defId).accent;
    if ((defId === 'mage' || defId === 'dark_shaman') && spec.glow) {
      const tip =
        this.body instanceof PaintedFigure
          ? this.body.imagePoint(spec.glow.x, spec.glow.y)
          : { x: 34, y: -75 + FOOT_Y };
      const x = tip.x * this.body.scale.x,
        y = this.body.y + tip.y * this.body.scale.y;
      this.aura.circle(x, y, 20).fill({ color: accent, alpha: 0.035 });
      this.aura.circle(x, y, 13).fill({ color: accent, alpha: 0.14 });
      this.aura.circle(x, y, 4).fill({ color: 0xd8f5ff, alpha: 0.32 });
      this.aura.circle(x, y, 7).stroke({ color: accent, width: 1, alpha: 0.28 });
    } else if (defId === 'pact_golem') {
      // Protective identity only: the server owns readiness, range and mitigation.
      this.aura.ellipse(0, 0, TILE*.39, TILE*.16).stroke({color:0xb087ea,width:1.5,alpha:.38});
      this.aura.ellipse(0, 0, TILE*.32, TILE*.12).stroke({color:0xd9bb88,width:.8,alpha:.3});
    } else if (defId === 'crystal') {
      this.aura.ellipse(0, -8, TILE * 0.34, TILE * 0.2).fill({ color: accent, alpha: 0.06 });
      for (let i = 0; i < 5; i++)
        this.aura
          .circle(-34 + i * 17, -this.height * (0.35 + (i % 3) * 0.17), 1.4)
          .fill({ color: accent, alpha: 0.55 });
    }
    this.figure.addChild(this.worldLight, this.body, this.crystalDamage, this.aura);
    this.scaler.addChild(this.contact, this.base, this.selection, this.conditionFx, this.figure);
    const roots = paintedCharacter('root_snare');
    this.rootSnare = roots ? new RootSnareView(roots) : null;
    if (this.rootSnare) this.scaler.addChild(this.rootSnare);
    this.selection.eventMode = 'none';
    // Grade only the figure: preserve source colors and recover painted highlights.
    const clarity = this.clarity;
    // Color grading must retain the canvas's device resolution. Pixi's default
    // filter resolution (1) downsampled DPR-2 sprites into a soft intermediate.
    clarity.resolution = 'inherit';
    clarity.antialias = 'inherit';
    clarity.contrast(0.1, false);
    clarity.brightness(1.06, true);
    clarity.saturate(0.06, true);
    this.body.filters = [clarity];
    // Borrowed placeholder art (the provisional Warrior) is tinted; final art is untouched.
    this.body.tint = this.tint;
    this.root.addChild(this.scaler);
    this.root.eventMode = 'none';
    this.chrome.eventMode = 'none';
  }

  private guardianArt: Sprite | null = null;
  private guardianFacing: Facing = 'RIGHT';
  private guardianExposed: boolean | null = null;
  setGuardianArt(texture: Texture | undefined, exposed=false) {
    if(this.defId==='temple_guardian' && this.animator){
      // Authored articulated clips own the body; static state cards must never cover them.
      if(this.guardianArt)this.guardianArt.visible=false;
      this.body.visible=true;
      if(this.guardianExposed!==exposed){
        const animate = this.guardianExposed !== null;
        this.guardianExposed=exposed;
        if(this.body instanceof PaintedFigure)this.body.setAnimationVariant(exposed?GUARDIAN_EXPOSED_VISUAL_ID:'temple_guardian', animate);
        if(animate)this.pulseLight(exposed ? 0x66ffee : 0xc4a776, 420);
      }
      return;
    }
    if (!texture || this.guardianArt?.texture === texture) return;
    if (!this.guardianArt) {
      this.guardianArt = new Sprite(texture);
      this.guardianArt.anchor.set(.5, 1);
      this.figure.addChild(this.guardianArt);
    }
    this.body.visible = false;
    this.guardianArt.texture = texture;
    this.guardianArt.height = this.height;
    this.guardianArt.scale.x = Math.abs(this.guardianArt.scale.y) * (this.guardianFacing==='RIGHT'?-1:1);
  }

  /** Applied every frame from the projected y of the root (continuous during dashes/pushes). */
  setDepthScale(scale: number): void {
    if (scale === this.depthScale) return;
    this.depthScale = scale;
    this.scaler.scale.set(scale);
  }

  get scale(): number {
    return this.depthScale;
  }

  /** Head-top point in the root's parent space. */
  headPoint(): { x: number; y: number } {
    return {
      x: this.root.x,
      y: this.root.y - this.height * this.sizeScale * this.depthScale * this.root.scale.y,
    };
  }

  /** Chrome follows the figure's head; it fades with the figure (dash, blink). */
  syncChrome(): void {
    const head = this.headPoint();
    this.chrome.position.set(head.x, head.y - 6 - this.chromeClearance * this.sizeScale * this.depthScale * this.root.scale.y);
    this.chrome.alpha = this.root.alpha;
    this.chrome.visible = this.root.visible;
  }

  anticipate(duration: number): void {
    this.castDuration = Math.max(1, duration);
    this.castRemaining = duration;
  }

  resetMotion(): void {
    this.clock = 0;
    this.facingLocked = false;
    this.castRemaining = 0;
    this.figure.scale.set(this.sizeScale);
    this.figure.position.set(0, 0);
    this.familiarRemaining = 0;
    this.familiarMotion = 'idle';
    this.figure.alpha = 1;
    this.root.alpha = 1;
    this.figure.rotation = 0;
    this.aura.alpha = 0.6;
    this.pulseRemaining = 0;
    this.body.tint = litTint(this.tint, this.ambientLightColor, this.ambientLightStrength);
    this.contact.scale.set(1);
    this.contact.alpha = 1;
    this.drawWorldLight();
    this.animator?.reset();
    if (this.body instanceof PaintedFigure) {
      this.body.setAnimationFrame('idle', 0);
      this.body.breathe(0, false);
    }
  }

  /** Subtle colored bounce/rim behind the untouched source sprite. */
  setAmbientLight(color: number, strength: number): void {
    const clamped = Math.max(0, Math.min(1, strength));
    if (color === this.ambientLightColor && clamped === this.ambientLightStrength) return;
    this.ambientLightColor = color;
    this.ambientLightStrength = clamped;
    this.drawWorldLight();
  }

  pulseLight(color: number, duration = 200): void {
    this.pulseColor = color;
    this.pulseDuration = Math.max(1, duration);
    this.pulseRemaining = this.pulseDuration;
    this.drawWorldLight();
  }

  private drawWorldLight(): void {
    this.worldLight.clear();
    const pulsing = this.pulseRemaining > 0;
    this.worldLight.tint = blendLight(this.ambientLightColor, this.pulseColor, lightEnvelope(this.pulseRemaining, this.pulseDuration));
    if (pulsing || this.ambientLightStrength > 0) {
      const centerY = -this.height * 0.5;
      // Soft directional bounce behind the source silhouette, never a hard body outline.
      for (let band = 5; band > 0; band--)
        this.worldLight
          .ellipse(
            -this.height * 0.06,
            centerY,
            this.height * (0.19 + band * 0.025),
            this.height * (0.34 + band * 0.028),
          )
          .fill({ color: 0xffffff, alpha: 0.035 });
    }
    this.worldLight.alpha = pulsing
      ? this.ambientLightStrength + (0.9 - this.ambientLightStrength) * lightEnvelope(this.pulseRemaining, this.pulseDuration)
      : this.ambientLightStrength;
  }

  get hasChargeAnimation(): boolean {
    return !!CHARACTER_ANIMATIONS[this.defId]?.clips.charge;
  }

  contactImpact(ms: number): boolean {
    if (!this.animator || !['attack', 'bash', 'charge_stop'].includes(this.animator.state))
      return false;
    this.animator.contactPose();
    this.animator.hold(ms);
    return true;
  }
  holdAnimation(ms: number): void {
    this.animator?.hold(ms);
  }

  playAnimation(motion: CharacterMotion, cueMs = 90): boolean {
    if(motion==='death'){this.pulseRemaining=0;this.drawWorldLight();for(const marker of this.chrome.children)if(marker.label==='prey-mark'||marker.label==='hunter-prey-mark')marker.visible=false;}
    const requestedGait = motion === 'walk' || motion === 'run';
    const authoredVertical = !!verticalAsset(this.defId) && isVerticalView(cardinalView(this.wizardDirection));
    const hasGaitProfile = shapeshifterPresentationEnabled && requestedGait;
    const originalGait = requestedGait ? locomotionClip(CHARACTER_ANIMATIONS[this.defId], motion) : null;
    if (hasGaitProfile && this.animator && (authoredVertical || originalGait)) {
      const original=originalGait && CHARACTER_ANIMATIONS[this.defId]?.clips[originalGait];
      const timing=authoredVertical ? VERTICAL_TIMING[motion as 'walk'|'run'] : original;
      if(timing)this.animator.configureGait(motion as 'walk'|'run', {
        ...timing, frameMs: !authoredVertical && motion==='run' && originalGait!=='run' ? timing.frameMs * 0.65 : timing.frameMs,
      });
    }
    const gait = hasGaitProfile && (authoredVertical || originalGait) ? motion : undefined;
    if (shapeshifterPresentationEnabled && (motion === 'walk' || motion === 'run') && !gait) return false;
    const clip = gait ?? (
      this.defId === 'shadow_wolf' && motion === 'walk'
        ? 'run'
        : this.defId === 'stone_brute' && motion === 'walk'
          ? 'walk_heavy'
          : motion);
    if (!this.animator && this.body instanceof PaintedFigure) {
      const priority = (value: CharacterMotion) =>
        value === 'death'
          ? 4
          : value === 'hit'
            ? 3
            : ['attack', 'cast', 'arrival'].includes(value)
              ? 2
              : value === 'idle'
                ? 0
                : 1;
      if (
        this.familiarMotion === 'death' ||
        (this.familiarRemaining > 0 && priority(motion) < priority(this.familiarMotion))
      )
        return false;
      this.body.setAnimationFrame(motion, 0);
      if (motion === 'cast') this.body.beginCast(cueMs);
      this.familiarMotion = motion;
      this.familiarDuration = Math.max(100, cueMs);
      this.familiarRemaining = this.familiarDuration;
      return true;
    }
    const played = this.animator?.play(clip, cueMs) ?? false;
    if (played && (CHARACTER_ANIMATIONS[this.defId]?.locomotionOnly || authoredVertical) && !['walk','run'].includes(motion)) {
      this.familiarMotion=motion;
      this.familiarDuration=Math.max(100,cueMs);
      this.familiarRemaining=this.familiarDuration;
    }
    if (played && clip === 'cast' && this.body instanceof PaintedFigure) this.body.beginCast(cueMs);
    return played;
  }

  /** Read-only presentation QA, exposed by BoardView only in development. */
  animationSnapshot() {
    return {
      defId: this.defId,
      art: this.body instanceof PaintedFigure ? 'painted' : 'vector',
      artVariant: this.body instanceof PaintedFigure ? this.body.animationVariantId : this.defId,
      animated: this.animator !== null,
      facing: this.wizardDirection,
      horizontalFacing: hasDirectionalArt(this.defId) ? undefined : this.animator?.direction,
      frame: this.animator?.frameIndex ?? 0,
      motion: this.animator?.state ?? this.familiarMotion,
      offsetX: this.figure.x,
      offsetY: this.figure.y,
      rotation: this.figure.rotation,
      scaleX: this.figure.scale.x,
      scaleY: this.figure.scale.y,
      bodyY: this.body.y,
      alpha: this.figure.alpha,
    };
  }

  get castState() {
    return this.body instanceof PaintedFigure ? this.body.castState : null;
  }
  castOrigin(): { x: number; y: number } | null {
    if (this.defId !== 'mage' || !(this.body instanceof PaintedFigure) || !this.root.parent)
      return null;
    return this.root.parent.toLocal(this.body.toGlobal(this.body.releasePoint()));
  }
  releaseCast(): void {
    if (this.body instanceof PaintedFigure) this.body.releaseCast();
  }

  private wizardDirection: WizardFacing = 'S';
  private facingLocked = false;
  get directionalFacing(): WizardFacing {
    return this.wizardDirection;
  }
  setFacingLock(locked: boolean): void {
    this.facingLocked = locked;
  }
  faceTarget(origin: Pos, target: Pos | null, attack = false): void {
    if (!hasDirectionalArt(this.defId)) {
      if (target) this.faceHorizontal(target.x - origin.x);
      return;
    }
    if (this.facingLocked && !attack) return;
    const next = wizardFacing(origin, target, this.wizardDirection, attack);
    if (next !== this.wizardDirection || !!verticalAsset(this.defId)) {
      this.wizardDirection = next;
      if (this.body instanceof PaintedFigure) this.body.setDirectionalFacing(next);
      this.aura.visible = this.defId !== 'mage' || next === 'S'; // staff tip is authored only for the original view
    }
    if (this.body instanceof PaintedFigure && target) {
      const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
      const center = (WIZARD_SECTORS.indexOf(next) * Math.PI) / 4;
      const delta = Math.atan2(Math.sin(angle - center), Math.cos(angle - center));
      this.body.trackHead(Math.sin(delta) * 0.65);
    }
  }

  faceMovement(from: Pos, to: Pos): void {
    if (hasDirectionalAtlas(this.defId) || (shapeshifterPresentationEnabled && hasDirectionalArt(this.defId))) this.faceTarget(from, to, true);
    else this.faceHorizontal(to.x - from.x);
  }

  faceHorizontal(delta: number): void {
    if (hasDirectionalArt(this.defId)) {
      if (!this.facingLocked && delta !== 0)
        this.faceTarget({ x: 0, y: 0 }, { x: delta, y: 0 }, true);
      return;
    }
    this.animator?.faceHorizontal(delta);
    if (this.animator && delta !== 0) this.applyFacing(this.animator.direction);
    if (!this.animator && delta !== 0) this.face(delta < 0 ? 'LEFT' : 'RIGHT');
  }

  face(facing: Facing): void {
    if (hasDirectionalArt(this.defId)) {
      this.faceTarget({ x: 0, y: 0 }, { x: facing === 'RIGHT' ? 1 : -1, y: 0 });
      return;
    }
    this.animator?.face(facing);
    this.applyFacing(facing);
  }

  private applyFacing(facing: Facing): void {
    this.guardianFacing = facing;
    if(this.guardianArt)this.guardianArt.scale.x=Math.abs(this.guardianArt.scale.x)*(facing==='RIGHT'?-1:1);
    if (this.body instanceof PaintedFigure) this.body.setFacing(facing);
    else
      this.body.scale.x =
        facing === 'RIGHT' ? Math.abs(this.body.scale.x) : -Math.abs(this.body.scale.x);
    this.aura.scale.x = facing === 'RIGHT' ? 1 : -1;
  }

  /** Small figure-only motion anchored at the feet. Playback retains ownership of root/body transforms. */
  stablePuzzleIdle = false;
  tick(ms: number, reduced: boolean, moving: boolean): void {
    this.healthAnimation.tick(ms, reduced);
    this.drawHealth();
    this.conditionFx.advance(this.clock, reduced);
    this.clock += ms;
    this.rootSnare?.advance(ms, reduced);
    this.selection.alpha = reduced ? 0.8 : 0.78 + Math.sin((this.clock / 2100) * Math.PI * 2) * 0.1;
    this.castRemaining = Math.max(0, this.castRemaining - ms);
    if (this.body instanceof PaintedFigure) this.body.advanceCast(ms);
    if (!(this.stablePuzzleIdle && this.animator?.state === 'idle')) this.animator?.tick(ms, reduced);
    else if (this.body instanceof PaintedFigure) this.body.setAnimationFrame('idle', 0);
    if (this.body instanceof PaintedFigure) this.body.advanceVariant(ms, reduced);
    if (this.pulseRemaining > 0) {
      this.pulseRemaining = Math.max(0, this.pulseRemaining - ms);
      if (!this.pulseRemaining) this.drawWorldLight();
      else
        this.worldLight.alpha = this.ambientLightStrength + (0.9 - this.ambientLightStrength) * lightEnvelope(this.pulseRemaining, this.pulseDuration);
    }
    const envelope = lightEnvelope(this.pulseRemaining, this.pulseDuration);
    this.worldLight.tint = blendLight(this.ambientLightColor, this.pulseColor, envelope);
    const ambientTint = litTint(this.tint, this.ambientLightColor, this.ambientLightStrength);
    this.body.tint = litTint(ambientTint, this.pulseColor, envelope);
    const phase = this.clock * 0.0018 * characterDefinition(this.defId).idle;
    if (this.body instanceof PaintedFigure) {
      const idlePhase =
        ((this.clock + this.idleTiming.offsetMs) / this.idleTiming.periodMs) * Math.PI * 2;
      this.body.breathe(
        idlePhase,
        !this.stablePuzzleIdle && !reduced &&
          !moving &&
          (this.animator ? this.animator.state === 'idle' : this.familiarMotion === 'idle'),
        !reduced && this.defId !== 'warrior',
      );
    }
    const cast =
      this.animator || reduced || moving
        ? 0
        : Math.sin((this.castRemaining / this.castDuration) * Math.PI);
    this.figure.scale.y = 1 - cast * 0.025;
    this.figure.rotation = cast * -0.025;
    if ((CHARACTER_ANIMATIONS[this.defId]?.locomotionOnly || verticalAsset(this.defId)) && moving) {
      this.figure.position.set(0,0); this.figure.scale.set(this.sizeScale); this.figure.rotation=0; this.figure.alpha=1;
    }
    if ((!this.animator || ((CHARACTER_ANIMATIONS[this.defId]?.locomotionOnly || (verticalAsset(this.defId) && isVerticalView(cardinalView(this.wizardDirection)))) && !moving && !['walk','run'].includes(this.animator.state))) && this.body instanceof PaintedFigure) {
      const wasActive = this.familiarRemaining > 0;
      this.familiarRemaining = Math.max(0, this.familiarRemaining - ms);
      if (wasActive && !this.familiarRemaining && this.familiarMotion !== 'death') {
        this.familiarMotion = 'idle';
        this.body.setAnimationFrame('idle', 0);
      }
      const t = 1 - this.familiarRemaining / this.familiarDuration;
      const pulse = reduced || !this.familiarRemaining ? 0 : Math.sin(t * Math.PI);
      const peck = this.familiarMotion === 'attack' ? pulse : 0;
      this.figure.rotation += peck * 0.13 * Math.sign(this.body.scale.x);
      const recoil = this.familiarMotion === 'hit' ? pulse : 0;
      this.figure.rotation -= recoil * 0.07;
      this.figure.alpha = this.familiarMotion === 'death' ? Math.max(0, 1 - t) : 1;
      this.figure.position.y = moving && !reduced ? -Math.abs(Math.sin(this.clock / 90)) * 2 : 0;
      this.figure.scale.y = this.sizeScale * (1 - cast * 0.025 - peck * 0.05);
      this.figure.scale.x = this.sizeScale;
      const pose = summonPose(
        this.defId,
        this.familiarMotion,
        t,
        this.clock,
        moving || this.familiarMotion === 'walk',
        reduced || (this.stablePuzzleIdle && this.familiarMotion === 'idle'),
      );
      if (pose) {
        const direction = summonFacingSign(this.defId, this.body.scale.x);
        this.figure.position.set(pose.x * direction, pose.y);
        this.figure.rotation = pose.rotation * direction;
        this.figure.scale.set(this.sizeScale, this.sizeScale * pose.scaleY);
        this.figure.alpha = pose.alpha;
      }
    }
    if (
      !this.stablePuzzleIdle && ['war_drake', 'ancient_turtle', 'ancient_wolf', 'primordial_dragon'].includes(this.defId) &&
      this.animator?.state === 'idle' &&
      !moving &&
      !reduced
    )
      this.figure.scale.y *=
        1 + Math.sin(this.clock / (this.defId === 'war_drake' ? 700 : 1200)) * 0.003;
    const shadow = contactShadow(-this.figure.y, reduced);
    this.contact.scale.set(shadow.scale);
    this.contact.alpha = shadow.alpha;
    this.aura.alpha = reduced ? 0.6 : 0.72 + Math.sin(phase * 1.4) * 0.2;
  }

  update(unit: Unit, intent: EnemyIntent | undefined, focused: boolean, phaseName?: string): void {
    this.healthAnimation.set(unit.hp, unit.maxHp, this.animateNextHealth && premiumVfxEnabled());
    this.animateNextHealth = false;
    if(phaseName && phaseName!==this.veilPhase)this.pulseLight(0xb994d5,260);
    this.veilPhase=phaseName;
    this.conditionFx.update(unit, phaseName);
    if(this.defId==='pact_golem')this.aura.visible=unit.hp>0;
    this.rootSnare?.setActive(unit.hp > 0 && unit.statuses.some(s => s.id === 'ROOTED'));
    if (CHARACTER_ANIMATIONS[this.defId]?.clips.guard)
      this.animator?.setRestMotion(
        unit.shield > 0 || unit.statuses.some((s) => s.id === 'RIPOSTE') ? 'guard' : 'idle',
      );
    const signature = JSON.stringify([
      unit.hp,
      unit.maxHp,
      unit.shield,
      unit.statuses,
      unit.combatFacing,
      unit.momentum?.value,
      unit.focus?.value,
      intent,
      focused,
      phaseName,
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    if (this.defId === 'crystal') this.drawCrystalDamage(unit.hp / unit.maxHp);
    const spec = characterSpec(this.defId);
    const r = spec.footprint * TILE,
      ry = r * 0.42;
    const hero = unit.kind === 'HERO',
      crystal = unit.kind === 'STRUCTURE';
    const color =
      unit.faction === 'ENEMY'
        ? 0xec7e77
        : hero
          ? 0x7fdaff
          : unit.kind === 'SUMMON'
            ? 0xa7dda2
            : crystal
              ? 0xe0bc72
              : 0xec7e77;
    // Contact shadow on the ground plane: wide soft pool + tight dark core under the feet.
    const sx = SHADOW_OFFSET.x * TILE,
      sy = SHADOW_OFFSET.y * TILE;
    this.base.clear();
    this.contact.clear();
    for (let band = 4; band > 0; band--)
      this.contact
        .ellipse(sx, sy, r * (0.86 + band * 0.12), ry * (0.86 + band * 0.12))
        .fill({ color: 0x07101b, alpha: 0.09 });
    this.contact.ellipse(sx * 0.5, sy * 0.5, r * 0.82, ry * 0.8).fill({ color: 0x01040a, alpha: 0.6 });
    this.contact.ellipse(0, 0, r * 0.45, ry * 0.45).fill({ color: 0x000000, alpha: 0.56 });
    if(unit.statuses.some(s=>s.id==='UNLEASHED_HUNT'||s.id==='HUNT_PURSUIT')) {
      this.base.ellipse(0,0,r*1.14,ry*1.14).stroke({color:0xb391e3,width:1.7,alpha:.65});
      for(const x of [-r*.7,0,r*.7])this.base.moveTo(x-4,8).lineTo(x,2).lineTo(x+4,8).stroke({color:0xe0b7e5,width:1.5,alpha:.75});
    }
    // Tactical ring, flattened onto the tile surface.
    this.base
      .ellipse(0, 0, r * 1.12, ry * 1.12)
      .stroke({ color, width: 1, alpha: hero ? 0.38 : 0.28 });
    this.selected = focused || (hero && unit.faction === 'PLAYER');
    this.selection.clear();
    if (this.selected) {
      for (let band = 3; band > 0; band--)
        this.selection
          .ellipse(0, 0, r * (1.03 + band * 0.07), ry * (1.03 + band * 0.07))
          .fill({ color, alpha: 0.025 });
      this.selection
        .ellipse(0, 0, r * 1.12, ry * 1.12)
        .fill({ color, alpha: 0.05 })
        .stroke({ color, width: 1.7, alpha: 0.85 });
      this.selection.ellipse(0, 0, r * 0.94, ry * 0.94).stroke({ color, width: 1, alpha: 0.22 });
    }
    if (hero && unit.faction === 'PLAYER') {
      const x = -r * 1.12 - 5;
      this.base.poly([x - 5, 0, x, -5, x + 5, 0, x, 5]).fill(color);
    }
    if (unit.shield > 0)
      this.base
        .ellipse(0, -this.height * 0.48, r * 1.25 + 6, this.height * 0.56)
        .stroke({ color: 0xf0d28b, width: 2, alpha: 0.75 });

    // Chrome: origin = just above the head.
    for (const child of this.chrome.removeChildren()) if (child !== this.healthInk) child.destroy({ children: true });
    const hpColor = hero || unit.kind === 'SUMMON' ? 0x7bcdad : crystal ? 0x80dced : 0xe77975;
    const g = new Graphics()
      .roundRect(-26, -6, 52, 7, 2)
      .fill(0x070f19)
      .stroke({ color: 0x84909c, alpha: 0.6, width: 1 });
    this.healthColor = hpColor;
    this.drawHealth();
    g.roundRect(-50, -11, 22, 17, 3)
      .fill(0x081320)
      .stroke({ color: unit.shield ? 0xf0d28b : color, alpha: 0.75, width: 1 });
    this.chrome.addChild(g, this.healthInk, text(String(unit.hp), -39, -2.5, 0xe2eaf0, 11));
    if (unit.defId === 'ancient_wolf')
      this.chrome.addChild(text('✧ ANCESTRAL', -36, -16, 0xe6cf93, 9));
    if (unit.combatFacing) this.chrome.addChild(text(({UP:'↑',DOWN:'↓',LEFT:'←',RIGHT:'→'})[unit.combatFacing], 36, -3, 0xe6c58a, 15));
    if (unit.shield) this.chrome.addChild(text(`+${unit.shield}◇`, 0, 10, 0xf0d28b, 10));
    // Three filled steel-gold notches; value remains readable without colour.
    if (unit.momentum) {
      const pips = new Graphics();
      for (let i = 0; i < unit.momentum.max; i++) {
        const x = (i - (unit.momentum.max - 1) / 2) * 9;
        pips
          .poly([x - 3.5, -17, x + 3.5, -17, x + 3.5, -11, x, -8, x - 3.5, -11])
          .fill({ color: i < unit.momentum.value ? 0xffa64d : 0x1b2430, alpha: 0.95 })
          .stroke({ color: 0xffd9a8, width: 0.8, alpha: i < unit.momentum.value ? 0.9 : 0.35 });
      }
      this.chrome.addChild(pips);
    }
    // Archer Concentración: violet arrowheads (dark moss when empty), a gold rim once all are full.
    if (unit.focus) {
      const pips = new Graphics(), full = unit.focus.value >= unit.focus.max;
      for (let i = 0; i < unit.focus.max; i++) {
        const x = (i - (unit.focus.max - 1) / 2) * 10, on = i < unit.focus.value;
        pips.poly([x, -19, x + 4, -11, x, -13, x - 4, -11])
          .fill({ color: on ? 0xb58cf2 : 0x14231a, alpha: 0.95 })
          .stroke({ color: full ? 0xe2c27a : on ? 0xeadbff : 0x4f7a43, width: full ? 1.2 : 0.9, alpha: on ? 0.95 : 0.6 });
      }
      this.chrome.addChild(pips);
    }
    if (unit.statuses.some((status) => status.id === 'RIPOSTE')) {
      const ready = new Graphics()
        .moveTo(-7, 14)
        .lineTo(7, 25)
        .moveTo(7, 14)
        .lineTo(-7, 25)
        .stroke({ color: 0xf2cf8b, width: 2 });
      this.chrome.addChild(ready);
    }
    if (markedPrey(unit)) {
      const marker = new Container(); marker.label='prey-mark';
      const frame = new Graphics().roundRect(-36,-35,72,18,3).fill({color:0x211728,alpha:.94}).stroke({color:0xc6a6ef,width:1.3});
      const rune = new Graphics().path(new GraphicsPath(ICON_PATHS.prey)).stroke({color:0xeadbff,width:1.6});
      rune.scale.set(.62);rune.position.set(-32,-34);
      marker.addChild(frame,rune,text('PRESA',9,-26,0xeadbff,9));
      this.chrome.addChild(marker);
    }
    // Archer Presa: never counts down, so a reticle badge instead of a "Presa N" countdown.
    if (unit.hp > 0 && unit.statuses.some((s) => s.id === 'PREY')) {
      const y = markedPrey(unit) ? -55 : -35;
      const marker = new Container(); marker.label = 'hunter-prey-mark';
      const frame = new Graphics().roundRect(-31, y, 62, 17, 8).fill({ color: 0x1d1430, alpha: 0.94 }).stroke({ color: 0xc8a6ff, width: 1.3 });
      const sight = new Graphics().circle(-21, y + 8.5, 5).stroke({ color: 0xeadbff, width: 1.3 })
        .moveTo(-21, y + 1.5).lineTo(-21, y + 4.5).moveTo(-21, y + 12.5).lineTo(-21, y + 15.5)
        .moveTo(-28, y + 8.5).lineTo(-25, y + 8.5).moveTo(-17, y + 8.5).lineTo(-14, y + 8.5)
        .stroke({ color: 0xe2c27a, width: 1.2 }).circle(-21, y + 8.5, 1.2).fill(0xe2c27a);
      marker.addChild(frame, sight, text('PRESA', 6, y + 8.5, 0xeadbff, 9));
      this.chrome.addChild(marker);
    }
    if (intent) {
      const badge = new Graphics()
        .roundRect(29, -12, 30, 18, 3)
        .fill(focused ? 0x913746 : 0x381f2d)
        .stroke({ color: 0xbc756f, width: 1 });
      const icon: IconName =
        intent.kind === 'MELEE_ATTACK'
          ? 'melee'
          : intent.kind === 'AREA_SPELL'
            ? 'arcane'
            : intent.kind === 'IDLE'
              ? 'wait'
              : 'move';
      const mark = new Graphics()
        .path(new GraphicsPath(ICON_PATHS[icon]))
        .stroke({ color: 0xffccc0, width: 1.8 });
      mark.scale.set(0.48);
      mark.position.set(31, -9);
      this.chrome.addChild(badge, mark);
      if ('damage' in intent)
        this.chrome.addChild(text(String(intent.damage), 51, -3, 0xffccc0, 11));
    }
    const otherStatuses=unit.statuses.filter(s=>s.id!=='MARKED_PREY'&&s.id!=='PREY');
    if(phaseName)this.chrome.addChild(text(phaseName.toLocaleUpperCase('es'),0,-40,0xd2b8ef,10));
    this.statusRow = new Container();
    this.statusRow.scale.set(this.statusScale);
    this.statusRow.position.set(0,-25);
    this.chrome.addChild(this.statusRow);
    otherStatuses.forEach((s,i)=>{
      const x = -30 + (i % 4)*29, y = -Math.floor(i/4)*17;
      const glyph=new Graphics().path(new GraphicsPath(ICON_PATHS[statusIcon(s.id)])).stroke({color:0xffdfaa,width:1.8});
      glyph.scale.set(.5);glyph.position.set(x,y-6);
      this.statusRow!.addChild(glyph, text(s.turnsLeft > 0 ? String(s.turnsLeft) : '∞',x+17,y,0xffdfaa,12));
    });
  }

  /** HP-derived crystal cracks are a pure visual response; objective state remains authoritative. */
  private drawCrystalDamage(ratio: number): void {
    const level = ratio > 0.5 ? 0 : ratio > 0.25 ? 1 : 2;
    if (level === this.crystalCrackLevel) return;
    this.crystalCrackLevel = level;
    this.crystalDamage.clear();
    if (!level) return;
    const branches = [
      [
        [-3, -106],
        [-7, -91],
        [2, -82],
        [-2, -68],
        [8, -57],
      ],
      [
        [-7, -91],
        [-17, -84],
        [-20, -72],
      ],
      [
        [2, -82],
        [13, -86],
        [18, -77],
      ],
      [
        [-2, -68],
        [-12, -60],
        [-14, -48],
      ],
      [
        [8, -57],
        [17, -51],
        [16, -39],
      ],
    ] as const;
    for (const branch of branches) {
      const [first, ...rest] = branch;
      this.crystalDamage.moveTo(first![0], first![1]);
      for (const point of rest) this.crystalDamage.lineTo(point[0], point[1]);
    }
    this.crystalDamage.stroke({ color: 0x122d47, alpha: level === 1 ? 0.76 : 0.9, width: 2.2 });
    this.crystalDamage.stroke({
      color: level === 1 ? 0x6fc7ee : 0x8ceaff,
      alpha: level === 1 ? 0.25 : 0.62,
      width: 0.8,
    });
  }

  destroy(): void {
    this.body.filters = null;
    this.clarity.destroy();
    this.chrome.destroy({ children: true });
    this.root.destroy({ children: true });
  }
}
