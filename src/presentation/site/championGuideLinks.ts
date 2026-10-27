/** Stable public guide destinations; unknown/future champions safely fall back to the roster. */
export function championGuideHref(heroId: string): string {
  const known = ['mage', 'summoner', 'warrior', 'shapeshifter', 'archer'];
  return `https://rpg-go-tactics.com/#${known.includes(heroId) ? `champion-${heroId}` : 'champions'}`;
}
