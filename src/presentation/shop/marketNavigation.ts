import { useEffect, useState } from "react";
import { MARKET_SECTIONS, type MarketSection } from "./market";
export function readMarketNavigation(search: string) {
  const q = new URLSearchParams(search);
  if(q.get("market")==="cards")q.set("market","packs");
  const category = MARKET_SECTIONS.some((s) => s.id === q.get("market"))
    ? (q.get("market") as MarketSection)
    : "featured";
  return {
    category,
    expansionId: category === "packs" ? q.get("expansion") : null,
  };
}
export function marketNavigationUrl(
  current: string,
  category: MarketSection,
  expansionId: string | null,
) {
  const u = new URL(current);
  if (category === "featured") u.searchParams.delete("market");
  else u.searchParams.set("market", category);
  if (category === "packs" && expansionId)
    u.searchParams.set("expansion", expansionId);
  else u.searchParams.delete("expansion");
  return u.pathname + u.search + u.hash;
}
export function useMarketNavigation(
  defaultCategory: MarketSection = "featured",
) {
  if(defaultCategory==="cards")defaultCategory="packs";
  const [nav, setNav] = useState(() => {
    const x = readMarketNavigation(location.search);
    return new URLSearchParams(location.search).has("market")
      ? x
      : { category: defaultCategory, expansionId: null };
  });
  useEffect(() => {
    if (
      defaultCategory !== "featured" &&
      !new URLSearchParams(location.search).has("market")
    )
      history.replaceState(
        { ...history.state, arcaneMarket: true },
        "",
        marketNavigationUrl(location.href, defaultCategory, null),
      );
    const back = () => setNav(readMarketNavigation(location.search));
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [defaultCategory]);
  const navigate = (
    category: MarketSection,
    expansionId: string | null = null,
  ) => {
    if(category==="cards")category="packs";
    const url = marketNavigationUrl(location.href, category, expansionId);
    if (url !== location.pathname + location.search + location.hash)
      history.pushState(
        {
          ...history.state,
          arcaneMarket: true,
          arcaneFrom: location.pathname + location.search + location.hash,
        },
        "",
        url,
      );
    setNav({ category, expansionId });
  };
  const up = () => {
    const parent = {
      category: (nav.expansionId ? "packs" : "featured") as MarketSection,
      expansionId: null,
    };
    const url = marketNavigationUrl(location.href, parent.category, null);
    if (history.state?.arcaneFrom === url) history.back();
    else
      history.replaceState({ ...history.state, arcaneMarket: true }, "", url);
    setNav(parent);
  };
  return { ...nav, navigate, up };
}
