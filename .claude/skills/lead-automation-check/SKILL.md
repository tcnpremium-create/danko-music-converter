---
name: lead-automation-check
description: Revisa el flujo de leads (formularios → función/webhook → correo/CRM) de un proyecto sin enviar nada real.
---
1. Localiza formularios y las funciones/endpoints/webhooks que los reciben (según el repo).
2. Verifica: validación servidor, anti-spam, consentimiento RGPD, manejo de errores, logs sin datos personales, uso de variables de entorno (solo nombres).
3. Simula con payloads ficticios en local/mocks. NO llames a endpoints de producción ni envíes correos.
4. Informa de fallos y de lo no verificado.
