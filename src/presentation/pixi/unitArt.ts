import { shapeshifterPresentationEnabled } from '../shapeshifterRelease';
import { verticalAsset, verticalGeometry, isVerticalView, verticalMirror } from '../qa/locomotion/directionalProfiles';
import { locomotionClip } from './locomotion';
import { gaitGeometry, sourceFacingSign } from '../qa/locomotion/gaitGeometry';
import { Container, Graphics, GraphicsPath, MeshPlane, Sprite, type Texture } from 'pixi.js';
import { characterDefinition } from '../assets/characterDefinitions.ts';
import { paintedAnimationFrame, paintedCharacter, wizardTexture, paintedVerticalFrame } from './paintedTextures.ts';
import type { CharacterMotion, Facing } from './CharacterAnimator.ts';
import { cardinalView } from './directionalFacing';
import { CHARACTER_ANIMATIONS, hasDirectionalArt, hasDirectionalAtlas } from './characterAnimations';
import { wizardView, type WizardFacing } from './wizardFacing.ts';
import {
  wizardCastPose,
  wizardCastDisplacement,
  wizardCastHand,
  type DirectionalCastView,
} from './wizardCast.ts';
import { wizardSpriteScale } from './wizardSpriteScale.ts';
import { idleDisplacement } from './idleBreathing.ts';
import { FOOT_Y, TILE, characterSpec, spriteScale } from './renderContract.ts';

/**
 * Cloneable visual body sharing an immutable painted texture with its afterimages.
 * Local space: the ground anchor of the painting sits exactly at (0, FOOT_Y).
 */
export class PaintedFigure extends Container {
  private readonly sprite: Sprite;
  private idleMesh: MeshPlane | null = null;
  private idleVertices: Float32Array | null = null;
  private idlePose = true;
  private directional: WizardFacing | null = null;
  private motion: CharacterMotion = 'idle';
  private animationFrame = 0;
  private animationVariant: string | null = null;
  get animationVariantId(){return this.animationVariant??this.unitId;}
  private variantGhost: Sprite | null = null;
  private variantElapsed = 420;
  setAnimationVariant(id: string, animate = false) {
    if (this.animationVariantId === id) return;
    this.variantGhost?.destroy();
    this.variantGhost = null;
    if (animate && this.motion !== 'death') {
      const ghost = new Sprite(this.sprite.texture);
      ghost.anchor.copyFrom(this.sprite.anchor);
      ghost.scale.copyFrom(this.sprite.scale);
      ghost.position.copyFrom(this.sprite.position);
      this.addChild(ghost);
      this.variantGhost = ghost;
      this.variantElapsed = 0;
    }
    this.animationVariant = id;
    this.setAnimationFrame(this.motion, this.animationFrame);
  }
  /** Local skin dissolve only; never delays commands or owns combat timing. */
  advanceVariant(ms: number, reduced: boolean) {
    if (!this.variantGhost) return;
    this.variantElapsed = reduced || this.motion === 'death' ? 420 : Math.min(420, this.variantElapsed + ms);
    const progress = this.variantElapsed / 420;
    this.variantGhost.alpha = 1 - progress;
    this.sprite.alpha = progress;
    if (progress === 1) {
      this.variantGhost.destroy();
      this.variantGhost = null;
      this.sprite.alpha = 1;
    }
  }
  private castElapsed = 0;
  private castReleaseMs = 90;
  private headLean = 0;
  private headTarget = 0;
  private facing: Facing = 'RIGHT';
  constructor(
    private readonly painting: Texture,
    private readonly unitId: string,
  ) {
    super();
    const spec = characterSpec(unitId);
    const sprite = new Sprite(painting);
    sprite.scale.set(spriteScale(spec, painting.height, TILE));
    sprite.anchor.set(spec.anchorX, spec.anchorY);
    sprite.position.set(0, FOOT_Y);
    this.sprite = sprite;
    this.addChild(sprite);
  }

  /** Normalised image point (e.g. a staff tip) in this body's local space. */
  imagePoint(nx: number, ny: number): { x: number; y: number } {
    const spec = characterSpec(this.unitId),
      s = this.sprite.scale.x;
    return {
      x: (nx - spec.anchorX) * this.painting.width * s,
      y: FOOT_Y + (ny - spec.anchorY) * this.painting.height * s,
    };
  }

