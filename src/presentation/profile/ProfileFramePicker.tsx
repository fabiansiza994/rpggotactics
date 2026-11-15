import { useEffect, useState } from "react";
import { equippableCosmetics } from "../../game/ranked/rankedCosmetics";
import type { Cosmetics } from "../shop/api";
import { RankedAvatar } from "./RankedAvatar";
import { useCardCosmetics, useCosmeticView } from "../cosmetics/cardCosmetics";
import "../../styles/profile-frame-picker.css";
const catalog = equippableCosmetics();
export function ownedProfileFrames(cosmetics: Cosmetics) {
  return [
    ...new Set(
      cosmetics.owned
        .filter(
          (c) =>
            c.kind === "PROFILE_FRAME" &&
            catalog[c.cosmeticId]?.kind === "PROFILE_FRAME",
        )
        .map((c) => c.cosmeticId),
    ),
  ].map((id) => catalog[id]!);
}
export function FramePickerView({
  cosmetics,
  avatarId,
  busy,
  error,
  onSave,
  onReload,
}: {
  cosmetics: Cosmetics;
  avatarId: string;
  busy: boolean;
  error: string;
  onSave(id: string | null): Promise<void>;
  onReload(): void;
}) {
  const [selected, setSelected] = useState<string | null>(
    cosmetics.equipped.PROFILE_FRAME ?? null,
  );
  const frames = ownedProfileFrames(cosmetics),
    legal = selected === null || frames.some((f) => f.id === selected),
    saved = cosmetics.equipped.PROFILE_FRAME ?? null;
  return (
    <section className="profile-frame-picker" aria-label="Marcos adquiridos">
      <h3>Cambiar marco</h3>
      <div className="profile-frame-preview">
        <RankedAvatar avatarId={avatarId} frameId={legal ? selected : null} />
        <span>Vista previa · tu avatar se conserva</span>
      </div>
      <div className="profile-frame-options">
        <button
          type="button"
          aria-pressed={selected === null}
          disabled={busy}
          onClick={() => setSelected(null)}
        >
          <RankedAvatar avatarId={avatarId} />
          <span>Sin marco</span>
        </button>
        {frames.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={selected === f.id}
            disabled={busy}
            onClick={() => setSelected(f.id)}
          >
            <RankedAvatar avatarId={avatarId} frameId={f.id} />
            <span>{f.name}</span>
            {saved === f.id && <small>Equipado</small>}
          </button>
        ))}
      </div>
      {!busy && !frames.length && <p>Aún no tienes marcos adquiridos.</p>}
      {busy && <p role="status">Actualizando marcos…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="profile-frame-controls">
        <button
          type="button"
          disabled={busy || !legal || selected === saved}
          onClick={() => void onSave(selected)}
        >
          Guardar marco
        </button>
        <button type="button" disabled={busy} onClick={onReload}>
          Actualizar
        </button>
      </div>
      {!busy && !error && selected === saved && (
        <p role="status">Marco actual guardado.</p>
      )}
    </section>
  );
}
export function ProfileFramePicker({ avatarId }: { avatarId: string }) {
  const cosmetics = useCosmeticView(),
    busy = useCardCosmetics((s) => s.busy),
    error = useCardCosmetics((s) => s.error),
    scope = useCardCosmetics((s) => s.scope);
  useEffect(() => {
    void useCardCosmetics.getState().load(true);
  }, []);
  return (
    <FramePickerView
      key={`${scope}:${cosmetics.equipped.PROFILE_FRAME ?? "none"}`}
      cosmetics={cosmetics}
      avatarId={avatarId}
      busy={busy}
      error={error}
      onSave={(id) => useCardCosmetics.getState().equip("PROFILE_FRAME", id)}
      onReload={() => void useCardCosmetics.getState().load(true)}
    />
  );
}
