import type { CardDefinition } from "../../game";
import { FeatureCard } from "../react/components/BattleCardFeature";
/** The game's real card face, without combat state, costs or actions being changed. */
export function MarketCard({
  card,
  accessible = false,
  interactive = accessible,
}: {
  card: CardDefinition;
  accessible?: boolean;
  interactive?: boolean;
}) {
  return (
    <FeatureCard
      def={card}
      interactive={interactive}
      className="market-game-card"
      extras={{ playable: true }}
      ariaHidden={!accessible}
    />
  );
}
