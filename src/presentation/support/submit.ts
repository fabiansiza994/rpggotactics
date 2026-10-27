import { BUG_REJECTION_LABEL, type BugReportRejection } from '../../game/support/bugReport';
import type { CloudResult } from '../cloud/http';
import type { BugReportBody, BugReportResponse } from './api';

export const REPORT_FAILED = 'No pudimos enviar el reporte. Intenta nuevamente.';
export const REPORT_RATE_LIMITED = 'Enviaste varios reportes seguidos. Intenta de nuevo más tarde.';
export const REPORT_SESSION_EXPIRED = 'Tu sesión venció. Inicia sesión de nuevo para reportar un problema.';

export type SubmitOutcome =
  | { status: 'SENT'; reportId: string }
  | { status: 'FAILED'; message: string; auth: boolean }
  /** A send is already in flight (double click / double tap): nothing was sent. */
  | { status: 'BUSY' };

const newClientId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? `rep_${crypto.randomUUID()}` : `rep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * One report draft's sender. While a send is in flight further calls return BUSY. The client id
 * stays the same until a send succeeds, so retrying after a lost response stores the report once.
 */
export function createReportSubmitter(send: (body: BugReportBody) => Promise<CloudResult<BugReportResponse>>) {
  let inFlight = false;
  let clientReportId = newClientId();
  return {
    get busy() {
      return inFlight;
    },
    async submit(draft: Omit<BugReportBody, 'clientReportId'>): Promise<SubmitOutcome> {
      if (inFlight) return { status: 'BUSY' };
      inFlight = true;
      try {
        const res = await send({ ...draft, clientReportId });
        if (res.ok) {
          clientReportId = newClientId();
          return { status: 'SENT', reportId: res.data.reportId };
        }
        const { error } = res;
        if (error.kind === 'AUTH') return { status: 'FAILED', message: REPORT_SESSION_EXPIRED, auth: true };
        if (error.status === 429) return { status: 'FAILED', message: REPORT_RATE_LIMITED, auth: false };
        // Validation messages are our own fixed texts; anything else stays generic (no raw errors).
        const known = error.status === 400 && Object.hasOwn(BUG_REJECTION_LABEL, error.code);
        return { status: 'FAILED', message: known ? BUG_REJECTION_LABEL[error.code as BugReportRejection] : REPORT_FAILED, auth: false };
      } catch {
        return { status: 'FAILED', message: REPORT_FAILED, auth: false };
      } finally {
        inFlight = false;
      }
    },
  };
}
