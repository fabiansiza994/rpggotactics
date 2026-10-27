import { loadSharedTexture } from './paintedTextures';
import { mechanismCallout } from '../mechanisms/finalReadability';
import { TemporaryHint } from '../mechanisms/TemporaryHint';
import { TempleStructures } from './TempleStructures';
import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { templeArt, platformProgress } from '../mechanisms/phase2Presentation';
import type { UnitView } from './UnitView';
import type { GameEvent } from '../../game';
import type { BoardViewModel } from './viewModel';
import type { GridProjection } from './GridProjection';
const GLYPHS: Record<string, string> = {
  SWITCH: '↯',
  PRESSURE_PLATE: '◎',
  GATE: '門',
  BRIDGE: '═',
  STATUE: '↔',
  RELIC: '✧',
  TRAP: '△',
};
type Item = {
  root: Container;
  art: Sprite;
  mark: Text;
  last: string;
  elapsed: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  pulse: Graphics;
  cueMs: number;
  cueColor: number;
  gate: number;
  target: number;
};
/** Presentation-only sprites. The same actor layer/projection as units owns depth and anchors. */
export class MechanismLayer {
  rootFor(id: string): Container | undefined { return this.items.get(id)?.root; }
  private disposed = false;
  private labelScale = 1;
  setLabelScale(scale: number) {
    this.labelScale = Math.max(1, scale);
    for (const item of this.items.values()) item.mark.scale.set(Math.max(1, scale));
  }
  private hint = new TemporaryHint();
  private hintScenario = "";
  destroy() {
    this.disposed = true;
    this.vm = null;
    this.items.clear();
    this.rides.clear();
    this.structures.destroy();
  }
  private items = new Map<string, Item>();
  private textures = new Map<string, Texture>();
  private preparing = new Map<string,Promise<void>>();
  async prepare(vm: BoardViewModel): Promise<void> {
    const ids=new Set((vm.mechanisms?.objects??[]).filter(o=>o.kind!=='REGION').map(templeArt));
    if(vm.mechanisms?.objects.some(o=>o.kind==='BRIDGE'))ids.add('environment/bridge-v3');
    await Promise.all([...ids].map(id=>{
      if(this.textures.has(id))return;
      const pending=this.preparing.get(id);if(pending)return pending;
      const job=loadSharedTexture(`/art/temple/${id}.webp`).then(t=>{if(!this.disposed)this.textures.set(id,t);}).catch(()=>{console.warn(`Temple art unavailable: ${id}`);}).finally(()=>this.preparing.delete(id));
      this.preparing.set(id,job);return job;
    }));
  }
  private vm: BoardViewModel | null = null;
  private proj: GridProjection | null = null;
  private rides = new Map<
    string,
    { from: { x: number; y: number }; to: { x: number; y: number }; elapsed: number; platform: boolean }
  >();
  occlusionAnchors(){return (this.vm?.mechanisms?.objects??[]).filter(o=>o.interactable&&o.state!=='EXTRACTED').flatMap(o=>{const root=this.items.get(o.id)?.root;return root?[root]:[];});}
  gateAnchors(){return (this.vm?.mechanisms?.objects??[]).filter(o=>o.kind==='GATE').flatMap(o=>{const root=this.items.get(o.id)?.root;return root?[root]:[];});}
  get busy() {
    return this.rides.size > 0 || this.structures.busy;
  }
  ownsPosition(id: string) {
    return this.rides.has(id);
  }
  private structures: TempleStructures;
  constructor(
    private actors: Container,
    private unit: (id: string) => UnitView | undefined,
    private onPlatformArrival: (point:{x:number;y:number},reduced:boolean)=>void = ()=>{},
  ) { this.structures = new TempleStructures(actors, (point,reduced)=>this.onPlatformArrival(point,reduced)); }

