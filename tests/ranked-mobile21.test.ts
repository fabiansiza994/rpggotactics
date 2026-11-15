import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  RankedMobileRewards,
  mobileRewardCards,
  mobileRewardCondition,
} from "../src/presentation/ranked/RankedMobileRewards";
import { rankedTrackView, RANKED_TRACK } from "../src/game/ranked/rewardTrack";
import { RankedPanel } from "../src/presentation/ranked/RankedViews";
import { rankFor } from "../src/game/ranked/ranked";
const view = (rp = 350, peak = rp) =>
  rankedTrackView({
    rp,
    peakRp: peak,
    firstValidRanked: false,
    granted: {},
    milestones: [],
  });
describe("Ranked Mobile2.1 authoritative reward presentation", () => {
  it("preserves exact server reward IDs, quantities, conditions and statuses without synthesizing rewards", () => {
    const v = view(),
      rows = mobileRewardCards(v);
    expect(rows.map((r) => r.item)).toEqual(v.nodes.flatMap((n) => n.items));
    expect(rows.map((r) => r.item.rewardId)).toEqual([
      ...new Set(rows.map((r) => r.item.rewardId)),
    ]);
    expect(rows.filter((r) => r.next).map((r) => r.item.rewardId)).toEqual(
      v.nextReward!.items.map((i) => i.rewardId),
    );
  });
  it("does not unlock a reward from current player RP or substitute a local status", () => {
    const v = view(0, 0),
      rows = mobileRewardCards(v);
    const future = rows.find((r) => r.node.requiredRp >= 300)!;
    expect(future.item.status).toBe("LOCKED");
    expect(future.next).toBe(false);
    const html = renderToStaticMarkup(
      createElement(RankedMobileRewards, {
        view: v,
        error: "",
        onDetails() {},
        onRefresh() {},
      }),
    );
    expect(html).toContain("Aún bloqueada");
    expect(html).toContain("no desbloquea el Track ni Premium");
  });
  it("states first promotion for real crystal awards, not a repeatable purchase or AI payout", () => {
    for (const row of mobileRewardCards(view()).filter(
      (r) => r.item.type === "CRYSTALS",
    )) {
      expect(mobileRewardCondition(row.node, row.item)).toContain(
        "Primer ascenso",
      );
      expect(row.item.quantity).toBe(
        RANKED_TRACK.find((n) => n.nodeId === row.node.nodeId)!.items.find(
          (i) => i.rewardId === row.item.rewardId,
        )!.quantity,
      );
    }
  });
  it("states the extra first valid human match condition", () => {
    const row = mobileRewardCards(view()).find(
      (r) => r.item.condition === "FIRST_VALID_RANKED",
    )!;
    expect(mobileRewardCondition(row.node, row.item)).toContain(
      "Primera Ranked humana válida",
    );
  });
  it("renders real obtained copies including zero, without changing the catalog quantity", () => {
    const v = view(),
      row = mobileRewardCards(v).find((r) => r.item.type === "CARD")!;
    row.item.status = "CLAIMED";
    row.item.grantedCopies = 0;
    const html = renderToStaticMarkup(
      createElement(RankedMobileRewards, {
        view: v,
        error: "",
        onDetails() {},
        onRefresh() {},
      }),
    );
    expect(html).toContain("Obtenida");
    expect(html).toContain("Copias recibidas: 0");
    expect(row.item.quantity).toBeGreaterThan(0);
  });
  it("handles loading and controlled errors without inventing cards", () => {
    const html = renderToStaticMarkup(
      createElement(RankedMobileRewards, {
        view: null,
        error: "Sin conexión",
        onDetails() {},
        onRefresh() {},
      }),
    );
    expect(html).toContain("Sin conexión");
    expect(html).toContain("Reintentar");
    expect(html).not.toContain("r21-reward-card");
  });
  it.each([0, 99, 100, 299, 300, 350, 599, 1700])(
    "preserves rank and division data at %i RP",
    (rp) => {
      const profile = {
        enabled: true as const,
        rp,
        wins: 0,
        losses: 0,
        draws: 0,
        milestones: [],
        queue: { state: "IDLE" as const },
      };
      const html = renderToStaticMarkup(
        createElement(RankedPanel, {
          mobile: true,
          profile,
          queue: profile.queue,
          busy: false,
          error: "",
          blocked: null,
          championName: "Mago",
          onSearch() {},
          onCancel() {},
        }),
      );
      expect(html).toContain(rankFor(rp).label.toUpperCase());
      expect(html).toContain("Buscar partida");
      expect(html).toContain("r21-rewards");
    },
  );
  it("keeps the desktop entry and does not mount a carousel for desktop", () => {
    const profile = {
      enabled: true as const,
      rp: 350,
      wins: 0,
      losses: 0,
      draws: 0,
      milestones: [],
      queue: { state: "IDLE" as const },
    };
    const html = renderToStaticMarkup(
      createElement(RankedPanel, {
        profile,
        queue: profile.queue,
        busy: false,
        error: "",
        blocked: null,
        championName: "Mago",
        onSearch() {},
        onCancel() {},
      }),
    );
    expect(html).toContain("rrt-entry-button");
    expect(html).not.toContain("r21-rewards");
  });
  it("scopes layout to explicit mobile Ranked setup and retains existing action handlers", () => {
    const lobby = readFileSync("src/presentation/pvp/PvpLobby.tsx", "utf8"),
      css = readFileSync("src/styles/ranked-mobile-21.css", "utf8");
    expect(lobby).toContain("mobile && rankedSetup");
    expect(css).not.toContain(".desktop-shell");
    expect(css).not.toContain(".battle");
    expect(lobby).toContain('Mazo activo:');
    expect(lobby).not.toContain('<select');
    expect(lobby).toContain("onClick={() => setChoosing(true)}");
  });
});
