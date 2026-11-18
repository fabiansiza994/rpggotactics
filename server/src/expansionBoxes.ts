import type { D1Database, D1PreparedStatement } from "./db";
import type { StoreOffer, PurchasePlan } from "../../src/game/store/store";
import {
  boxTotal,
  createBoxStock,
  validBoxSnapshot,
  type BoxSnapshot,
} from "../../src/game/store/boxes";
import type { GameContent } from "../../src/game/domain/content";
interface BoxRow {
  generation: number;
  version: number;
  revision: string;
  initial_json: string;
  remaining_json: string;
}
export async function loadExpansionBox(
  db: D1Database,
  userId: number,
  offer: StoreOffer,
  content: GameContent,
  now: number,
): Promise<BoxSnapshot> {
  const id = offer.booster?.expansionId;
  if (!id || offer.booster?.inventory !== "FINITE")
    throw Error("Not a finite box");
  let row = await db
    .prepare(
      "SELECT generation,version,revision,initial_json,remaining_json FROM tactics_expansion_boxes WHERE user_id=? AND expansion_id=?",
    )
    .bind(userId, id)
    .first<BoxRow>();
  if (!row) {
    const stock = createBoxStock(
      offer.contents.flatMap((c) =>
        c.kind === "CARD" && content.cards[c.cardId]
          ? [content.cards[c.cardId]!]
          : [],
      ),
    );
    await db
      .prepare(
        "INSERT OR IGNORE INTO tactics_expansion_boxes(user_id,expansion_id,revision,initial_json,remaining_json,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        userId,
        id,
        offer.booster.revision,
        JSON.stringify(stock),
        JSON.stringify(stock),
        now,
      )
      .run();
    row = await db
      .prepare(
        "SELECT generation,version,revision,initial_json,remaining_json FROM tactics_expansion_boxes WHERE user_id=? AND expansion_id=?",
      )
      .bind(userId, id)
      .first<BoxRow>();
  }
  if (!row) throw Error("Box initialization failed");
  const box = {
    generation: row.generation,
    version: row.version,
    revision: row.revision,
    initial: JSON.parse(row.initial_json),
    remaining: JSON.parse(row.remaining_json),
  } as BoxSnapshot;
  if (!validBoxSnapshot(box)) throw Error("Corrupt box");
  return box;
}
/** CAS and receipt guard share the purchase batch: a lost race rolls back debit, ownership and receipt. */
export function boxDebitStatements(
  db: D1Database,
  userId: number,
  plan: PurchasePlan,
  purchaseId: string,
  now: number,
): D1PreparedStatement[] {
  const d = plan.boxDebit;
  if (!d) return [];
  return [
    db
      .prepare(
        "UPDATE tactics_expansion_boxes SET remaining_json=?,version=version+1,updated_at=? WHERE user_id=? AND expansion_id=? AND generation=? AND version=? AND revision=?",
      )
      .bind(
        JSON.stringify(d.remaining),
        now,
        userId,
        d.expansionId,
        d.before.generation,
        d.before.version,
        d.before.revision,
      ),
    db
      .prepare(
        `UPDATE tactics_store_purchases SET status=CASE WHEN changes()=1 THEN status ELSE NULL END WHERE purchase_id=?`,
      )
      .bind(purchaseId),
  ];
}
export async function resetExpansionBox(
  db: D1Database,
  userId: number,
  offer: StoreOffer,
  content: GameContent,
  key: string,
  expectedGeneration: number,
  expectedVersion: number,
  now: number,
): Promise<{ box: BoxSnapshot; replayed: boolean }> {
  const previous = await db
    .prepare(
      "SELECT expansion_id,snapshot_json FROM tactics_box_resets WHERE user_id=? AND idempotency_key=?",
    )
    .bind(userId, key)
    .first<{ expansion_id: string; snapshot_json: string }>();
  if (previous) {
    if (previous.expansion_id !== offer.booster?.expansionId)
      throw Error("RESET_KEY_REUSED");
    return { box: JSON.parse(previous.snapshot_json), replayed: true };
  }
  const before = await loadExpansionBox(db, userId, offer, content, now);
  if (
    before.generation !== expectedGeneration ||
    before.version !== expectedVersion
  )
    throw Error("BOX_CHANGED");
  const stock = createBoxStock(
    offer.contents.flatMap((c) =>
      c.kind === "CARD" && content.cards[c.cardId]
        ? [content.cards[c.cardId]!]
        : [],
    ),
  );
  const box: BoxSnapshot = {
    generation: before.generation + 1,
    version: before.version + 1,
    revision: offer.booster!.revision,
    initial: stock,
    remaining: stock,
  };
  try {
    await db.batch([
      db
        .prepare(
          "UPDATE tactics_expansion_boxes SET generation=?,version=?,revision=?,initial_json=?,remaining_json=?,updated_at=? WHERE user_id=? AND expansion_id=? AND generation=? AND version=?",
        )
        .bind(
          box.generation,
          box.version,
          box.revision,
          JSON.stringify(stock),
          JSON.stringify(stock),
          now,
          userId,
          offer.booster!.expansionId,
          before.generation,
          before.version,
        ),
      db
        .prepare(
          `INSERT INTO tactics_box_resets(user_id,idempotency_key,expansion_id,from_generation,to_generation,snapshot_json,created_at) VALUES(?,?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END,?,?,?)`,
        )
        .bind(
          userId,
          key,
          offer.booster!.expansionId,
          before.generation,
          box.generation,
          JSON.stringify(box),
          now,
        ),
    ]);
  } catch {
    const raced = await db
      .prepare(
        "SELECT expansion_id,snapshot_json FROM tactics_box_resets WHERE user_id=? AND idempotency_key=?",
      )
      .bind(userId, key)
      .first<{ expansion_id: string; snapshot_json: string }>();
    if (raced && raced.expansion_id === offer.booster!.expansionId)
      return { box: JSON.parse(raced.snapshot_json), replayed: true };
    throw Error("BOX_CHANGED");
  }
  if (boxTotal(box.remaining) % 4) throw Error("Invalid reset");
  return { box, replayed: false };
}