  update(vm: BoardViewModel, proj: GridProjection) {
    if (this.disposed) return;
    if (this.hintScenario !== vm.state.scenarioId) { this.hintScenario = vm.state.scenarioId; this.hint = new TemporaryHint(); }
    this.vm = vm;
    this.proj = proj;
    if (!vm.mechanisms) {
      this.structures.update([], proj, this.textures);
      for (const i of this.items.values()) i.root.destroy({ children: true });
      this.items.clear();
      return;
    }
    this.structures.update(vm.mechanisms.objects, proj, this.textures, vm.state.units.map(u=>u.pos));
    const liveIds = new Set(vm.mechanisms.objects.map((o) => o.id));
    for (const [id, item] of this.items)
      if (!liveIds.has(id)) {
        item.root.destroy({ children: true });
        this.items.delete(id);
      }
    for (const object of vm.mechanisms.objects) {
      // Rotating sections are drawn whole by RotatingSections, never as a tile sprite.
      if (object.kind === 'REGION') continue;
      let item = this.items.get(object.id);
      const p = proj.getUnitAnchor(object.pos);
      const width = proj.footprint(object.pos).w;
      if (!item) {
        const root = new Container();
        const art = new Sprite();
        art.anchor.set(0.5, 1);
        const mark = new Text({
          text: '',
          style: {
            fontSize: 14,
            fill: 0xe8d59c,
            fontWeight: 'bold',
            stroke: { color: 0x07111c, width: 3 },
          },
        });
        mark.anchor.set(0.5);
        const pulse = new Graphics();
        root.addChild(pulse, art, mark);
        this.actors.addChild(root);
        item = {
          root,
          art,
          mark,
          pulse,
          cueMs: 0,
          cueColor: 0xffd77a,
          last: '',
          elapsed: 500,
          from: p,
          to: p,
          gate: 0,
          target: 0,
        };
        this.items.set(object.id, item);
      }
      const key = `${object.state}:${object.visualState}:${object.pos.x},${object.pos.y}`;
      if (item.last === key) {
        item.to = p;
        if (item.elapsed >= 500) item.from = p;
      }
      if (item.last !== key) {
        item.from = { x: item.last ? item.root.x : p.x, y: item.last ? item.root.y : p.y };
        item.to = p;
        item.elapsed = item.last ? 0 : 500;
        item.last = key;
      }
      const texture = this.textures.get(templeArt(object));
      item.art.visible = !!texture && object.kind !== 'BRIDGE' && object.kind !== 'GATE';
      if (texture) item.art.texture = texture;
      const floor = ['PRESSURE_PLATE', 'BRIDGE', 'TRAP', 'PLATFORM'].includes(object.kind);
      item.art.anchor.set(0.5, floor ? 0.5 : 1);
      item.art.width =
        width *
        (object.kind === 'PLATFORM' ? 0.98 : object.kind === 'GATE' ? 1.05 : floor ? 0.86 : 0.8);
      item.art.height = floor
        ? object.kind === 'PLATFORM'
          ? proj.footprint(object.pos).h * 0.95
          : width * 0.43
        : item.art.width * (texture ? texture.height / texture.width : 1.15);
      item.target =
        (object.kind === 'GATE' && object.state === 'OPEN') ||
        (object.kind === 'BRIDGE' && object.state === 'RAISED')
          ? 1
          : 0;
      item.art.alpha = ['COLLECTED', 'EXTRACTED'].includes(object.state)
        ? 0.18
        : object.kind === 'BRIDGE' && object.state === 'RAISED'
          ? 0.22
          : 1;
      item.art.tint =
        object.kind==='TRAP' && object.state==='ENABLED' ? 0xffb37a : object.visualState === 'locked'
          ? 0xffd77a
          : object.visualState === 'active'
            ? 0xffe4a1
            : 0xc5e7e4;
      item.mark.text =
        object.kind==='TRAP' ? (object.state==='ENABLED'?'!':'△') : object.id === 'rune-sun'
          ? '☀'
          : object.id === 'rune-moon'
            ? '☾'
            : object.kind === 'PLATFORM'
              ? '⬡' : object.kind === 'PRESSURE_PLATE' ? '◎ Mantén peso' : object.kind === 'STATUE' ? '↔ Empuja esta estatua' : object.kind === 'RELIC' ? '✧ Recoge la reliquia'
              : object.state === 'COLLECTED'
                ? '✓'
                : object.visualState === 'pending'
                  ? '◷'
                  : object.visualState === 'locked'
                    ? '◆'
                    : object.visualState === 'active'
                      ? '✦'
                      : (GLYPHS[object.kind] ?? '◇');
      item.mark.eventMode = 'none';
      item.mark.scale.set(this.labelScale);
      const callout = mechanismCallout(object, vm.mechanisms);
      item.mark.style.fontSize = callout ? 18 : 14;
      if (this.hint.visible && callout) item.mark.text = callout;
      if (object.id === 'rune-sun' || object.id === 'rune-moon') {
        item.mark.text = object.id === 'rune-sun' ? '☀ SOL' : '☾ LUNA';
        item.mark.alpha = 1;
      }
      const ring = vm.mechanisms.rings.find(r => r.ids.includes(object.id));
      if (ring && ring.live !== object.id) item.art.alpha *= 0.35;
      if (ring?.live === object.id) { item.mark.text = '↯ CONTROL ACTIVO'; item.art.tint = 0xffdc92; }
      item.mark.visible = object.kind !== 'BRIDGE' && (!['STATUE','PRESSURE_PLATE','RELIC'].includes(object.kind) || this.hint.visible);
      item.mark.alpha = object.id === 'rune-sun' || object.id === 'rune-moon' ? 1 : callout ? this.hint.opacity : 1;
      item.mark.y = floor ? -8 : -item.art.height * 0.8;
      item.mark.style.fill =
        object.visualState === 'active' || object.visualState === 'locked' ? 0xffd56d : 0x9de6df;
      item.root.zIndex = proj.depthAtPoint(p) - (floor ? 2 : 0);
      if (object.state === 'CARRIED') item.art.width = width * 0.28;
      if (object.state === 'CARRIED') item.art.height = width * 0.35;
      if (item.elapsed >= 500) item.root.position.set(p.x, p.y);
    }
  }
  playEvents(events: readonly GameEvent[]) {
    if (events.some(e => e.type === 'UNIT_MOVED' || (e.type === 'MECHANISM_CHANGED' && e.cue === 'STATUE_PUSHED'))) this.hint.dismiss();
    for (const event of events) {
      if (event.type === 'GUARDIAN_STATE') {
        this.unit(event.unitId)?.pulseLight(
          event.cue === 'GUARDIAN_EXPOSED' ? 0xffd777 : 0x77cdd2,
          500,
        );
        continue;
      }
      if (event.type !== 'MECHANISM_CHANGED') continue;
      if (event.cue === 'PLATFORM_MOVED' && event.from && this.proj) {
        const delta = { x: event.pos.x - event.from.x, y: event.pos.y - event.from.y };
        for (const id of [event.mechanismId, ...(event.carriedIds ?? [])]) {
          const pos =
            this.vm?.state.units.find((u) => u.id === id)?.pos ??
            this.vm?.mechanisms?.objects.find((o) => o.id === id)?.pos;
          const teleport = events.find((e) => e.type === 'UNIT_TELEPORTED' && e.unitId === id);
          const from =
            id === event.mechanismId
              ? event.from
              : teleport?.type === 'UNIT_TELEPORTED'
                ? teleport.from
                : pos;
          if (!from) continue;
          this.rides.set(id, {
            from: this.proj.getUnitAnchor(from),
            to: this.proj.getUnitAnchor({ x: from.x + delta.x, y: from.y + delta.y }),
            elapsed: 0,
            platform:id===event.mechanismId,
          });
        }
      }
      const item = this.items.get(event.mechanismId);
      if (!item) continue;
      item.cueMs = 500;
      item.cueColor = ['TRAP_FIRED', 'PLATFORM_BLOCKED'].includes(event.cue) ? 0xf08855 : 0xffd77a;
    }
  }
  tick(ms: number, reduced: boolean) {
    this.hint.tick(ms);
    for (const object of this.vm?.mechanisms?.objects ?? []) {
      const item = this.items.get(object.id);
      if (item && this.vm?.mechanisms && mechanismCallout(object, this.vm.mechanisms)) {
        item.mark.alpha = this.hint.opacity;
      }
    }
    if (!this.hint.visible) for (const object of this.vm?.mechanisms?.objects ?? []) {
      if (['STATUE','PRESSURE_PLATE','RELIC','SWITCH'].includes(object.kind) && !this.vm?.mechanisms?.rings.some(r=>r.live===object.id)) { const item = this.items.get(object.id); if (item) item.mark.visible = false; }
    }
    this.structures.tick(ms, reduced);
    for (const guardian of this.vm?.mechanisms?.guardians ?? [])
      this.unit(guardian.unitId)?.setGuardianArt(
        this.textures.get(guardian.state === 'EXPOSED' ? 'guardian-exposed' : 'guardian-fortified'),
        guardian.state === 'EXPOSED',
      );
    for (const item of this.items.values()) {
      item.pulse.clear();
      if (item.cueMs > 0) {
        item.cueMs = Math.max(0, item.cueMs - ms);
        const progress = 1 - item.cueMs / 500;
        item.pulse
          .ellipse(
            0,
            -5,
            item.art.width * (reduced ? 0.5 : 0.3 + progress * 0.4),
            item.art.width * 0.18,
          )
          .stroke({ color: item.cueColor, width: 3, alpha: item.cueMs / 500 });
      }
      item.elapsed = Math.min(500, item.elapsed + (reduced ? 500 : ms));
      const t = 1 - Math.pow(1 - item.elapsed / 500, 3);
      item.root.alpha = 0.65 + 0.35 * t;
      item.root.position.set(
        item.from.x + (item.to.x - item.from.x) * t,
        item.from.y + (item.to.y - item.from.y) * t,
      );
      item.gate = reduced
        ? item.target
        : item.gate + (item.target - item.gate) * Math.min(1, ms / 100);
      item.art.y = -item.gate * 35;
      if (item.target) item.art.alpha = 0.25;
    }
    for (const [id, ride] of this.rides) {
      ride.elapsed = Math.min(700, ride.elapsed + (reduced ? 700 : ms));
      const t = platformProgress(ride.elapsed, reduced);
      const root = this.unit(id)?.root ?? this.items.get(id)?.root;
      root?.position.set(
        ride.from.x + (ride.to.x - ride.from.x) * t,
        ride.from.y + (ride.to.y - ride.from.y) * t,
      );
      if (ride.elapsed >= 700) {
        if(ride.platform)this.onPlatformArrival(ride.to,reduced);
        this.rides.delete(id);
      }
    }
    for (const object of this.vm?.mechanisms?.objects ?? [])
      if (object.carrier) {
        const carrier = this.unit(object.carrier),
          item = this.items.get(object.id);
        if (carrier && item) {
          item.root.position.set(carrier.root.x + 22, carrier.root.y - 35);
          item.root.zIndex = carrier.root.zIndex + 1;
        }
      }
  }
}

