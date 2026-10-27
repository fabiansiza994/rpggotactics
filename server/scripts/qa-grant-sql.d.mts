export const QA_USERNAME: RegExp;
export const QA_REFERENCE: RegExp;
export const QA_MAX_GRANT: number;
export const PREMIUM_CURRENCY_ID: string;
export function qaGrantSql(input: { username: string; amount: number; reference: string; transactionId: string; now: number }): string;
