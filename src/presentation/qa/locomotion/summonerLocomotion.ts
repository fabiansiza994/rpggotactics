/** Authored gait assets only; no battle rules or champion definitions. */
export const SUMMONER_LOCOMOTION = {
  summoner: { name: 'Invocador', nativeFacing: 'RIGHT', travel: 'ground', walkMs: 160, runMs: 95 },
  chicken: { name: 'Pollo', nativeFacing: 'RIGHT', travel: 'ground', walkMs: 110, runMs: 70 },
  fox: { name: 'Zorro', nativeFacing: 'LEFT', travel: 'ground', walkMs: 150, runMs: 85 },
  turtle: { name: 'Tortuga', nativeFacing: 'RIGHT', travel: 'ground', walkMs: 230, runMs: 155 },
  raven: { name: 'Cuervo', nativeFacing: 'RIGHT', travel: 'flight', walkMs: 180, runMs: 90 },
  wolf: { name: 'Lobo', nativeFacing: 'LEFT', travel: 'ground', walkMs: 160, runMs: 95 },
  primordial_dragon: {
    name: 'Dragón Primordial',
    nativeFacing: 'LEFT',
    travel: 'flight',
    walkMs: 230,
    runMs: 135,
  },
} as const;
export type SummonerLocomotionId = keyof typeof SUMMONER_LOCOMOTION;
