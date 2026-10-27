import { useEffect, useId, useState, type ReactNode } from 'react';
import { RANKED_PREMIUM_COSMETICS } from '../../game/ranked/premiumCosmetics';
import { RANKED_COSMETICS } from '../../game/ranked/rewardTrack';
import { CLOUD_CONFIG } from '../cloud/config';
import { request } from '../cloud/http';
import { loadSession } from '../cloud/session';
import { storeApi, type Cosmetics } from '../shop/api';
import '../../styles/ranked-cosmetics.css';

/**
 * Renderers of the equipped Ranked Reward Track cosmetics (pure presentation, ids from the server).
 * Each kind lives only where its documented intent puts it:
 * - RANKED_CREST  → beside the player name (PvP lobby, Ranked VS, friend card)
 * - PROFILE_FRAME → around the champion portrait (through ProfileFrame)
 * - VICTORY_BADGE → stamped on the result screen of a win
 * An unknown, absent or wrong-kind id renders nothing.
 */
const cosmetics = { ...RANKED_COSMETICS, ...RANKED_PREMIUM_COSMETICS };
const art = (id: string) => RANKED_PREMIUM_COSMETICS[id]
  ? `/art/ranked-premium/${id}.webp`
  : `/art/ranked-rewards/${id}.svg`;
const ofKind = (id: string | null | undefined, kind: string) =>
  id && cosmetics[id]?.kind === kind ? cosmetics[id]! : null;

export function RankedCrest({ crestId }: { crestId: string | null | undefined }) {
  const crest = ofKind(crestId, 'RANKED_CREST');
  if (!crest) return null;
  return (
    <img
      className="ranked-crest"
      data-crest={crest.id}
      src={art(crest.id)}
      alt={crest.name}
      title={crest.name}
      width="24"
      height="24"
      draggable={false}
    />
  );
}

export function VictoryBadge({ badgeId }: { badgeId: string | null | undefined }) {
  const badge = ofKind(badgeId, 'VICTORY_BADGE');
  if (!badge) return null;
  return (
    <img
      className="ranked-victory-badge"
      data-badge={badge.id}
      src={art(badge.id)}
      alt={badge.name}
      width="96"
      height="96"
      draggable={false}
    />
  );
}

/**
 * Equip / unequip one owned Ranked cosmetic through the existing cosmetics endpoint
 * (PUT /api/tactics/cosmetics/equip). Slot = the cosmetic kind; the server checks catalog, slot
 * and ownership — the client only names the id. Unequip only empties the slot (ownership stays).
 */
export function RankedCosmeticEquip({ cosmeticId, onNotice }: { cosmeticId: string; onNotice(msg: string): void }) {
  const cosmetic = cosmetics[cosmeticId];
  const [state, setState] = useState<Cosmetics | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const s = loadSession();
    if (s)
      void request<Cosmetics>(CLOUD_CONFIG.apiUrl, '/api/tactics/cosmetics', { token: s.token, timeoutMs: CLOUD_CONFIG.timeoutMs }).then(
        (r) => alive && r.ok && setState(r.data),
      );
    return () => {
      alive = false;
    };
  }, [cosmeticId]);
  if (!cosmetic || !state?.owned.some((c) => c.cosmeticId === cosmeticId)) return null;
  const slot = cosmetic.kind;
  const equipped = state.equipped[slot] === cosmeticId;
  const set = async (id: string | null) => {
    const s = loadSession();
    if (!s || busy) return;
    setBusy(true);
    const r = await storeApi.equip(s.token, slot, id);
    setBusy(false);
    if (r.ok) {
      setState(r.data);
      onNotice(id ? `Equipado: ${cosmetic.name}` : `Quitado: ${cosmetic.name}`);
    } else onNotice(r.error.message);
  };
  return (
    <div className="rrt-cosmetic-equip" data-equipped={equipped}>
      {equipped ? (
        <>
          <strong>EQUIPADO</strong>
          <button type="button" disabled={busy} onClick={() => void set(null)}>
            Quitar
          </button>
        </>
      ) : (
        <button type="button" className="rrt-equip" disabled={busy} onClick={() => void set(cosmeticId)}>
          {busy ? 'Equipando…' : 'EQUIPAR'}
        </button>
      )}
    </div>
  );
}

/** True for the Ranked profile frames (square art: an octagonal ring around the portrait). */
export const isRankedFrame = (frameId: string | null | undefined) => !!ofKind(frameId, 'PROFILE_FRAME');

/**
 * A Ranked profile frame around a portrait. The track art is a full square medallion, so the
 * portrait is drawn over its inner octagon (the ring stays visible) instead of under an overlay.
 */
export function RankedProfileFrame({ frameId, children }: { frameId: string; children: ReactNode }) {
  const id = useId().replace(/:/g, '');
  if (RANKED_PREMIUM_COSMETICS[frameId]?.kind === 'PROFILE_FRAME') return (
    <div className="profile-frame ranked-profile-frame premium-profile-frame" data-frame={frameId}>
      <svg className="profile-frame-canvas" viewBox="0 0 512 512" preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id={`premium-window-${id}`}><circle cx="256" cy="256" r="202" /></clipPath></defs>
        <foreignObject x="54" y="54" width="404" height="404" clipPath={`url(#premium-window-${id})`}>
          <div className="profile-frame-window">{children}</div>
        </foreignObject>
        <image className="profile-frame-ornament" href={art(frameId)} width="512" height="512" aria-hidden="true" />
      </svg>
    </div>
  );
  return (
    <div className="profile-frame ranked-profile-frame" data-frame={frameId}>
      <svg className="profile-frame-canvas" viewBox="0 0 240 240" preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id={`ranked-window-${id}`}>
            <path d="M65 55 120 37 175 55 191 120 175 185 120 203 65 185 49 120Z" />
          </clipPath>
        </defs>
        <image className="profile-frame-ornament" href={art(frameId)} width="240" height="240" aria-hidden="true" />
        <foreignObject x="49" y="37" width="142" height="166" clipPath={`url(#ranked-window-${id})`}>
          <div className="profile-frame-window">{children}</div>
        </foreignObject>
      </svg>
    </div>
  );
}
