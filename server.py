#!/usr/bin/env python3
"""
NFC Studio Server
Servidor local con soporte HTTP y HTTPS automático para probar Web NFC en Android.
"""

import http.server
import ssl
import socket
import os
import subprocess
import sys

PORT_HTTP = 8080
PORT_HTTPS = 8443
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

def get_local_ip():
    """Detecta la IP local de tu Mac en la red Wi-Fi."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

def ensure_ssl_cert():
    """Genera un certificado SSL autofirmado si no existe."""
    cert_path = os.path.join(DIRECTORY, 'cert.pem')
    key_path = os.path.join(DIRECTORY, 'key.pem')

    if not os.path.exists(cert_path) or not os.path.exists(key_path):
        print("🔒 Generando certificado SSL autofirmado para Web NFC...")
        cmd = [
            'openssl', 'req', '-new', '-x509',
            '-keyout', key_path,
            '-out', cert_path,
            '-days', '365',
            '-nodes',
            '-subj', '/CN=nfc-studio.local'
        ]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print("✅ Certificado SSL generado con éxito.")
        except Exception as e:
            print(f"⚠️ No se pudo generar SSL automático: {e}")
            return None, None
            
    return cert_path, key_path

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Permite acceso a Web NFC y headers necesarios
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def main():
    os.chdir(DIRECTORY)
    local_ip = get_local_ip()
    cert_path, key_path = ensure_ssl_cert()

    use_https = cert_path and os.path.exists(cert_path)
    port = PORT_HTTPS if use_https else PORT_HTTP
    protocol = 'https' if use_https else 'http'

    server_address = ('0.0.0.0', port)
    httpd = http.server.HTTPServer(server_address, CustomHandler)

    if use_https:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=cert_path, keyfile=key_path)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    print("\n" + "=" * 58)
    print(" 🚀  NFC STUDIO - SERVIDOR INICIADO ")
    print("=" * 58)
    print(f"\n📱 Abre este enlace en Google Chrome desde tu Android:")
    print(f"   👉 \033[1;36m{protocol}://{local_ip}:{port}\033[0m")
    print(f"\n💻 O en tu Mac (para usar el Simulador):")
    print(f"   👉 \033[1;32m{protocol}://localhost:{port}\033[0m")
    
    print("\n" + "-" * 58)
    print("💡 CONSEJO PARA ANDROID:")
    if use_https:
        print("  1. Tu celular y Mac deben estar en la misma red Wi-Fi.")
        print("  2. En Chrome Android saldrá 'La conexión no es privada'.")
        print("     Pulsa 'Configuración avanzada' -> 'Continuar a la página'.")
    else:
        print("  Para habilitar Web NFC sin certificados:")
        print(f"  Conecta por USB y corre: adb reverse tcp:{PORT_HTTP} tcp:{PORT_HTTP}")
        print(f"  Luego abre en tu Android: http://localhost:{PORT_HTTP}")
    print("-" * 58)
    print("Presiona Ctrl + C para detener el servidor.\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido. ¡Hasta luego!")

if __name__ == '__main__':
    main()
