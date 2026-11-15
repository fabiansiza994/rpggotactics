import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PvpVersus, PVP_VERSUS_MS } from "../src/presentation/pvp/PvpVersus";
import { profileAvatar } from "../src/shared/profileAvatars";
import type { LobbyRoom } from "../src/presentation/pvp/PvpLobby";
const room: LobbyRoom = {
  code: "QA",
  mode: "DUEL",
  mapId: "classic",
  seat: 0,
  members: [
    {
      name: "Local",
      heroId: "mage",
      avatarId: null,
      frameId: "frame_arcane_gilt",
      ready: false,
      connected: true,
    },
    {
      name: "Rival IA",
      heroId: "summoner",
      avatarId: null,
      kind: "BOT",
      frameId: "frame_pact_grove",
      ready: true,
      connected: true,
    },
  ],
};
describe("confirmed-room presentation", () => {
  it("uses personal avatars and equipped circular frame art with accessible automated identity", () => {
    const html = renderToStaticMarkup(
      createElement(PvpVersus, {
        room,
        onFinish: () => {},
        onCancel: () => {},
      }),
    );
    expect(html).toContain(profileAvatar(null).asset);
    expect(html).toContain("/art/profile-frames-v2/arcane.png");
    expect(html).toContain("/art/profile-frames-v2/nature.png");
    expect(html).toContain("Rival automatizado");
    expect(html).toContain("Invocador");
    expect(html).toContain("Omitir presentación");
    expect(html).toContain("Volver al lobby");
    expect(PVP_VERSUS_MS).toBe(3000);
  });
  it("reverses local and opponent seats without substituting champion portraits", () => {
    const html = renderToStaticMarkup(
      createElement(PvpVersus, {
        room: { ...room, seat: 1 },
        onFinish: () => {},
        onCancel: () => {},
      }),
    );
    expect(html.indexOf("Rival IA")).toBeLessThan(html.indexOf(">Local<"));
    expect(html).not.toContain("/characters/");
  });
});
