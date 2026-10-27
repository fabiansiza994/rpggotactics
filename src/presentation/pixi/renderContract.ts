/**
 * Character / obstacle render contract (see CHARACTER_RENDER_CONTRACT.md).
 *
 * Every sprite is placed by its GROUND ANCHOR: a normalised point in the source image where the
 * figure touches the ground (between the feet, or the centre of a base). That point is put exactly
 * on GridProjection.getUnitAnchor(cell). The body may extend freely above and sideways; logical
 * occupancy is still exactly one cell.
 */
import veilGeometry from '../assets/archerHuntGeometry.json';
export interface SpriteSpec {
  /** Normalised ground anchor inside the source image (0..1). */
  anchorX: number;
  anchorY: number;
  /** Normalised top of the visible figure inside the source image. */
  topY: number;
  /** Visible height from ground to top, in average tile widths. */
  height: number;
  /** Contact shadow radius, in tile widths. */
  footprint: number;
  /** Optional emissive point (staff tip) in normalised image space. */
  glow?: { x: number; y: number };
}

/** Average projected tile width in world units (GridProjection `tile`). */
export const TILE = 96;

/** Body art keeps its historical local space: feet at (0, FOOT_Y) inside the body container. */
export const FOOT_Y = 25;

export const CHARACTER_SPECS: Record<string, SpriteSpec> = {
  pact_golem: { anchorX:.5, anchorY:720/768, topY:168/768, height:1.35, footprint:.4 },
  // Trimmed alpha bounds normalized onto a 512×768 canvas: artwork ends at y=720.
  heart_warden: { anchorX: .5, anchorY: 720/768, topY: 40/768, height: 1.4, footprint: .4 },
  temple_architect: { anchorX: .5, anchorY: 720/768, topY: 40/768, height: 1.55, footprint: .34 },
  temple_guardian: { anchorX: .5, anchorY: .875, topY: .1875, height: 1.65, footprint: .43 },
  veil_stalker: { ...veilGeometry.veil_stalker, height: 1.18, footprint: .3 },
  veil_guardian: { ...veilGeometry.veil_guardian, height: 1.42, footprint: .4 },
  veil_beast: { ...veilGeometry.veil_beast, height: 1.5, footprint: .46 },
  veil_relic: { ...veilGeometry.veil_relic, height: 1.1, footprint: .3 },
  qa_archer: { anchorX: .5, anchorY: .875, topY: .08, height: 1.22, footprint: .3 },
  primordial_dragon: { anchorX: .5, anchorY: .95, topY: .01, height: 1.3, footprint: .43 },
  ash_hound: { anchorX:.5, anchorY:.875, topY:.14, height:.68, footprint:.3 },
  infernal_imp: { anchorX: .5, anchorY: .875, topY: .12, height: .78, footprint: .25 },
  infernal_knight: { anchorX: .5, anchorY: .875, topY: .12, height: 1.24, footprint: .36 },
  ash_shaman: { anchorX: .5, anchorY: .875, topY: .12, height: 1.16, footprint: .3 },
  magma_beast: { anchorX: .5, anchorY: .875, topY: .12, height: 1.0, footprint: .43 },
  infernal_jailer: { anchorX: .5, anchorY: .875, topY: .12, height: 1.32, footprint: .4 },
  forge_king: { anchorX: .5, anchorY: .875, topY: .12, height: 1.55, footprint: .43 },
  ancient_wolf: { anchorX: 0.5, anchorY: 0.875, topY: 0.15, height: 0.9, footprint: 0.36 },
  ancient_turtle: { anchorX: 0.5, anchorY: 0.875, topY: 0.15, height: 0.68, footprint: 0.36 },
  war_drake: { anchorX: 0.5, anchorY: 0.875, topY: 0.15, height: 0.98, footprint: 0.38 },
  warrior: { anchorX: 0.5, anchorY: 0.875, topY: 76 / 512, height: 1.3, footprint: 0.36 },
  summoner: { anchorX: 0.5, anchorY: 0.95, topY: 0.02, height: 1.26, footprint: 0.3 },
  fox: { anchorX: 0.5, anchorY: 0.93, topY: 0.03, height: 0.65, footprint: 0.3 },
  turtle: { anchorX: 0.5, anchorY: 0.93, topY: 0.03, height: 0.46, footprint: 0.36 },
  raven: { anchorX: 0.5, anchorY: 0.94, topY: 0.03, height: 0.57, footprint: 0.22 },
  wolf: { anchorX: 0.5, anchorY: 0.94, topY: 0.03, height: 0.75, footprint: 0.38 },
  chicken: { anchorX: 0.5, anchorY: 0.95, topY: 0, height: 0.55, footprint: 0.22 },
  mage: {
    anchorX: 0.47,
    anchorY: 0.965,
    topY: 0.012,
    height: 1.26,
    footprint: 0.3,
    glow: { x: 0.838, y: 0.101 },
  },
  orc_warrior: { anchorX: 0.6, anchorY: 0.97, topY: 0.008, height: 1.32, footprint: 0.36 },
  dark_shaman: {
    anchorX: 0.5,
    anchorY: 0.965,
    topY: 0.004,
    height: 1.28,
    footprint: 0.32,
    glow: { x: 0.909, y: 0.085 },
  },
  shadow_wolf: { anchorX: 0.6, anchorY: 0.9, topY: 0.073, height: 0.7, footprint: 0.42 },
  stone_brute: { anchorX: 0.55, anchorY: 0.975, topY: 0.011, height: 1.24, footprint: 0.43 },
  crystal: { anchorX: 0.5, anchorY: 0.9, topY: 0.023, height: 1.22, footprint: 0.38 },
};

export const OBSTACLE_SPECS: Record<string, SpriteSpec> = {
  pillar: { anchorX: 0.52, anchorY: 0.87, topY: 0.044, height: 1.22, footprint: 0.4 },
  rubble: { anchorX: 0.53, anchorY: 0.78, topY: 0.115, height: 0.46, footprint: 0.44 },
  ice_obstacle: { anchorX: 0.5, anchorY: 0.9, topY: 0.007, height: 0.98, footprint: 0.42 },
};

const FALLBACK: SpriteSpec = { anchorX: 0.5, anchorY: 0.95, topY: 0, height: 1.1, footprint: 0.34 };
export const characterSpec = (id: string): SpriteSpec => CHARACTER_SPECS[id] ?? FALLBACK;
export const obstacleSpec = (id: string): SpriteSpec =>
  OBSTACLE_SPECS[id === 'ice_wall' ? 'ice_obstacle' : id] ?? FALLBACK;

/** Visible height in world units, before the subtle depth scale. */
export const visualHeight = (spec: SpriteSpec, tile: number) => spec.height * tile;

/** Uniform sprite scale that maps the visible figure to its contract height. */
export const spriteScale = (spec: SpriteSpec, imageHeight: number, tile: number) =>
  visualHeight(spec, tile) / ((spec.anchorY - spec.topY) * imageHeight);

/** Tall obstacles fade when a unit stands right behind them (presentation-only occlusion aid). */
export const OCCLUDING_OBSTACLES = new Set(['pillar', 'ice_wall']);

/**
 * Key light: from above and in front of the camera, slightly from screen-right (matches the
 * majority of the Checkpoint 05 paintings: pillar, mage, shaman, crystal). Contact shadows
 * therefore fall slightly back-left. Values in tile widths.
 */
export const SHADOW_OFFSET = { x: -0.035, y: -0.012 } as const;
