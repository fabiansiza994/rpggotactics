import type { CardDefinition, EffectDef } from '../domain/cards/card';

const unit = (range: number) =>
  ({ type: 'UNIT', range, unitFilter: 'ENEMY', requiresLineOfSight: true }) as const;
const hit = (amount: number, electrical = false): EffectDef => ({
  type: 'DAMAGE',
  amount,
  damageType: 'ARCANE',
  to: 'ENEMIES',
  attackKind: 'RANGED',
  ...(electrical ? { electrical: true } : {}),
});
const status = (
  status: 'OVERCHARGED' | 'SLOWED',
  duration: number,
  to: 'CASTER' | 'ENEMIES' = 'ENEMIES',
): EffectDef => ({ type: 'APPLY_STATUS', status, duration, to });
const card = (
  id: string,
  name: string,
  cost: number,
  family: 'nature' | 'thunder',
  category: CardDefinition['category'],
  rarity: CardDefinition['rarity'],
  rulesText: string,
  targeting: CardDefinition['targeting'],
  effects: EffectDef[],
): CardDefinition => ({
  id,
  name,
  heroId: 'mage',
  cost,
  category,
  rarity,
  tags: [family, 'mage-elements'],
  rulesText,
  targeting,
  effects,
  // Uses the existing magical damage model, not new resistances. Elemental identity is presentation.
  presentation: {
    visualKey: id,
    element: family === 'nature' ? 'NATURE' : 'THUNDER',
    castAnimation: 'cast',
  },
});
/** Five approved original Thunder cards; Nature is not part of this release. */
export const MAGE_THUNDER_CORE: CardDefinition[] = [
  card(
    'thunder_discharge',
    'Descarga del Trueno',
    2,
    'thunder',
    'ATTACK',
    'COMMON',
    'Inflige 3 de daño mágico eléctrico a un enemigo a distancia 4 con visión.',
    unit(4),
    [hit(3, true)],
  ),
  card(
    'chain_lightning',
    'Relámpago en Cadena',
    3,
    'thunder',
    'ATTACK',
    'RARE',
    'Inflige 2 de daño mágico eléctrico al objetivo a distancia 4 con visión. Salta hasta 5 enemigos adicionales adyacentes ortogonalmente, 1 de daño cada uno. Nunca repite objetivo.',
    unit(4),
    [{ ...hit(2, true), rebound: { bounces: 5, amount: 1 } } as EffectDef],
  ),
  card(
    'arcane_overload',
    'Sobrecarga Arcana',
    1,
    'thunder',
    'UTILITY',
    'UNCOMMON',
    'La próxima carta eléctrica inflige +1 de daño por objetivo. Se consume al resolverla, incluso sin daño de PV. Caduca al final de tu próximo turno. No se acumula ni renueva.',
    { type: 'SELF' },
    [status('OVERCHARGED', 2, 'CASTER')],
  ),
  card(
    'paralyzing_pulse',
    'Pulso Paralizante',
    2,
    'thunder',
    'CONTROL',
    'UNCOMMON',
    'Inflige 1 de daño mágico eléctrico a los enemigos ortogonalmente adyacentes. Reduce su movimiento en 2 (mínimo 1) durante 1 turno; no impide atacar.',
    { type: 'SELF', area: { shape: 'CROSS', radius: 1, includeCenter: false } },
    [hit(1, true), status('SLOWED', 1)],
  ),
  card(
    'tempest_judgment',
    'Juicio de la Tempestad',
    4,
    'thunder',
    'ATTACK',
    'RARE',
    'Inflige 4 de daño mágico eléctrico a los enemigos en una cruz de radio 1 a distancia 3 con visión. Las marcas del suelo son solo cosméticas.',
    { type: 'CROSS', range: 3, radius: 1, requiresLineOfSight: true },
    [hit(4, true)],
  ),
];