  setAnimationFrame(motion: CharacterMotion, frame: number): boolean {
    this.motion = motion;
    this.animationFrame = frame;
    if (CHARACTER_ANIMATIONS[this.unitId]?.locomotionOnly) this.setFacing(this.facing);
    if (motion !== 'cast') this.castElapsed = 0;
    const authoredView = this.directional ? cardinalView(this.directional) : null;
    if (verticalAsset(this.unitId) && authoredView && isVerticalView(authoredView) && motion !== 'death' && !(this.unitId === 'mage' && ['cast','attack','hit'].includes(motion))) {
      const vertical = paintedVerticalFrame(this.unitId, authoredView, motion, frame);
      const geometry = vertical && verticalGeometry(this.unitId, vertical.height);
      if (vertical && geometry) {
        if(this.sprite.texture !== vertical)this.discardIdleMesh();
        this.sprite.texture=vertical;
        this.sprite.scale.set(geometry.scale);
        this.sprite.anchor.set(0.5,geometry.anchorY);
        this.sprite.position.set(0,FOOT_Y+geometry.supportOffset);
        this.scale.x=verticalMirror(this.unitId,authoredView,motion,frame)?-1:1;
        this.sprite.visible=true;
        if(this.idleMesh)this.idleMesh.visible=false;
        this.idlePose=motion === 'idle' && ['summoner','qa_form_bear','qa_form_minotaur'].includes(this.animationVariantId);
        return true;
      }
    }

    // The Mage's side/back portraits are still static paintings, even when its
    // front atlas has an authored idle. Keep the existing breathing mesh there.
    const staticWizardIdle = this.unitId === 'mage' && this.directional !== null
      && wizardView(this.directional).view !== 'front';
    this.idlePose = motion === 'idle' && (!hasDirectionalAtlas(this.unitId) || this.unitId === 'warrior')
      && (!CHARACTER_ANIMATIONS[this.unitId]?.clips.idle?.animatedIdle || staticWizardIdle);
    this.sprite.visible = true;
    if (this.idleMesh) this.idleMesh.visible = false;
    if (this.unitId.startsWith('qa_form_') && !paintedAnimationFrame(this.unitId, motion, frame)) {
      const pose = motion === 'hit' || motion === 'death' ? motion : motion === 'attack' || motion === 'cast' ? 'attack' : 'idle';
      this.sprite.texture = paintedCharacter(`${this.unitId}:${pose}`) ?? this.painting;
      return true;
    }
    if (CHARACTER_ANIMATIONS[this.unitId]?.locomotionOnly && motion !== 'walk' && motion !== 'run') {
      if(this.sprite.texture !== this.painting)this.discardIdleMesh();
      const spec=characterSpec(this.unitId);
      this.sprite.texture=this.painting;
      this.sprite.anchor.set(spec.anchorX,spec.anchorY);
      this.sprite.scale.set(spriteScale(spec,this.painting.height,TILE));
      this.sprite.position.set(0,FOOT_Y);
      return true;
    }
    const directionalAtlas = hasDirectionalAtlas(this.unitId);
    const artMotion = shapeshifterPresentationEnabled && (motion === 'walk' || motion === 'run')
      ? (locomotionClip(CHARACTER_ANIMATIONS[this.unitId], motion) ?? motion) : motion;
    const texture = paintedAnimationFrame(
      this.animationVariantId,
      artMotion,
      motion === 'idle' && !directionalAtlas && !CHARACTER_ANIMATIONS[this.unitId]?.clips.idle?.animatedIdle ? 0 : frame,
      directionalAtlas ? cardinalView(this.directional ?? 'S') : 'front',
    );
    if (!texture) return false;
    const displayScale = TILE / (286 * 0.5);
    const view = this.directional ? wizardView(this.directional).view : 'front';
    const previousTexture = this.sprite.texture;
    this.sprite.texture =
      this.unitId === 'mage' && !directionalAtlas && (motion === 'idle' || motion === 'cast') && view !== 'front'
        ? (wizardTexture(view) ?? texture)
        : texture;
    if (this.unitId === 'mage' && !directionalAtlas && this.directional && (motion === 'idle' || motion === 'cast'))
      this.scale.x = wizardView(this.directional).mirror ? -1 : 1;
    if (previousTexture !== this.sprite.texture) this.discardIdleMesh();
    this.sprite.anchor.set(0.5, 0.875);
    this.sprite.scale.set(
      this.unitId === 'mage' ? wizardSpriteScale(this.sprite.texture.height) : (hasDirectionalAtlas(this.unitId) || CHARACTER_ANIMATIONS[this.unitId]?.locomotionOnly || this.unitId.startsWith('qa_form_')) ? spriteScale(characterSpec(this.unitId),this.sprite.texture.height,TILE) : displayScale,
    );
    const geometry = CHARACTER_ANIMATIONS[this.unitId]?.locomotionOnly
      ? gaitGeometry(this.unitId, characterSpec(this.unitId), TILE, this.sprite.texture.height)
      : null;
    if (geometry) {
      this.sprite.scale.set(geometry.scale);
      this.sprite.anchor.set(0.5, geometry.anchorY);
      this.sprite.position.set(0, FOOT_Y + geometry.supportOffset);
    } else this.sprite.position.set(0, FOOT_Y);
    return true;
  }

