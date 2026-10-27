import type { CloudError } from './http';

/** Player-facing, allowlisted messages: never render an arbitrary auth response. */
export function accountError(error: CloudError, action: 'login' | 'register' | 'recover'): string {
  if (error.kind === 'NETWORK')
    return 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.';
  if (error.kind === 'TIMEOUT') return 'La conexión tardó demasiado. Inténtalo de nuevo.';
  if (error.status === 429)
    return 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.';
  if (error.kind === 'SERVER')
    return 'El servicio de cuentas no está disponible. Inténtalo más tarde.';
  if (error.status === 401)
    return action === 'recover'
      ? 'Usuario o código incorrectos. Un código ya utilizado deja de ser válido.'
      : 'Usuario o contraseña incorrectos.';
  if (error.status === 409 && action === 'register')
    return 'Ese usuario ya existe. Elige otro nombre o inicia sesión.';
  if (action === 'register')
    return 'No se pudo crear la cuenta. Comprueba los datos y repite la verificación de seguridad.';
  if (action === 'recover')
    return 'No se pudo recuperar la cuenta. Comprueba el código y la nueva contraseña.';
  return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
}
