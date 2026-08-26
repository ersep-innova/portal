# V3.2 · Gmail API por HTTPS

Cambio específico de Permisos de Salida:

- `EMAIL_PROVIDER=gmail_api`.
- Envío por `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`.
- OAuth 2.0 con `GMAIL_API_CLIENT_ID`, `GMAIL_API_CLIENT_SECRET` y `GMAIL_API_REFRESH_TOKEN`.
- Renovación automática del access token mediante `https://oauth2.googleapis.com/token`.
- Cache del access token y reintento único si Gmail responde 401.
- Se mantienen sin cambios login local, PostgreSQL, pestañas, roles y eventos de notificación.
- SMTP queda sólo como compatibilidad heredada; no es necesario para Render Free.

Ver `GMAIL_API_HTTPS_SETUP.md` para la configuración de Google Cloud, OAuth Playground y Render.
