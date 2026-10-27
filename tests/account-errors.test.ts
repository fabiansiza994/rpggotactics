import { describe, expect, it } from 'vitest';
import { accountError } from '../src/presentation/cloud/accountErrors';
import type { CloudError } from '../src/presentation/cloud/http';
const error = (status: number, kind: CloudError['kind'] = 'REJECTED'): CloudError => ({
  status,
  kind,
  code: 'INTERNAL',
  message: 'private SQL stack trace',
});
describe('account error privacy', () => {
  it('never surfaces backend details, including unrecognized failures', () => {
    for (const action of ['login', 'register', 'recover'] as const)
      for (const status of [400, 401, 403, 409, 429, 500])
        expect(accountError(error(status), action)).not.toContain('SQL');
  });
  it('distinguishes rate limiting, network, service and invalidated recovery codes', () => {
    expect(accountError(error(429), 'login')).toContain('Demasiados intentos');
    expect(accountError(error(0, 'NETWORK'), 'login')).toContain('Revisa tu conexión');
    expect(accountError(error(503, 'SERVER'), 'register')).toContain('no está disponible');
    expect(accountError(error(401, 'AUTH'), 'recover')).toContain('ya utilizado');
  });
});
