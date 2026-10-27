export declare const STALE: { createdMs: number; pendingNoReferenceMs: number; reviewMs: number };
export declare function stuckOrdersSql(now: number, olderThanMs?: number): string;
export declare function reviewQueueSql(): string;
export declare function expireStaleSql(now: number): string;
export declare function disputeSql(input: { order: string; reason: string; now: number }): string;
export declare function reversalSql(input: { order: string; now: number; transactionId: string }): string;
export declare function packageUpdateSql(input: {
  pkg: string;
  priceCOP?: number;
  active?: boolean;
  sortOrder?: number;
  baseCrystals?: number;
  bonusCrystals?: number;
  now: number;
}): string;
export declare function reconcileCandidatesSql(): string;