export function drawMechanisms(g: Graphics, proj: GridProjection, vm: BoardViewModel) {
  const view = vm.mechanisms;
  if (!view) return;
  for (const object of view.objects) {
    if (object.kind === 'PLATFORM') {
      const stops = object.stops ?? [];
      for (let i = 0; i < stops.length; i++)
        for (const tile of stops[i]!.tiles) {
          g.poly(proj.getInsetPolygon(tile, 0.09).flatMap((p) => [p.x, p.y])).stroke({
            color: 0xb5a16c,
            width: 2,
            alpha: 0.7,
          });
          if (i > 0 && stops[i - 1]?.tiles[0]) {
            const a = proj.getTileCenter(stops[i - 1]!.tiles[0]!),
              b = proj.getTileCenter(tile);
            for (const d of [-6, 6])
              g.moveTo(a.x, a.y + d)
                .lineTo(b.x, b.y + d)
                .stroke({ color: 0x9b9678, width: 2, alpha: 0.45 });
          }
        }
      for (const tile of object.tiles ?? [])
        g.poly(proj.getInsetPolygon(tile, 0.04).flatMap((p) => [p.x, p.y])).stroke({
          color: 0x8ddbd5,
          width: 3,
          alpha: 0.8,
        });
    }
    for (const tile of object.extraction ?? []) {
      const p = proj.getTileCenter(tile),
        w = proj.footprint(tile).w;
      // Carved stone receiving seal, rather than a floating sci-fi circle.
      g.poly(proj.getInsetPolygon(tile, 0.09).flatMap(p => [p.x, p.y]))
        .fill({ color: 0x77654b, alpha: 0.24 })
        .stroke({ color: 0xc9ad70, width: 3, alpha: object.state === 'CARRIED' ? 0.95 : 0.4 });
      g.moveTo(p.x - w * 0.12, p.y).lineTo(p.x, p.y - w * 0.07)
        .lineTo(p.x + w * 0.12, p.y).lineTo(p.x, p.y + w * 0.07).closePath()
        .stroke({ color: 0xffdc8b, width: 2, alpha: 0.7 });
      g.poly(proj.getInsetPolygon(tile, 0.2).flatMap((p) => [p.x, p.y])).stroke({
        color: 0x90d9d1,
        width: 1,
        alpha: 0.5,
      });
    }
  }
  for (const link of view.unitLinks ?? []) {
    const object = view.objects.find((o) => o.id === link.from),
      unit = vm.state.units.find((u) => u.id === link.unitId);
    if (!object || !unit) continue;
    const a = proj.getTileCenter(object.pos),
      b = proj.getTileCenter(unit.pos);
    g.moveTo(a.x, a.y)
      .lineTo(b.x, b.y)
      .stroke({
        color: link.live ? 0xffce73 : 0x80c7c5,
        width: link.live ? 2 : 1,
        alpha: link.live ? 0.65 : 0.18,
      });
  }
  const selected = view.objects.find((o) => o.id === vm.selectedMechanismId);
  const access = selected?.interactable ? selected : !selected ? view.objects.find(o => o.interactable && view.unitLinks.some(l => l.from === o.id)) : undefined;
  if (access)
    for (const tile of [...vm.moveTiles.map(n => n.pos), ...vm.state.units.filter(u => u.id === vm.heroId).map(u => u.pos)]
      .filter(t => Math.abs(t.x - access.pos.x) + Math.abs(t.y - access.pos.y) === 1))
      g.poly(proj.getInsetPolygon(tile, 0.15).flatMap((p) => [p.x, p.y])).stroke({
        color: 0xc5e8ba,
        width: 2,
        alpha: 0.8,
      });
  for (const link of view.links) {
    const a = view.objects.find((o) => o.id === link.from),
      b = view.objects.find((o) => o.id === link.to);
    if (!a || !b) continue;
    const from = proj.getTileCenter(a.pos),
      to = proj.getTileCenter(b.pos);
    const emphasized = selected && (selected.id === a.id || selected.id === b.id);
    if (!emphasized) continue;
    g.moveTo(from.x, from.y)
      .lineTo(to.x, to.y)
      .stroke({
        color: link.live ? 0xe8bd59 : 0x58a6a8,
        width: emphasized ? 3 : 1.2,
        alpha: emphasized ? 0.85 : link.live ? 0.42 : 0.14,
      });
  }
  for (const o of view.objects) {
    if(o.kind==='BRIDGE'||o.kind==='REGION')continue;
    const chosen = o.id === vm.selectedMechanismId;
    const related = selected?.connected.includes(o.id);
    const color = o.visualState === 'active' || o.visualState === 'locked' ? 0xf4d274 : 0x66d1d0;
    g.poly(proj.getInsetPolygon(o.pos, chosen ? 0.06 : 0.16).flatMap((p) => [p.x, p.y]))
      .fill({ color, alpha: chosen ? 0.22 : 0.06 })
      .stroke({ color, width: chosen ? 3 : related ? 2 : 1, alpha: chosen || related ? 1 : 0.5 });
  }
  const push = vm.mechanismPushTo;
  if (push) {
    g.poly(proj.getInsetPolygon(push, 0.2).flatMap((p) => [p.x, p.y])).stroke({
      color: 0xffdd85,
      width: 3,
    });
    const o = selected && proj.getTileCenter(selected.pos),
      p = proj.getTileCenter(push);
    if (o) g.moveTo(o.x, o.y).lineTo(p.x, p.y).stroke({ color: 0xffdd85, width: 3 });
  }
}
