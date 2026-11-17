import { MARKET_EXPANSIONS } from "../../game/store/market-expansions";
export function packExpansion(packId: string) {
  return MARKET_EXPANSIONS.find((e) => packId.startsWith(`booster_${e.id}_`));
}
export function PackArt({ packId }: { packId: string }) {
  const e = packExpansion(packId);
  return (
    <span className="arcane-pack" data-expansion={e?.id} aria-hidden="true">
      <span className="arcane-pack-crimp" />
      <img src={e?.packArt ?? e?.art ?? "/art/checkpoint05/cards/arcane_burst.webp"} alt="" />
      <span className="arcane-pack-sigil">✧</span>
      <strong>{e?.name ?? "Sobre arcano"}</strong>
      <small>RPG-GO TACTICS · 4 CARTAS</small>
      <span className="arcane-pack-seam" />
    </span>
  );
}
