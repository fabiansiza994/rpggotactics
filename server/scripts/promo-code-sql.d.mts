export const PROMO_CODE: RegExp;
export function promoRewardJson(reward: unknown): string;
export function promoCodeSql(input: {
  code: string;
  reward: unknown;
  active?: boolean;
  startsAt?: number | null;
  expiresAt?: number | null;
  maxGlobalUses?: number | null;
  note?: string | null;
  now: number;
}): string;