  private discardIdleMesh(): void {
    this.idleMesh?.destroy();
    this.idleMesh = null;
    this.idleVertices = null;
  }

  setDirectionalFacing(facing: WizardFacing): void {
    if (!hasDirectionalArt(this.unitId) || facing === this.directional) return;
    this.directional = facing;
    if (verticalAsset(this.unitId)) {
      const view=cardinalView(facing);
      if(view==='left'||view==='right')this.facing=view==='left'?'LEFT':'RIGHT';
      this.setFacing(this.facing);
      this.setAnimationFrame(this.motion,this.animationFrame);
      return;
    }
    if (hasDirectionalAtlas(this.unitId)) {
      this.scale.x = 1;
      this.setAnimationFrame(this.motion, this.animationFrame);
      return;
    }
    const { view, mirror } = wizardView(facing);
    const texture =
      view === 'front' ? paintedAnimationFrame('mage', 'idle', 0) : wizardTexture(view);
    if (!texture) return;
    this.sprite.texture = texture;
    this.sprite.anchor.set(0.5, 0.875);
    this.sprite.scale.set(wizardSpriteScale(texture.height));
    this.sprite.position.set(0, FOOT_Y);
    this.scale.x = mirror ? -1 : 1;
    this.discardIdleMesh();
  }

  beginCast(releaseMs: number): void {
    this.castElapsed = 0;
    this.castReleaseMs = Math.max(12, releaseMs);
  }
  releaseCast(): void {
    this.castElapsed = Math.max(this.castElapsed, this.castReleaseMs);
  }
  advanceCast(ms: number): void {
    if (this.motion === 'cast') this.castElapsed += Math.max(0, ms);
  }
  get castState() {
    return { motion: this.motion, elapsed: this.castElapsed, releaseMs: this.castReleaseMs };
  }

  releasePoint(): { x: number; y: number } {
    const view = (this.directional ? wizardView(this.directional).view : 'front') as
      DirectionalCastView | 'front';
    const hand = wizardCastHand(view);
    const delta =
      view === 'front'
        ? { x: 0, y: 0 }
        : wizardCastDisplacement(view, hand.x, hand.y, { anticipation: 0, release: 1 });
    return {
      x:
        (hand.x - this.sprite.anchor.x) * this.sprite.texture.width * this.sprite.scale.x + delta.x,
      y:
        this.sprite.y +
        (hand.y - this.sprite.anchor.y) * this.sprite.texture.height * this.sprite.scale.y +
        delta.y,
    };
  }

  trackHead(lean: number): void {
    this.headTarget = Math.max(-0.65, Math.min(0.65, lean));
  }

