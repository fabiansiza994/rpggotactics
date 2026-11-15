import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const source = (name: string) =>
  readFileSync(
    new URL("../src/presentation/react/screens/" + name, import.meta.url),
    "utf8",
  );
describe("Auto-builder editor integration safety contracts", () => {
  it("keeps the real editor route for Edit and creation instead of a laboratory substitute", () => {
    const s = source("DeckBuilder.tsx");
    expect(s).toContain(
      "<MyDecks onEdit={deckId=>setEditing({heroId,deckId})}",
    );
    expect(s).toContain("<DeckEditor key=");
    const list = source("MyDecks.tsx");
    expect(list).not.toContain("AutoDeckBuilder");
    expect(list).toContain("onEdit(d.deckId)");
    expect(list).toContain("if (edit) onEdit(r.deckId)");
    const lab = readFileSync(
      new URL("../qa/auto-deck-20261115/lab.tsx", import.meta.url),
      "utf8",
    );
    expect(lab).toContain("<DeckBuilder");
    expect(lab).not.toContain("onEdit={()=>setOpen");
  });
  it("has no persistence, activation, destination or champion switching action in the proposal panel", () => {
    const s = source("AutoDeckBuilder.tsx");
    for (const forbidden of [
      ".saveDeck(",
      ".createDeck(",
      ".setDefaultDeck(",
      ".openDeckBuilder(",
      "setHero(",
      "setTarget(",
      "Usar como mazo activo",
      "Guardar propuesta",
    ])
      expect(s).not.toContain(forbidden);
    expect(s).toContain("Aplicar al editor");
    expect(s).toContain("onApply(proposal.cards.map");
    expect(s).toContain("validateDeck(");
  });
  it("applies only to the draft, marks it dirty and retains the editor save/discard guards", () => {
    const s = source("DeckBuilder.tsx");
    expect(s).toContain("setDraft(cards.map");
    expect(s).toContain("setAutoApplied(true)");
    expect(s).toContain("autoApplied || !sameDeck(draft, saved.cards)");
    expect(s).toContain("saveDeck(heroId, draft, deckId)");
    expect(s).toContain("setAutoApplied(false)");
    expect(s).toContain("registerPlayNavigationGuard");
    expect(s).toContain("<LeaveDialog");
    expect(s).toContain("setTab('DECK')");
  });
  it("offers the wand without replacing the existing editor controls", () => {
    const s = source("DeckBuilder.tsx");
    for (const label of [
      "Autoarmar con IA",
      "Guardar mazo",
      "Deshacer",
      "Mazo inicial",
    ])
      expect(s).toContain(label);
    expect(s).toContain('className="db-btn db-auto-button"');
    expect(s).toContain("heroId={heroId}");
  });
});
