import type { BugCategory, BugReportContext } from '../../game/support/bugReport';
import { CLOUD_CONFIG } from '../cloud/config';
import { request } from '../cloud/http';

export interface BugReportResponse {
  success: true;
  reportId: string;
  /** The same submission (clientReportId) was already stored: this is its id. */
  replayed?: boolean;
}

export interface BugReportBody {
  category: BugCategory;
  description: string;
  reproductionSteps: string | null;
  context: BugReportContext;
  clientReportId: string;
}

/** Identity comes from the Bearer token; the body never names a user. */
export const supportApi = {
  sendBugReport: (token: string, body: BugReportBody) =>
    request<BugReportResponse>(CLOUD_CONFIG.apiUrl, '/api/tactics/support/bug-reports', {
      method: 'POST',
      token,
      body,
      timeoutMs: CLOUD_CONFIG.timeoutMs,
    }),
};