  /** Reuses the same idle-0 image; only weighted upper-body vertices move. */
  breathe(phase: number, enabled: boolean, gestures = true): void {
    const directionalCast =
      this.unitId === 'mage' &&
      this.motion === 'cast' &&
      this.directional !== null &&
      this.directional !== 'S';
    const ritualCast = this.unitId === 'summoner' && this.motion === 'cast';
    if ((!this.idlePose && !directionalCast && !ritualCast) || this.unitId === 'crystal') return;
    if (!this.idleMesh) {
      this.idleMesh = new MeshPlane({ texture: this.sprite.texture, verticesX: 33, verticesY: 33 });
      this.idleVertices = new Float32Array(
        this.idleMesh.geometry.getAttribute('aPosition').buffer.data,
      );
      this.addChild(this.idleMesh);
    }
    this.headLean += (this.headTarget - this.headLean) * 0.16;
    const mesh = this.idleMesh;
    mesh.scale.copyFrom(this.sprite.scale);
    mesh.position.set(
      this.sprite.x - this.sprite.anchor.x * this.sprite.texture.width * this.sprite.scale.x,
      this.sprite.y - this.sprite.anchor.y * this.sprite.texture.height * this.sprite.scale.y,
    );
    mesh.visible = enabled || directionalCast || ritualCast;
    this.sprite.visible = !mesh.visible;
    if (!mesh.visible) return;
    const castView = this.directional
      ? (wizardView(this.directional).view as DirectionalCastView)
      : 'side';
    const castPose = wizardCastPose(this.castElapsed, this.castReleaseMs, !gestures);
    const buffer = mesh.geometry.getAttribute('aPosition').buffer;
    const vertices = buffer.data;
    const base = this.idleVertices!;
    for (let i = 0; i < vertices.length; i += 2) {
      const delta = idleDisplacement(
        enabled ? this.animationVariantId : '',
        base[i]! / mesh.texture.width,
        base[i + 1]! / mesh.texture.height,
        phase,
      );
      const headWeight = Math.max(
        0,
        1 -
          Math.hypot(
            (base[i]! / mesh.texture.width - 0.5) / 0.2,
            (base[i + 1]! / mesh.texture.height - 0.25) / 0.18,
          ),
      );
      const castDelta = directionalCast
        ? wizardCastDisplacement(
            castView,
            base[i]! / mesh.texture.width,
            base[i + 1]! / mesh.texture.height,
            castPose,
          )
        : { x: 0, y: 0 };
      const armWeight = ritualCast
        ? Math.max(
            0,
            1 -
              Math.hypot(
                (base[i]! / mesh.texture.width - 0.36) / 0.15,
                (base[i + 1]! / mesh.texture.height - 0.34) / 0.12,
              ),
          )
        : 0;
      const ritualPulse = gestures
        ? Math.sin(Math.min(1, this.castElapsed / (this.castReleaseMs + 100)) * Math.PI)
        : 0;
      vertices[i] =
        base[i]! +
        (delta.x +
          castDelta.x +
          armWeight * ritualPulse * 2 +
          headWeight * (directionalCast ? 0 : this.headLean) * this.scale.x) /
          mesh.scale.x;
      vertices[i + 1] =
        base[i + 1]! + (delta.y + castDelta.y - armWeight * ritualPulse * 2) / mesh.scale.y;
    }
    buffer.update();
  }

  setFacing(facing: Facing): void {
    this.facing = facing;
    if(verticalAsset(this.unitId) && this.directional && isVerticalView(cardinalView(this.directional))){this.scale.x=1;return;}
    // Native artwork orientation belongs to the visual registry, not engine facing.
    const sourceSign = sourceFacingSign(this.unitId, this.motion);
    this.scale.x = (facing === 'RIGHT' ? 1 : -1) * sourceSign;
  }

  clone(): PaintedFigure {
    const copy = new PaintedFigure(this.painting, this.unitId);
    copy.sprite.texture = this.sprite.texture;
    copy.sprite.anchor.copyFrom(this.sprite.anchor);
    copy.sprite.scale.copyFrom(this.sprite.scale);
    copy.sprite.position.copyFrom(this.sprite.position);
    copy.idlePose = this.idlePose;
    copy.directional = this.directional;
    copy.motion = this.motion;
    copy.castElapsed = this.castElapsed;
    copy.castReleaseMs = this.castReleaseMs;
    if (this.idleMesh?.visible) {
      copy.breathe(0, true);
      const buffer = copy.idleMesh!.geometry.getAttribute('aPosition').buffer;
      buffer.data.set(this.idleMesh.geometry.getAttribute('aPosition').buffer.data);
      buffer.update();
    }
    copy.facing = this.facing;
    copy.position.copyFrom(this.position);
    copy.scale.copyFrom(this.scale);
    copy.pivot.copyFrom(this.pivot);
    copy.rotation = this.rotation;
    copy.alpha = this.alpha;
    copy.tint = this.tint;
    return copy;
  }
}
/** Built once per persistent view. Graphics cloning remains compatible with Grid Dash. */
export function unitArt(defId: string): Graphics | PaintedFigure {
  const painting = paintedCharacter(defId);
  if (painting) return new PaintedFigure(painting, defId);
  const art = new Graphics();
  for (const shape of characterDefinition(defId).shapes) {
    art.path(new GraphicsPath(shape.d));
    if (shape.fill !== 'none') art.fill(shape.fill);
    art.stroke({ color: shape.stroke, width: shape.width });
  }
  return art;
}
