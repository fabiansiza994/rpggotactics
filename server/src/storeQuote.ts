import { error, json } from "./http";
import type { StoreOffer } from "../../src/game/store/store";

/** Dedicated to store quotes. Never reuse auth, Turnstile or payment credentials. */
export const STORE_QUOTE_POLICY = "accumulated-copies-v1";
export const STORE_QUOTE_TTL_MS = 5 * 60_000;
const MAX_TOKEN_LENGTH = 16_384;
const encoder = new TextEncoder();
export type QuotedTerms = { price: number; contents: StoreOffer["contents"] };
interface SignedQuote {
  policy: string;
  scope: string;
  userId: number;
  offerId: string;
  issuedAt: number;
  expiresAt: number;
  terms: string;
}
export interface IssuedQuote {
  token: string;
  expiresAt: number;
}
export type QuoteError =
  | "QUOTE_REQUIRED"
  | "QUOTE_INVALID"
  | "QUOTE_EXPIRED"
  | "QUOTE_CHANGED"
  | "QUOTE_UPDATE_REQUIRED";
export const quoteSecretReady = (
  secret: string | undefined,
): secret is string => typeof secret === "string" && secret.length >= 32;

/** Stable across catalog ordering; only server-computed sale conditions are authoritative. */
export function quotedTerms(offer: StoreOffer, quote: QuotedTerms): string {
  const contents = quote.contents
    .map((c) =>
      c.kind === "CARD"
        ? { kind: c.kind, id: c.cardId, copies: c.copies }
        : { kind: c.kind, id: c.cosmeticId, copies: 1 },
    )
    .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  return JSON.stringify({
    heroId: offer.heroId ?? null,
    currencyId: offer.currencyId,
    price: quote.price,
    contents,
  });
}
const encode = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
function decode(text: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw Error("Malformed quote");
  const raw = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
const signingKey = (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
export async function issueQuote(
  secret: string,
  userId: number,
  offer: StoreOffer,
  quote: QuotedTerms,
  now: number,
  scope = "PURCHASE",
): Promise<IssuedQuote> {
  if (!quoteSecretReady(secret))
    throw Error("Store quote signing is not configured");
  const expiresAt = Math.min(now + STORE_QUOTE_TTL_MS, offer.endAt ?? Infinity);
  const payload = encode(
    encoder.encode(
      JSON.stringify({
        policy: STORE_QUOTE_POLICY,
        scope,
        userId,
        offerId: offer.id,
        issuedAt: now,
        expiresAt,
        terms: quotedTerms(offer, quote),
      } satisfies SignedQuote),
    ),
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    encoder.encode(payload),
  );
  return { token: `${payload}.${encode(new Uint8Array(sig))}`, expiresAt };
}
export async function readQuote(
  secret: string,
  token: unknown,
  userId: number,
  offerId: string,
  now: number,
  scope = "PURCHASE",
): Promise<{ ok: true; quote: SignedQuote } | { ok: false; code: QuoteError }> {
  if (token === undefined || token === null || token === "")
    return { ok: false, code: "QUOTE_REQUIRED" };
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH)
    return { ok: false, code: "QUOTE_INVALID" };
  try {
    const parts = token.split(".");
    if (parts.length !== 2) throw Error("Malformed quote");
    const [payload, signature] = parts as [string, string];
    const bytes = decode(payload);
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await signingKey(secret),
        decode(signature),
        encoder.encode(payload),
      ))
    )
      throw Error("Invalid signature");
    const q = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as SignedQuote;
    if (q.policy !== STORE_QUOTE_POLICY)
      return { ok: false, code: "QUOTE_UPDATE_REQUIRED" };
    if (
      q.scope !== scope ||
      q.userId !== userId ||
      q.offerId !== offerId ||
      typeof q.terms !== "string" ||
      !Number.isSafeInteger(q.issuedAt) ||
      !Number.isSafeInteger(q.expiresAt) ||
      q.expiresAt <= q.issuedAt ||
      q.expiresAt - q.issuedAt > STORE_QUOTE_TTL_MS ||
      q.issuedAt > now + 5000
    )
      throw Error("Incompatible quote");
    if (now >= q.expiresAt) return { ok: false, code: "QUOTE_EXPIRED" };
    return { ok: true, quote: q };
  } catch {
    return { ok: false, code: "QUOTE_INVALID" };
  }
}

export function quoteFailure(code: QuoteError) {
  return error(
    code === "QUOTE_REQUIRED" || code === "QUOTE_UPDATE_REQUIRED" ? 426 : 409,
    code,
    code === "QUOTE_REQUIRED" || code === "QUOTE_UPDATE_REQUIRED"
      ? "Esta versión de la compra necesita actualizarse. Recarga la página y confirma las condiciones actuales; este intento no se ha cobrado."
      : "La cotización venció, cambió o no es válida. Actualiza la tienda y confirma las condiciones actuales; este intento no se ha cobrado.",
  );
}

/** Personalized signed quotes must never be reused from a shared/browser cache. */
export function quoteResponse(body: unknown) {
  const response = json(body);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
