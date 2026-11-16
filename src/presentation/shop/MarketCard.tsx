import type { CardDefinition } from "../../game";
import { FeatureCard } from "../react/components/BattleCardFeature";
/** The game's real card face, without combat state, costs or actions being changed. */
export function MarketCard({
  card,
  accessible = false,
}: {
  card: CardDefinition;
  accessible?: boolean;
}) {
  return (
    <FeatureCard
      def={card}
      className="market-game-card"
      extras={{ playable: true }}
      ariaHidden={!accessible}
    />
  );
}
