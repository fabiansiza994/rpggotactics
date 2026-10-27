import { TEMPLE_ENCOUNTERS } from '../../game/data/temple-encounters';
import { Container, Sprite, type Texture } from 'pixi.js';
/** Only authored adjacent segments; unlocking a door is not an encounter completion. */
export function adjacentTempleSegment(from: string, to: string, won: boolean) {
  return won && TEMPLE_ENCOUNTERS.some(segment => segment.id === from && segment.next === to)
    && TEMPLE_ENCOUNTERS.some(segment => segment.id === to);
}
export function journeyPose(ms: number, width: number) {
  const t = Math.min(1, Math.max(0, ms / 360));
  const eased = t * t * (3 - 2 * t);
  return { outgoing: -width * eased, incoming: width * (1 - eased), done: t === 1 };
}
/** One bounded snapshot and the existing live field. No second scene, engine or RAF loop. */
export class Act3Journey {
  private outgoing: Sprite | null = null;
  private elapsed = 0;
  private width = 0;
  get active() { return !!this.outgoing; }
  constructor(private field: Container, private stage: Container, private busy: (value:boolean)=>void) {}
  start(texture: Texture, width: number, height: number) {
    this.finish();
    const image = new Sprite(texture);
    image.eventMode = 'none'; image.width = width; image.height = height;
    this.width = width; this.elapsed = 0; this.outgoing = image;
    this.stage.addChild(image); this.field.x = width; this.busy(true);
  }
  tick(ms: number, reduced: boolean, width: number) {
    if (!this.outgoing) return;
    if (reduced || width !== this.width) { this.finish(); return; }
    this.elapsed += ms;
    const p=journeyPose(this.elapsed,this.width);
    this.field.x=p.incoming; this.outgoing.x=p.outgoing;
    if(p.done) this.finish();
  }
  finish() {
    if (!this.outgoing) return;
    this.outgoing.removeFromParent();
    this.outgoing.destroy({texture:true,textureSource:true});
    this.outgoing=null; this.field.x=0; this.busy(false);
  }
}
