# Google Sheets RR.HH. V4 — OAuth

Esta versión reemplaza la autenticación por Service Account/JSON por OAuth 2.0 con una cuenta Google real.

## Variables de Render

Mantener:
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_SHEET_ID`
- `SHEETS_ENABLED=true`

Agregar:
- `GOOGLE_OAUTH_CLIENT_SECRET` = Client Secret del OAuth Web Client
- `GOOGLE_SHEETS_REDIRECT_URI` = `https://portal-observatorio-ersep-permisos.onrender.com/api/google-sheets/callback`
- `PERMISOS_FRONTEND_URL` = `https://ersepobservatorio-cyt.github.io/portal-observatorio-ersep/modulos/permisos-salida/`

Ya no se usa:
- `GOOGLE_CREDENTIALS_JSON`

## Google Cloud
1. Habilitar Google Sheets API.
2. En Google Auth Platform > Clients > ERSeP Permisos Web:
   - Authorized JavaScript origin: `https://ersepobservatorio-cyt.github.io`
   - Authorized redirect URI: `https://portal-observatorio-ersep-permisos.onrender.com/api/google-sheets/callback`
3. Copiar el Client Secret y guardarlo solamente en Render.

## Google Sheet
Crear una planilla con la cuenta que RR.HH. utilizará y copiar su Sheet ID.

## Conexión
1. Entrar al módulo con un usuario RRHH o ADMIN.
2. Abrir RR.HH.
3. Pulsar `Conectar Google Sheets`.
4. Elegir la cuenta Google que tiene acceso al Sheet.
5. Aceptar acceso.
6. Google vuelve al backend y luego al Portal.
7. Pulsar `Sincronizar Sheets`.

PostgreSQL sigue siendo la fuente oficial.
