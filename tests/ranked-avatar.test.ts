import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RankedAvatar } from "../src/presentation/profile/RankedAvatar";
import { PROFILE_AVATARS } from "../src/shared/profileAvatars";
import { readFileSync } from "node:fs";
it("renders the selected public avatar rather than champion art", () => {
  for (const a of PROFILE_AVATARS) {
    const html = renderToStaticMarkup(
      createElement(RankedAvatar, {
        avatarId: a.id,
        frameId: "frame_arcane_gilt",
      }),
    );
    expect(html).toContain(a.asset);
    expect(html).toContain("ranked-player-avatar");
    expect(html).toContain("frame_arcane_gilt");
  }
});
it("unknown public cosmetic has a safe catalog fallback", () => {
  expect(
    renderToStaticMarkup(createElement(RankedAvatar, { avatarId: "unknown" })),
  ).toContain(PROFILE_AVATARS[0]!.asset);
});
it("circular store styling is scoped to avatar products, not card illustrations", () => {
  const css = readFileSync(
    new URL("../src/styles/ranked-premium-track.css", import.meta.url),
    "utf8",
  );
  expect(css).toContain(
    ".rpt-art[data-kind='PROFILE_AVATAR'] img,.rpt-art[data-kind='AVATAR'] img{object-fit:cover;border-radius:50%}",
  );
});

it('store avatar frame previews retain original cosmetic art and do not change card renderers',()=>{const source=readFileSync(new URL('../src/presentation/shop/ProfileFrame.tsx',import.meta.url),'utf8');expect(source).toContain('shop-cosmetic-art shop-avatar-preview');expect(source).toContain('href={art}');expect(source).toContain('PROFILE_FRAME_ART')});
