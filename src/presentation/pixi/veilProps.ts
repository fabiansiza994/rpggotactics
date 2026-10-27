import { Container, Graphics, Sprite } from 'pixi.js';
import { paintedCharacter } from './paintedTextures';
import geometry from '../assets/archerHuntGeometry.json';

/** Normalized illustrated props share a ground anchor; never register collision geometry. */
export function veilProp(id: string, height: number): Container {
  const body = new Container(), texture = paintedCharacter(id);
  if (!texture) return body;
  body.addChild(new Graphics().ellipse(0, 0, height * .24, height * .07).fill({color: 0x03090a, alpha: .45}));
  const sprite = new Sprite(texture);
  const bounds=geometry[id as keyof typeof geometry];
  sprite.anchor.set(bounds?.anchorX ?? .5, bounds?.anchorY ?? .92);
  sprite.scale.set(height / (texture.height * (bounds ? bounds.anchorY-bounds.topY : .84)));
  body.addChild(sprite);
  return body;
}
