import { afterEach, describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const api = vi.hoisted(() => ({
  equip: vi.fn(),
  request: vi.fn(),
  session: { token: "qa-only-token", username: "qa" },
}));
vi.mock("../src/presentation/cloud/session", () => ({
  loadSession: () => api.session,
}));
vi.mock("../src/presentation/shop/api", () => ({
  storeApi: { equip: api.equip },
}));
vi.mock("../src/presentation/cloud/http", () => ({ request: api.request }));
import {
  FramePickerView,
  ownedProfileFrames,
} from "../src/presentation/profile/ProfileFramePicker";
import { useCardCosmetics } from "../src/presentation/cosmetics/cardCosmetics";
import { PROFILE_FRAME_ART } from "../src/presentation/assets/profileFrames";
import { profileAvatar } from "../src/shared/profileAvatars";
import type { Cosmetics } from "../src/presentation/shop/api";
const data: Cosmetics = {
  owned: [
    { cosmeticId: "frame_arcane_gilt", kind: "PROFILE_FRAME", acquiredAt: 1 },
    { cosmeticId: "frame_pact_grove", kind: "PROFILE_FRAME", acquiredAt: 1 },
    {
      cosmeticId: "cardback_premium_arcane_circle",
      kind: "CARD_BACK",
      acquiredAt: 1,
    },
  ],
  equipped: {
    PROFILE_FRAME: "frame_arcane_gilt",
    CARD_BACK: "cardback_premium_arcane_circle",
  },
};
const initial = useCardCosmetics.getState();
afterEach(() => {
  useCardCosmetics.setState(initial, true);
  vi.clearAllMocks();
});
describe("profile frame selection", () => {
  it("lists only owned frame rights and retains legacy circular IDs", () => {
    expect(ownedProfileFrames(data).map((f) => f.id)).toEqual([
      "frame_arcane_gilt",
      "frame_pact_grove",
    ]);
    for (const id of Object.keys(PROFILE_FRAME_ART))
      expect(
        ownedProfileFrames({
          owned: [{ cosmeticId: id, kind: "PROFILE_FRAME", acquiredAt: 1 }],
          equipped: {},
        })[0]?.id,
      ).toBe(id);
  });
  it("previews current avatar, offers none and never exposes an unowned frame", () => {
    const html = renderToStaticMarkup(
      createElement(FramePickerView, {
        cosmetics: data,
        avatarId: "mystic_fox",
        busy: false,
        error: "",
        onSave: async () => {},
        onReload: () => {},
      }),
    );
    expect(html).toContain("Sin marco");
    expect(html).toContain("Guardar marco");
    expect(html).toContain(profileAvatar("mystic_fox").asset);
    expect(html).toContain("frame_arcane_gilt");
    expect(html).not.toContain("frame_executioner_oath");
  });
  it("rejects unowned frame before sending a request", async () => {
    useCardCosmetics.setState({ scope: api.session.token, data, busy: false });
    await useCardCosmetics
      .getState()
      .equip("PROFILE_FRAME", "frame_executioner_oath");
    expect(api.equip).not.toHaveBeenCalled();
    expect(useCardCosmetics.getState().data).toEqual(data);
  });
  it("saves through the existing slot without altering avatar or other slots", async () => {
    useCardCosmetics.setState({ scope: api.session.token, data, busy: false });
    const next = {
      ...data,
      equipped: { ...data.equipped, PROFILE_FRAME: "frame_pact_grove" },
    };
    api.equip.mockResolvedValue({ ok: true, data: next });
    await useCardCosmetics
      .getState()
      .equip("PROFILE_FRAME", "frame_pact_grove");
    expect(api.equip).toHaveBeenCalledExactlyOnceWith(
      api.session.token,
      "PROFILE_FRAME",
      "frame_pact_grove",
    );
    expect(useCardCosmetics.getState().data.equipped.CARD_BACK).toBe(
      data.equipped.CARD_BACK,
    );
    expect(useCardCosmetics.getState().data.owned).toEqual(data.owned);
  });
  it("unequips and reloads persisted server selection", async () => {
    useCardCosmetics.setState({ scope: api.session.token, data, busy: false });
    const saved = {
      ...data,
      equipped: { ...data.equipped, PROFILE_FRAME: null },
    };
    api.equip.mockResolvedValue({ ok: true, data: saved });
    await useCardCosmetics.getState().equip("PROFILE_FRAME", null);
    expect(api.equip).toHaveBeenCalledWith(
      api.session.token,
      "PROFILE_FRAME",
      null,
    );
    api.request.mockResolvedValue({ ok: true, data: saved });
    await useCardCosmetics.getState().load(true);
    expect(useCardCosmetics.getState().data.equipped.PROFILE_FRAME).toBeNull();
  });
  it("preserves equipped state on server rejection", async () => {
    useCardCosmetics.setState({ scope: api.session.token, data, busy: false });
    api.equip.mockResolvedValue({
      ok: false,
      error: { message: "No tienes ese marco" },
    });
    await useCardCosmetics
      .getState()
      .equip("PROFILE_FRAME", "frame_pact_grove");
    expect(useCardCosmetics.getState().data).toEqual(data);
    expect(useCardCosmetics.getState().error).toContain("No tienes");
  });
});
