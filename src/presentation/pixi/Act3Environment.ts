import { loadSharedTexture } from './paintedTextures';
import { TorchFlame } from './TorchFlame';
import { GUARDIAN_FLOOR, guardianOpening } from './tacticalLayers';
import { mechanismView } from '../../game/domain/mechanisms/mechanism-view';
import { Container, Graphics, Matrix, MeshPlane, Sprite, type Texture } from 'pixi.js';
import type { GameState } from '../../game';
import { pointInPolygon, type GridProjection, type Point } from './GridProjection';
import { templeComposition, templeCliffEdges } from './TempleComposition';
export const TEMPLE_ENV_ASSETS = [
  'bridge-v3',
  'wall-broken-v3',
  'wall-roots-v3',
  'floor-stone',
  'floor-ritual',
  'floor-earth',
  'floor-mechanical',
  'ruined-wall',
  'root-masonry',
  'cave-rock',
  'brazier',
  'rail-support',
  'broken-ledge',
  'ritual-inlay-v2',
  'mechanical-inlay-v2',
  'relic-inlay-v2',
  'duality-inlay-v2',
  'wall-stone-v2',
  'wall-mechanical-v2',
  'cliff-face-v2',
  'parapet-v2',
  'relic-niche-v2',
  'overhead-beam-v2',
] as const;
const textures = new Map<string, Texture>();

export function templeEnvironmentTexture(id: string) {
  return textures.get(id);
}
export function templeEnvironmentAssets(state: Readonly<GameState>): string[] {
  const place=TEMPLE_PLACES[state.scenarioId],composition=templeComposition(state);
  const ids=new Set<string>();
  if(place) {ids.add(place.material);ids.add(place.outer);}
  if(composition) {
    for(const item of [...composition.walls,...composition.dressing])ids.add(item.asset);
    if(composition.abyss)ids.add('cliff-face-v2');
  }
  if(state.mechanisms?.objects.some(o=>o.def.kind==='GATE'))ids.add('floor-stone');
  if(state.mechanisms?.objects.some(o=>o.def.kind==='BRIDGE'))ids.add('bridge-v3');
  return [...ids];
}
export async function loadTempleEnvironment(state: Readonly<GameState>): Promise<void> {
  await Promise.all(templeEnvironmentAssets(state).map(async id=>{
    if(!textures.has(id))try{textures.set(id,await loadSharedTexture(`/art/temple/environment/${id}.webp`));}
    catch{console.warn(`Temple environment unavailable: ${id}`);}
  }));
}
export const TEMPLE_PLACES: Record<
  string,
  { material: string; outer: string; props: string[]; tint: number }
