# 📱 NFC Studio Web

Aplicación web progresiva diseñada para **grabar y leer chips NFC** (NTAG213, NTAG215, NTAG216, Mifare Ultralight, pulseras y llaveros NFC) directamente desde **dispositivos Android** usando **Google Chrome**, sin necesidad de instalar archivos APK o tiendas de aplicaciones.

---

## 🚀 Inicio Rápido (En tu Mac)

1. Haz doble clic en el archivo `iniciar_servidor.command` (o ejecuta `python3 server.py` en la terminal).
2. Verás en pantalla una dirección HTTPS con tu IP local, por ejemplo:
   ```
   https://192.168.1.50:8443
   ```
3. Abre esa URL en **Google Chrome en tu teléfono Android** (ambos dispositivos deben estar conectados al mismo Wi-Fi).
4. Como el certificado es generado localmente, Chrome mostrará una advertencia de seguridad. Simplemente toca en **"Configuración avanzada"** -> **"Continuar a la página (no seguro)"**.
5. ¡Listo! Ya puedes empezar a leer y grabar chips NFC.

> **Nota:** También puedes probar toda la aplicación directamente en tu Mac usando el **Modo Simulador**, que emula lecturas, grabaciones y respuestas hápticas/sonoras.

---

## ✨ Características Principales

### 1. Tipos de Grabación NDEF Soportados
- 🔗 **Enlaces Web (URLs):** Perfiles de Instagram, sitios web, menús digitales, Google Maps, etc.
- 📝 **Texto Plano:** Códigos de inventario, claves, números de serie, notas.
- 👤 **Tarjeta de Contacto (vCard 3.0):** Nombre, teléfono, correo, empresa, cargo y sitio web. Al apoyar el chip, Android abre directamente la agenda de contactos para guardarlo.
- 📶 **Red Wi-Fi:** Al tocar el chip, el teléfono se conecta automáticamente a la red Wi-Fi configurada (WPA/WPA2/WPA3 o abiertas).
- 💬 **WhatsApp Directo:** Enlace directo para abrir un chat de WhatsApp con un número y mensaje preconfigurado.
- 📞 **Llamada Telefónica:** Marca automáticamente un número de teléfono.
- ✉️ **Correo Electrónico:** Abre el cliente de correo con destinatario, asunto y mensaje predefinidos.
- 📦 **Personalizado / JSON:** Carga cualquier estructura de datos con tipos MIME específicos.

### 2. Modo Grabación en Lote (Batch Mode)
Si tienes que grabar 10, 50 o 100 chips con la misma información (o consecutivos):
- Activa el interruptor **"Modo Grabación en Lote"**.
- Pulsa **"Iniciar Grabación NFC"**.
- Simplemente ve apoyando un chip tras otro sobre la espalda del celular. La app emitirá un sonido de éxito y actualizará el contador automáticamente sin que tengas que volver a pulsar la pantalla.

### 3. Estimador de Capacidad en Tiempo Real
Te indica cuántos bytes ocupará tu mensaje y si entra en un chip **NTAG213** (144 bytes), **NTAG215** (504 bytes) o **NTAG216** (888 bytes).

### 4. Opción de Bloqueo (Solo Lectura)
Interruptor de seguridad para proteger el chip contra sobreescrituras accidentales o intencionales (ideal para credenciales de acceso o tarjetas públicas).

### 5. Lector y Clonador NFC
- Lee el número de serie único (**UID**) del chip.
- Decodifica todos los registros NDEF contenidos.
- Botón **"Cargar este contenido en el Grabador"** para clonar un chip fácilmente.

### 6. Historial Local
Guarda automáticamente los últimos chips grabados en la memoria del navegador (`localStorage`) para que puedas reutilizar cualquier configuración con un solo clic.

---

## 🌐 Publicar en Internet (Acceso directo por HTTPS)

Si prefieres no usar el servidor de tu Mac y tener una URL pública disponible 24/7 en tu celular:
1. Sube esta carpeta a un repositorio en **GitHub**.
2. Ve a **Settings -> Pages** y activa **GitHub Pages** en la rama principal.
3. Tendrás una URL oficial HTTPS (ej: `https://tu-usuario.github.io/nfc-writer/`) que podrás abrir en cualquier Android con NFC sin configurar nada más.
