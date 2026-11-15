import { afterEach, describe, it, expect, vi } from "vitest";
import { ritualActionAvailability } from "../src/presentation/react/components/RitualCardActions";
import { DEFAULT_CONTENT } from "../src/game";
import { makeEngine, mutable, p, setHand } from "./helpers";
import { useBattleStore } from "../src/presentation/store/battleStore";
const initial = useBattleStore.getState();
afterEach(() => useBattleStore.setState(initial, true));
function setup() {
  const e = makeEngine(
    { hero: { heroId: "summoner", pos: p(2, 2) } },
    DEFAULT_CONTENT,
  );
  setHand(e, ["seal_claw", "seal_fang"]);
  mutable(e).player.energy = 5;
  useBattleStore.setState({
    engine: e,
    state: e.state,
    selectedCardUid: e.state.player.hand[0]!.uid,
    introLocked: false,
    playbackBusy: false,
    onlineCommand: null,
  });
  return e;
}
describe("ritual choice uses existing rules", () => {
  it("offers real actions and real target validity without mutation", () => {
    const e = setup(),
      uid = e.state.player.hand[0]!.uid,
      before = JSON.stringify(e.state),
      a = ritualActionAvailability(e, uid)!;
    expect(a.seal.playable).toBe(true);
    expect(a.play.playable).toBe(e.getCardPlayability(uid).playable);
    expect(a.hasTarget).toBe(a.self || e.getValidTargets(uid).length > 0);
    expect(JSON.stringify(e.state)).toBe(before);
  });
  it("sends one piece with original seal cost; duplicate UID rejected without loss", () => {
    const e = setup(),
      uid = e.state.player.hand[0]!.uid,
      cost = e.getAltarStatus()!.nextSealCost,
      energy = e.state.player.energy;
    expect(e.dispatch({ type: "COMMIT_RITUAL_PIECE", cardUid: uid }).ok).toBe(
      true,
    );
    expect(e.state.player.energy).toBe(energy - cost);
    expect(e.state.player.altar?.filter((c) => c.uid === uid)).toHaveLength(1);
    const before = JSON.stringify(e.state);
    expect(e.dispatch({ type: "COMMIT_RITUAL_PIECE", cardUid: uid }).ok).toBe(
      false,
    );
    expect(JSON.stringify(e.state)).toBe(before);
  });
  it("rejects illegal seal without energy or hand changes", () => {
    const e = setup();
    mutable(e).player.energy = 0;
    mutable(e).player.altarSeals = 1;
    const uid = e.state.player.hand[0]!.uid,
      before = JSON.stringify(e.state);
    expect(ritualActionAvailability(e, uid)!.seal.playable).toBe(false);
    expect(e.dispatch({ type: "COMMIT_RITUAL_PIECE", cardUid: uid }).ok).toBe(
      false,
    );
    expect(JSON.stringify(e.state)).toBe(before);
  });
  it("cancels presentation without command or resource consumption", () => {
    const e = setup(),
      before = JSON.stringify(e.state);
    useBattleStore.getState().selectCard(null);
    expect(JSON.stringify(e.state)).toBe(before);
    expect(useBattleStore.getState().selectedCardUid).toBeNull();
  });
  it("ordinary cards never receive altar actions", () => {
    const e = setup();
    setHand(e, ["magic_missile"]);
    expect(ritualActionAvailability(e, e.state.player.hand[0]!.uid)).toBeNull();
  });
  it("server-command rejection leaves the authoritative hand and energy intact", () => {
    const e = setup(),
      uid = e.state.player.hand[0]!.uid,
      before = JSON.stringify(e.state);
    const send = vi.fn(() =>
      useBattleStore.setState({ notice: "Acción rechazada" }),
    );
    useBattleStore.setState({ onlineCommand: send });
    useBattleStore.getState().commitRitualPiece(uid);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: "COMMIT_RITUAL_PIECE",
      cardUid: uid,
    });
    expect(JSON.stringify(e.state)).toBe(before);
    expect(useBattleStore.getState().notice).toBe("Acción rechazada");
    useBattleStore.getState().selectCard(uid);
    expect(useBattleStore.getState().selectedCardUid).toBe(uid);
  });
  it("targeted effect resolves through existing command and original energy cost", () => {
    const e = setup();
    setHand(e, ["seal_wing"]);
    const uid = e.state.player.hand[0]!.uid,
      target = e.getValidTargets(uid)[0]!,
      before = e.state.player.energy;
    expect(ritualActionAvailability(e, uid)!.hasTarget).toBe(true);
    expect(e.dispatch(e.selectionCommand(uid, target)).ok).toBe(true);
    expect(e.state.player.energy).toBe(
      before - DEFAULT_CONTENT.cards.seal_wing!.cost,
    );
    expect(e.state.player.hand.some((c) => c.uid === uid)).toBe(false);
    expect(e.state.player.discard.filter((c) => c.uid === uid)).toHaveLength(1);
  });
});

// These dialogs are siblings of the overlay; raw card UIDs must never share React keys.
it('namespaces the choice overlay key separately from card-search dialogs',async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../src/presentation/react/components/Hud.tsx',import.meta.url),'utf8');
  expect(source).toContain('key={`ritual-choice:${aimedCard.uid}`}');
  expect(source).not.toContain('<RitualCardActions key={aimedCard.uid}');
});
