#!/usr/bin/env python3
"""Read-only Live OAuth verification. Secrets stay in memory, never in argv/files/output."""
import base64
import hashlib
import getpass
import json
import sys
import ssl
import socket
import os
from pathlib import Path
from datetime import datetime, timezone
import urllib.error
import urllib.parse
import urllib.request

ORIGIN = 'https://api-m.paypal.com'
WEBHOOK_URL = 'https://rpggo-tactics-api.fabiansiza994.workers.dev/api/tactics/store/paypal/live/webhook'
REQUIRED = {'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DECLINED',
            'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED',
            'CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED'}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def tls_context():
    context = ssl.create_default_context()
    # The python.org macOS installation may have no CA bundle until its optional
    # certificate installer runs. Use the existing macOS trust bundle, never -k.
    if (sys.platform == 'darwin' and not context.get_ca_certs() and
            not os.environ.get('SSL_CERT_FILE') and not os.environ.get('SSL_CERT_DIR')):
        system_ca = Path('/etc/ssl/cert.pem')
        if system_ca.is_file():
            context.load_verify_locations(cafile=str(system_ca))
    return context

OPENER = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=tls_context()))

def request(path, authorization, data=None):
    # Exact allowlist: this program cannot create/capture orders or register webhooks.
    if (path, data is not None) not in {('/v1/oauth2/token', True), ('/v1/notifications/webhooks', False)}:
        raise ValueError('Operation outside read-only verification')
    req = urllib.request.Request(ORIGIN + path, data=data,
        headers={'Authorization': authorization, 'Content-Type':'application/x-www-form-urlencoded', 'Accept':'application/json'})
    with OPENER.open(req, timeout=15) as response:
        return json.loads(response.read(1_000_000))

def network_message(error):
    reason = error.reason if isinstance(error, urllib.error.URLError) else error
    if isinstance(reason, ssl.SSLCertVerificationError):
        return 'TLS: no se pudo verificar el certificado. No se desactivará la validación HTTPS.'
    if isinstance(reason, socket.gaierror):
        return 'DNS: no se pudo resolver api-m.paypal.com.'
    if isinstance(reason, (TimeoutError, socket.timeout)):
        return 'RED: se agotó el tiempo de conexión con PayPal.'
    if isinstance(reason, json.JSONDecodeError):
        return 'RESPUESTA: PayPal no devolvió un JSON válido.'
    return 'RED: no se completó la conexión o la respuesta no fue válida.'


def check_connection():
    try:
        # No credentials: an authentication rejection proves HTTPS connectivity.
        request('/v1/oauth2/token', '', b'grant_type=client_credentials')
    except urllib.error.HTTPError as error:
        if error.code in (400, 401):
            print('Conexión HTTPS con PayPal Live: PASS (sin credenciales).')
            return True
        print('Conexión PayPal: respuesta HTTP', error.code, '(sin payloads).')
        return False
    except Exception as error:
        print(network_message(error))
        return False
    print('Respuesta inesperada al sondeo sin credenciales. Verificación detenida.')
    return False


def main():
    if sys.argv[1:] == ['--check-connection']:
        return 0 if check_connection() else 1
    if sys.argv[1:]:
        print('Solo se admite --check-connection, sin credenciales en argumentos.')
        return 2
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        print('Se requiere una Terminal interactiva segura; no usar pipes ni archivos de credenciales.')
        return 2
    print('Solo OAuth Live y lectura de webhooks. No crea órdenes, no captura pagos ni despliega nada.')
    print('Copia únicamente las credenciales de la aplicación RPG-GO Tactics en modo Live.')
    if not check_connection():
        print('No se solicitarán credenciales hasta resolver la conexión.')
        return 1
    client_id = getpass.getpass('Client ID Live (oculto): ').strip()
    secret = getpass.getpass('Client Secret Live vigente (oculto): ').strip()
    merchant = getpass.getpass('Merchant ID de la cuenta Business (oculto): ').strip()
    merchant_proof = Path(__file__).resolve().parents[2] / 'qa/paypal-live-closure-20261119/merchant-ui.json'
    try:
        expected = json.loads(merchant_proof.read_text())['merchantIdSha256']
        merchant_verified = hashlib.sha256(merchant.encode()).hexdigest() == expected
    except (OSError, ValueError, KeyError):
        merchant_verified = False
    if not merchant_verified:
        print('Merchant ID: no coincide con la cuenta Business revisada o falta su evidencia. No se enviarán credenciales.')
        return 2
    if not client_id or not secret:
        print('Cancelado: faltan credenciales. No se hizo ninguna solicitud.')
        return 2
    try:
        authorization = 'Basic ' + base64.b64encode((client_id + ':' + secret).encode()).decode()
        oauth = request('/v1/oauth2/token', authorization, b'grant_type=client_credentials')
        token = oauth.get('access_token')
        if not isinstance(token, str) or not token:
            print('OAuth Live: FAIL (sin token válido).')
            return 1
        print('OAuth Live: PASS — autenticación real, sin órdenes ni cobros.')
        # No token, client ID, secret, app ID or private webhook ID is emitted.
        webhooks = request('/v1/notifications/webhooks', 'Bearer ' + token).get('webhooks', [])
        match = next((hook for hook in webhooks if hook.get('url') == WEBHOOK_URL), None)
        names = {event.get('name') for event in (match or {}).get('event_types', [])}
        print('Webhook con URL prevista:', 'registrado' if match else 'pendiente de registro')
        print('Suscripción a eventos requeridos:', 'PASS' if REQUIRED <= names else 'pendiente/incompleta')
        print('Merchant ID: coincide con la cuenta Business revisada. El beneficiario de una captura real sigue sin comprobarse.')
        print('Aprobación comercial y entrega auténtica: no certificadas por OAuth.')
        proof = {'at': datetime.now(timezone.utc).isoformat(), 'provider': ORIGIN,
                 'oauthAuthenticated': True, 'webhookRegistered': bool(match),
                 'requiredEventsPresent': REQUIRED <= names, 'merchantVerified': merchant_verified,
                 'executedBy': 'user interactive terminal', 'ordersCreated': False, 'capturesCreated': False}
        output = Path(__file__).resolve().parents[2] / 'qa/paypal-live-closure-20261119/oauth-real.json'
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(proof, indent=2))
        print('Evidencia sin secretos guardada en qa/paypal-live-closure-20261119/oauth-real.json')
        print('No se guardaron credenciales ni se modificó el backend.')
        return 0
    except urllib.error.HTTPError as error:
        print('Verificación Live: FAIL — respuesta HTTP', error.code, '(sin mostrar payloads).')
        return 1
    except Exception as error:
        print(network_message(error))
        return 1
    finally:
        client_id = secret = merchant = authorization = token = oauth = None

if __name__ == '__main__':
    raise SystemExit(main())
