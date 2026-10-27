import { SlidingAccess, ACCESS_SLIDE_MS } from './SlidingAccess';
import { templeEnvironmentTexture } from './Act3Environment';
import { Container, Graphics, MeshPlane, Texture } from 'pixi.js';
import type { Pos } from '../../game';
import type { MechanismVisual } from '../../game/domain/mechanisms/mechanism-view';
import type { GridProjection } from './GridProjection';
/** Adjacent bridge segments form one structure; never repeat a painting per tile. */
export function bridgeGroups(objects: readonly MechanismVisual[]): MechanismVisual[][] {
  const remaining = objects.filter((o) => o.kind === 'BRIDGE'),
    groups: MechanismVisual[][] = [];
  while (remaining.length) {
    const group = [remaining.shift()!];
    for (let i = 0; i < group.length; i++)
      for (let j = remaining.length - 1; j >= 0; j--) {
        const p = remaining[j]!.pos,
          q = group[i]!.pos;
        if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1) group.push(...remaining.splice(j, 1));
      }
    groups.push(group);
  }
  return groups;
}
export function structureProgress(current: number, target: number, ms: number, reduced: boolean) {
  return reduced
    ? target
    : current + Math.sign(target - current) * Math.min(Math.abs(target - current), ms / 500);
}
type Structure = {
  root: Container;
  ink: Graphics;
  panels: MeshPlane[];
  value: number;
  target: number;
  kind: 'gate' | 'bridge';
  objects: MechanismVisual[];
  proj: GridProjection;
  access?: SlidingAccess;
  front?: Container;
  occupied?: boolean;
};
export class TempleStructures {
  private items = new Map<string, Structure>();
  get busy() { return [...this.items.values()].some(s=>s.value!==s.target); }
  constructor(
    private actors: Container,
    private settled: (point: { x: number; y: number }, reduced: boolean) => void = () => {},
  ) {}
  update(
    objects: readonly MechanismVisual[],
    proj: GridProjection,
    textures: Map<string, Texture>,
    units: readonly Pos[] = [],
  ) {
    const definitions = [
      ...bridgeGroups(objects).map((group) => ({
        id: group
          .map((o) => o.id)
          .sort()
          .join(':'),
        objects: group,
        kind: 'bridge' as const,
        texture:
          textures.get('environment/bridge-v3') ??
          templeEnvironmentTexture('bridge-v3') ??
          textures.get('bridge'),
      })),
      ...objects
        .filter((o) => o.kind === 'GATE')
        .map((o) => ({
          id: o.id,
          objects: [o],
          kind: 'gate' as const,
          texture: templeEnvironmentTexture('floor-stone') ?? textures.get('gate'),
        })),
    ];
    const live = new Set(definitions.map((d) => d.id));
    for (const [id, s] of this.items)
      if (!live.has(id)) {
        s.front?.destroy({ children: true });
        s.root.destroy({ children: true });
        this.items.delete(id);
      }
    for (const d of definitions) {
      if (!d.texture) continue;
      const target =
        d.kind === 'bridge'
          ? Number(d.objects.every((o) => o.state === 'LOWERED'))
          : Number(d.objects[0]!.state === 'OPEN');
      let s = this.items.get(d.id);
      if (!s) {
        const root = new Container(),
          ink = new Graphics(),
          panels: MeshPlane[] = [];
        root.addChild(ink);
        if (d.kind === 'bridge') {
          const mesh=new MeshPlane({texture:d.texture,verticesX:2,verticesY:2});
          root.addChild(mesh);panels.push(mesh);
        }
        this.actors.addChild(root);
        s = { root, ink, panels, value: target, target, kind: d.kind, objects: d.objects, proj };
        this.items.set(d.id, s);
      }
      if (d.kind === 'bridge') s.panels[0]!.texture = d.texture;
      s.objects = d.objects;
      s.proj = proj;
      s.target = target;
      s.occupied = units.some(
        (p) =>
          Math.abs(p.x - d.objects[0]!.pos.x) < 0.6 && Math.abs(p.y - d.objects[0]!.pos.y) < 0.6,
      );
      if (d.kind === 'gate' && !s.access) {
        const front=new Container(); this.actors.addChild(front); s.front=front;
        s.access=new SlidingAccess(s.root,front);
      }
      this.draw(s);
    }
  }
  tick(ms: number, reduced: boolean) {
    for (const s of this.items.values()) {
      const value = structureProgress(s.value, s.target, ms * (s.kind === 'gate' ? 500 / ACCESS_SLIDE_MS : 1), reduced);
      if (value === s.value) continue;
      s.value = value;
      this.draw(s);
      if (value === s.target)
        this.settled(s.proj.getUnitAnchor(s.objects[0]!.pos), reduced);
    }
  }
  private draw(s: Structure) {
    const g = s.ink.clear(),
      p = s.proj,
      o = s.objects[0]!,
      tile = o.pos;
    if (s.kind === 'bridge') {
      const xs = s.objects.map((o) => o.pos.x),
        ys = s.objects.map((o) => o.pos.y),
        x = Math.min(...xs),
        y = Math.min(...ys),
        right = Math.max(...xs) + 1,
        bottom = Math.max(...ys) + 1;
      const panel = s.panels[0]!,
        near = p.project(x - 0.1, (y + bottom) / 2),
        far = p.project(right + 0.1, (y + bottom) / 2),
        width = Math.abs(far.x - near.x),
        height = (width * panel.texture.height) / panel.texture.width;
      // Native illustrated perspective; only hinge articulation deforms this authored bridge.
      const a = { x: near.x, y: near.y - height / 2 },
        b = { x: far.x, y: far.y - height / 2 },
        c = { x: near.x, y: near.y + height / 2 },
        d = { x: far.x, y: far.y + height / 2 };
      g.poly([a.x, a.y, b.x, b.y, d.x, d.y, c.x, c.y]).fill({
        color: 0x07121b,
        alpha: 1 - s.value,
      });
      const lift = (1 - s.value) * p.footprint(tile).w * 1.2;
      const raisedB = { x: a.x + (b.x - a.x) * s.value, y: a.y + (b.y - a.y) * s.value - lift };
      const raisedD = { x: c.x + (d.x - c.x) * s.value, y: c.y + (d.y - c.y) * s.value - lift };
      const buffer = panel.geometry.getAttribute('aPosition').buffer;
      buffer.data.set([a.x, a.y, raisedB.x, raisedB.y, c.x, c.y, raisedD.x, raisedD.y]);
      buffer.update();
      panel.alpha = 1;
      panel.visible = true;
      // One deck rotates about its near-bank hinge; raised is a physical structure, never absent art.
      for (const [v, w] of [
        [a, raisedB],
        [c, raisedD],
      ])
        g.moveTo(v!.x, v!.y - 5)
          .lineTo(w!.x, w!.y - 5)
          .stroke({ color: 0xc1a77a, width: 3, alpha: 0.8 });
      for (const point of [a, b, c, d])
        g.rect(point.x - 3, point.y - 9, 6, 11)
          .fill(0x716653)
          .stroke({ color: 0xaa9773, width: 1 });
      s.root.zIndex = p.depthAtPoint(p.getUnitAnchor({ x, y } as Pos)) - 2;
    } else {
      s.access?.draw(tile,s.value,p,templeEnvironmentTexture('floor-stone'));
      if(s.front) s.front.alpha=s.occupied ? 0.65 : 1;
    }
  }

  destroy() {
    for (const s of this.items.values()) {
      s.front?.destroy({ children: true });
      s.root.destroy({ children: true });
    }
    this.items.clear();
  }
}
