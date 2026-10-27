/** Presentation recipes only; selection never changes cards, ownership or combat. */
export const phaseTwoPilot = { bastion: true, golem: true };
export const BASTION_RECIPE = {
  visualKey: 'bastion_blow',
  atlas: 'bastion',
  frames: {
    arc: [0, 1, 2, 3],
    contact: [4, 5, 6, 7],
    wave: [8, 9, 10, 11],
    glint: [12],
    spark: [13],
    shard: [14],
    dust: [15],
  },
  contactMs: 220,
  waveMs: 280,
  debrisMs: 320,
  desktopFragments: 6,
  mobileFragments: 3,
} as const;
export const GOLEM_RECIPE = {
  visualKey: 'summon_pact_golem',
  summonId: 'pact_golem',
  atlas: 'pact-summon',
  frames: {
    circle: [0, 1, 2, 3],
    rise: [4, 5, 6, 7],
    aura: [8, 9, 10, 11],
    rune: [12],
    mote: [13],
    dust: [14],
    convergence: [15],
  },
  arrivalMs: 600,
  auraMs: 720,
  mobileMotes: 4,
  desktopMotes: 8,
} as const;