> = {
  w3_e01: {
    material: 'floor-stone',
    outer: 'floor-earth',
    props: ['ruined-wall', 'root-masonry'],
    tint: 0xb6c6b5,
  },
  w3_e02: {
    material: 'floor-stone',
    outer: 'floor-earth',
    props: ['broken-ledge', 'cave-rock'],
    tint: 0x8a9ba9,
  },
  w3_e03: {
    material: 'floor-ritual',
    outer: 'floor-stone',
    props: ['ruined-wall', 'brazier'],
    tint: 0xa2b5b8,
  },
  w3_e04: {
    material: 'floor-mechanical',
    outer: 'floor-stone',
    props: ['rail-support', 'broken-ledge'],
    tint: 0x9ba6ac,
  },
  w3_e05: {
    material: 'floor-ritual',
    outer: 'floor-stone',
    props: ['ruined-wall', 'cave-rock'],
    tint: 0xadbab5,
  },
  w3_e06: {
    material: 'floor-stone',
    outer: 'floor-earth',
    props: ['cave-rock', 'root-masonry'],
    tint: 0x9facb7,
  },  // Phase 3 (floating board): material only; the rotating section draws its own mechanical plate.
  w3_e08: {
    material: 'floor-stone',
    outer: 'floor-stone',
    props: [],
    tint: 0x9facb7,
  },
  w3_e07: { material: 'floor-mechanical', outer: 'floor-stone', props: [], tint: 0x9ba6ac },
  w3_e09: { material: 'floor-ritual', outer: 'floor-stone', props: [], tint: 0xa2b5b8 },
  w3_e10: { material: 'floor-ritual', outer: 'floor-stone', props: [], tint: 0xadbab5 },
};
export function templeSurface(state: Readonly<GameState>, size: number): Graphics | null {
  const place = TEMPLE_PLACES[state.scenarioId],
    texture = place && textures.get(place.material);
  if (!texture) return null;
  const g = new Graphics(),
    matrix = new Matrix().scale((size * 4) / texture.width, (size * 4) / texture.height);
  state.board.tiles.forEach((t, i) => {
    if (
      t.terrain === 'VOID' ||
      t.terrain === 'BLOCKED' ||
      state.mechanisms?.objects.some(
        (o) =>
          o.def.kind === 'BRIDGE' &&
          o.pos.x === i % state.board.width &&
          o.pos.y === Math.floor(i / state.board.width),
      )
    )
      return;
    const x = (i % state.board.width) * size,
      y = Math.floor(i / state.board.width) * size;
    g.rect(x, y, size, size).fill({ texture, matrix });
    g.rect(x, y, size, size).fill({ color: 0x102431, alpha: 0.4 });
    g.rect(x + 0.5, y + 0.5, size - 1, size - 1).stroke({ color: 0xb2c6c2, alpha: 0.18, width: 1 });
  });
  // Architectural inlays: tied to actual mechanism coordinates, never new interactable objects.
  const ring = (x: number, y: number, r: number, color: number, alpha = 0.3) =>
    g
      .circle((x + 0.5) * size, (y + 0.5) * size, r * size)
      .stroke({ color, alpha, width: Math.max(1, size * 0.014) });
  if (state.scenarioId === 'w3_e03')
    state.mechanisms?.objects
      .filter((o) => o.def.kind === 'PRESSURE_PLATE')
      .forEach((o, i) => {
        const color = [0x66cfdd, 0xe6b46c, 0x7dc9a4][i % 3]!;
        ring(o.pos.x, o.pos.y, 0.68, color);
        ring(o.pos.x, o.pos.y, 0.78, color, 0.16);
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4,
            cx = (o.pos.x + 0.5) * size,
            cy = (o.pos.y + 0.5) * size;
          g.moveTo(cx + Math.cos(a) * size * 0.7, cy + Math.sin(a) * size * 0.7)
            .lineTo(cx + Math.cos(a) * size * 0.77, cy + Math.sin(a) * size * 0.77)
            .stroke({ color, alpha: 0.4, width: 2 });
        }
      });
  if (state.scenarioId === 'w3_e05') {
    ring(GUARDIAN_FLOOR.x - 0.5, GUARDIAN_FLOOR.y - 0.5, 1.6, 0x9e9672, 0.3);
    ring(GUARDIAN_FLOOR.x - 0.5, GUARDIAN_FLOOR.y - 0.5, 1.8, 0x948867, 0.18);
    for (const o of state.mechanisms?.objects.filter((o) =>
      ['SWITCH', 'PRESSURE_PLATE'].includes(o.def.kind),
    ) ?? []) {
      g.moveTo((o.pos.x + 0.5) * size, (o.pos.y + 0.5) * size)
        .lineTo(GUARDIAN_FLOOR.x * size, GUARDIAN_FLOOR.y * size)
        .stroke({ color: 0x8d957f, alpha: 0.25, width: size * 0.045 });
    }
  }
  if (state.scenarioId === 'w3_e06') {
    g.rect(8 * size, 2.8 * size, 2 * size, 1.4 * size).fill({ color: 0xd4a25d, alpha: 0.12 });
    for (const o of state.mechanisms?.objects.filter((o) => o.def.id.startsWith('rune-')) ?? []) {
      ring(o.pos.x, o.pos.y, 0.7, o.def.id.includes('sun') ? 0xd0ad64 : 0x8bb7d1, 0.38);
    }
  }
  // Pools belong to the room lighting rather than to the tactical grid.
  for (const x of [1, state.board.width - 2])
    for (let band = 3; band > 0; band--)
      g.circle((x + 0.5) * size, 0, size * (0.6 + band * 0.28)).fill({
        color: 0xe2a25c,
        alpha: 0.02,
      });
  return g;
}
/** A scene composition around the real grid. No collision, RNG, input or simulation lives here. */
export class Act3Environment {
  readonly back = new Container({ eventMode: 'none' });
  readonly floor = new Container({ eventMode: 'none' });
  readonly foreground = new Container({ eventMode: 'none' });
  private props: Container[] = [];
  private flames: TorchFlame[] = [];
  private occluders: { root: Container; polygon: Point[]; depth: number }[] = [];
  private focus: Graphics | null = null;
  private conduit: {
    ink: Graphics;
    proj: GridProjection;
    value: number;
    target: number;
    drawn?: number;
  } | null = null;
  constructor(private actors: Container) {}
  private plane(
    asset: string,
    a: Point,
    b: Point,
    height: number,
    layer: Container,
    tint = 0xffffff,
  ) {
    const texture = textures.get(asset);
    if (!texture) return null;
    const sprite = new Sprite(texture);
    const width = Math.min(
      (height * texture.width) / texture.height,
      Math.hypot(b.x - a.x, b.y - a.y),
    );
    sprite.anchor.set(0.5, 1);
    sprite.width = width;
    sprite.height = (width * texture.height) / texture.width;
    sprite.position.set((a.x + b.x) / 2, (a.y + b.y) / 2);
    sprite.tint = tint;
    sprite.eventMode = 'none';
    layer.addChild(sprite);
    const left = sprite.x - width / 2,
      right = sprite.x + width / 2,
      top = sprite.y - sprite.height;
    return {
      mesh: sprite,
      polygon: [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: sprite.y },
        { x: left, y: sprite.y },
      ],
    };
  }

  private stamp(asset: string, center: Point, radius: number, proj: GridProjection, alpha = 0.84) {
    const texture = textures.get(asset);
    if (!texture) return;
    const points = [
      proj.project(center.x - radius, center.y - radius),
      proj.project(center.x + radius, center.y - radius),
      proj.project(center.x - radius, center.y + radius),
      proj.project(center.x + radius, center.y + radius),
    ];
    const mesh = new MeshPlane({ texture, verticesX: 2, verticesY: 2 }),
      buffer = mesh.geometry.getAttribute('aPosition').buffer;
    buffer.data.set(points.flatMap((p) => [p.x, p.y]));
    buffer.update();
    mesh.alpha = alpha;
    this.floor.addChild(mesh);
  }
  configure(state: Readonly<GameState>, proj: GridProjection) {
    this.floor.mask = null;
    for (const root of [this.back, this.floor, this.foreground])
      for (const child of root.removeChildren()) child.destroy({ children: true });
    for (const prop of this.props) prop.destroy({ children: true });
    this.props = [];
    this.flames = [];
    this.occluders = [];
    this.focus = null;
    this.conduit = null;
    const place = TEMPLE_PLACES[state.scenarioId],
      composition = templeComposition(state);
    if (!place || !composition) return;
    // Floating tactical board (direction reset): no ground plane around the grid. The platform
    // (arenaArt.drawPlatform) and the shared abyss background carry the silhouette.
    const { width: w, height: h } = state.board;
    if (composition.abyss) {
      const ink = new Graphics();
      state.board.tiles.forEach((t, i) => {
        if (t.terrain !== 'BLOCKED' && t.terrain !== 'VOID') return;
        const points = proj.getTilePolygon({ x: i % w, y: Math.floor(i / w) });
        ink.poly(points.flatMap((p) => [p.x, p.y])).fill(0x020b16);
      });
      this.back.addChild(ink);
      for (const edge of templeCliffEdges(state)) {
        const a = proj.project(edge.from.x, edge.from.y),
          b = proj.project(edge.to.x, edge.to.y),
          depth = proj.tileWidthAtY(a.y) * 1.45;
        // Invert the cliff face so its lip stays on the bank and its rock descends into the ravine.
        const texture = textures.get('cliff-face-v2');
        if (!texture) continue;
        const face = new MeshPlane({ texture, verticesX: 2, verticesY: 2 }),
          buf = face.geometry.getAttribute('aPosition').buffer;
        const slant = Math.abs(a.x - b.x) < 12 ? proj.tile * 0.25 : 0;
        buf.data.set([
          a.x - slant,
          a.y,
          b.x + slant,
          b.y,
          a.x - slant,
          a.y + depth,
          b.x + slant,
          b.y + depth,
        ]);
        buf.update();
        face.tint = 0x758b98;
        this.back.addChild(face);
      }
    }
    // Static, bounded bands outside the real footprint. No fog covers tactical tile states.
    const atmosphere = new Graphics();
    const quad = (x0:number,y0:number,x1:number,y1:number,color:number,alpha:number) => {
      const points = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].flatMap(([x,y]) => {
        const p=proj.project(x!,y!); return [p.x,p.y];
      });
      atmosphere.poly(points).fill({color,alpha});
    };
    for (let band=0;band<12;band++) {
      const inner=band*0.12, outer=(band+1)*0.12;
      const strength=(1-band/12);
      for (const [x0,y0,x1,y1] of [
        [-outer,-outer,w+outer,-inner],[-outer,h+inner,w+outer,h+outer],
        [-outer,-inner,-inner,h+inner],[w+inner,-inner,w+outer,h+inner],
      ]) {
        quad(x0!,y0!,x1!,y1!,0x02090d,strength*0.32);
        if (band>3) quad(x0!,y0!,x1!,y1!,0x73928f,strength*0.045);
      }
    }
    this.back.addChild(atmosphere);
    for (const span of composition.walls) {
      const a = proj.project(span.from.x, span.from.y),
        b = proj.project(span.to.x, span.to.y),
        vertical = Math.abs(span.to.y - span.from.y) > Math.abs(span.to.x - span.from.x);
      if (vertical) {
        a.x -= proj.tile * 0.14;
        b.x += proj.tile * 0.14;
      }
      const root = new Container({ eventMode: 'none' }),
        height = proj.tile * span.height;
      const art = this.plane(span.asset, a, b, height, root, span.foreground ? 0xa1aaa0 : 0xc7c7b4);
      if (!art) {
        root.destroy();
        continue;
      }
      root.zIndex = Math.max(proj.depthAtPoint(a), proj.depthAtPoint(b)) - 0.3;
      if (span.asset === 'wall-stone-v2') {
        const flame=new TorchFlame(this.flames.length*1.7);
        flame.position.set(art.mesh.x+art.mesh.width*0.062,art.mesh.y-art.mesh.height*0.52);
        flame.scale.set(art.mesh.height/280); root.addChild(flame);this.flames.push(flame);
      }
      this.actors.addChild(root);
      this.props.push(root);
      this.occluders.push({ root, polygon: art.polygon, depth: root.zIndex });
    }
    for (const item of composition.dressing) {
      const t = textures.get(item.asset);
      if (!t) continue;
      const sprite = new Sprite(t),
        point = proj.project(item.at.x + 0.5, item.at.y + 0.5),
        width = proj.tileWidthAtY(point.y) * item.width;
      sprite.anchor.set(0.5, 1);
      sprite.width = width;
      sprite.height = (width * t.height) / t.width;
      sprite.position.set(point.x, point.y);
      sprite.zIndex = proj.depthAtPoint(point) - (item.behind ? proj.tile * 1.4 : 0);
      sprite.tint = item.tint ?? place.tint;
      sprite.eventMode = 'none';
      this.actors.addChild(sprite);
      this.props.push(sprite);
      if (item.asset === 'brazier') {
        const flame=new TorchFlame(this.flames.length*1.7);
        flame.position.set(point.x,point.y-sprite.height*0.71);flame.scale.set(sprite.height/140);
        flame.zIndex=sprite.zIndex+0.1;this.actors.addChild(flame);this.props.push(flame);this.flames.push(flame);
      }
      this.occluders.push({
        root: sprite,
        polygon: [
          { x: point.x - width * 0.5, y: point.y - sprite.height },
          { x: point.x + width * 0.5, y: point.y - sprite.height },
          { x: point.x + width * 0.5, y: point.y },
          { x: point.x - width * 0.5, y: point.y },
        ],
        depth: sprite.zIndex,
      });
    }
    if (state.scenarioId === 'w3_e03')
      for (const o of state.mechanisms?.objects.filter((o) => o.def.kind === 'PRESSURE_PLATE') ??
        [])
        this.stamp('ritual-inlay-v2', { x: o.pos.x + 0.5, y: o.pos.y + 0.5 }, 1.05, proj, 0.78);
    if (state.scenarioId === 'w3_e05')
      this.stamp('mechanical-inlay-v2', GUARDIAN_FLOOR, GUARDIAN_FLOOR.radius, proj, 0.88);
    if (state.scenarioId === 'w3_e04')
      this.stamp('mechanical-inlay-v2', { x: 1.5, y: 2.5 }, 1.3, proj, 0.5);
    if (state.scenarioId === 'w3_e06') {
      this.stamp('relic-inlay-v2', { x: 9, y: 3.5 }, 1.2, proj, 0.85);
      this.stamp('duality-inlay-v2', { x: 6.5, y: 3.5 }, 0.62, proj, 0.35);
    }
    // Blend only the art at the footprint rim. Terrain, exits and units render ABOVE this shade.
    const edgeShade = new Graphics();
    for (let band=0;band<10;band++) {
      const a=band*0.045,b=(band+1)*0.045;
      for (const [x0,y0,x1,y1] of [[a,a,w-a,b],[a,h-b,w-a,h-a],[a,b,b,h-b],[w-b,b,w-a,h-b]]) {
        const points=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].flatMap(([x,y])=>{const p=proj.project(x!,y!);return [p.x,p.y];});
        edgeShade.poly(points).fill({color:0x081116,alpha:(1-band/10)*0.38});
      }
    }
    this.floor.addChild(edgeShade);
    const floorMask = new Graphics();
    state.board.tiles.forEach((t, i) => {
      if (t.terrain === 'BLOCKED' || t.terrain === 'VOID') return;
      floorMask
        .poly(proj.getTilePolygon({ x: i % w, y: Math.floor(i / w) }).flatMap((p) => [p.x, p.y]))
        .fill(0xffffff);
    });
    this.floor.addChild(floorMask);
    this.floor.mask = floorMask;
    if (state.scenarioId === 'w3_e05' || state.scenarioId === 'w3_e06') {
      const ink = new Graphics(),
        target = state.scenarioId === 'w3_e05' ? GUARDIAN_FLOOR : { x: 9.2, y: 3.5 };
      const ring = Array.from({ length: 48 }, (_, i) =>
        proj.project(
          target.x +
            Math.cos((i * Math.PI) / 24) *
              (state.scenarioId === 'w3_e05' ? GUARDIAN_FLOOR.radius : 1.75),
          target.y +
            Math.sin((i * Math.PI) / 24) *
              (state.scenarioId === 'w3_e05' ? GUARDIAN_FLOOR.radius : 1.75),
        ),
      );
      ink
        .poly(ring.flatMap((p) => [p.x, p.y]))
        .fill({ color: state.scenarioId === 'w3_e05' ? 0x58d8d8 : 0xe5b353, alpha: 0.14 })
        .stroke({
          color: state.scenarioId === 'w3_e05' ? 0x90eee4 : 0xf2cc77,
          alpha: 0.35,
          width: 2,
        });
      ink.visible = false;
      this.floor.addChild(ink);
      this.focus = ink;
    }
    if (state.scenarioId === 'w3_e05') {
      const ink = new Graphics();
      this.floor.addChild(ink);
      const value = guardianOpening(state, mechanismView(state)?.guardians[0]);
      this.conduit = { ink, proj, value, target: value };
    }
    this.react(state);
    this.tick(0, true);
  }
  react(state: Readonly<GameState>) {
    if (this.conduit)
      this.conduit.target = guardianOpening(state, mechanismView(state)?.guardians[0]);
    if (this.focus)
      this.focus.visible =
        state.scenarioId === 'w3_e05'
          ? (mechanismView(state)?.guardians.some((g) => g.state === 'EXPOSED') ?? false)
          : !!state.mechanisms?.objects.some(
              (o) => o.def.kind === 'RELIC' && ['CARRIED', 'EXTRACTED'].includes(o.state),
            );
  }
  tick(ms: number, reduced: boolean) {
    for (const flame of this.flames) flame.tick(ms,reduced);
    const c = this.conduit;
    if (!c) return;
    c.value = reduced
      ? c.target
      : c.value + Math.sign(c.target - c.value) * Math.min(Math.abs(c.target - c.value), ms / 550);
    if (c.drawn === c.value) return;
    c.drawn = c.value;
    const g = c.ink.clear(),
      { x, y, radius } = GUARDIAN_FLOOR;
    // Physical floor segments retract radially; the same projection and anchor own base and FX.
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + 0.035,
        b = ((i + 1) * Math.PI) / 4 - 0.035;
      const inner = 0.22 + c.value * 0.7,
        outer = radius * 0.72 + c.value * 0.12;
      const points = [
        [a, inner],
        [a, outer],
        [b, outer],
        [b, inner],
      ].map(([angle, r]) => c.proj.project(x + Math.cos(angle!) * r!, y + Math.sin(angle!) * r!));
      g.poly(points.flatMap((p) => [p.x, p.y]))
        .fill({ color: 0x17252d, alpha: 0.65 })
        .stroke({ color: c.value ? 0x74e5df : 0x827d67, alpha: 0.45 + c.value * 0.45, width: 2 });
    }
    const center = c.proj.project(x, y),
      edge = c.proj.project(x + 0.18 + c.value * 0.65, y);
    g.ellipse(
      center.x,
      center.y,
      Math.abs(edge.x - center.x),
      Math.abs(edge.x - center.x) * 0.45,
    ).fill({ color: 0x76e4df, alpha: c.value * 0.48 });
  }
  updateOcclusion(
    units: readonly { x: number; y: number; alpha: number }[],
    proj: GridProjection,
    ms: number,
  ) {
    const blend = Math.min(1, ms / 90);
    for (const o of this.occluders) {
      const behind = units.some(
        (u) =>
          u.alpha > 0.05 &&
          proj.depthAtPoint(u) < o.depth &&
          pointInPolygon({ x: u.x, y: u.y - proj.tile * 0.62 }, o.polygon),
      );
      const target = behind ? 0.42 : 1;
      o.root.alpha += (target - o.root.alpha) * blend;
    }
  }
  destroy() {
    for (const p of this.props) p.destroy({ children: true });
    this.props = [];
    this.flames = [];
    this.occluders = [];
    for (const root of [this.back, this.floor, this.foreground]) root.destroy({ children: true });
  }
}
