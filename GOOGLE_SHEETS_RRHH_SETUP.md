# Conexión Google Sheets — Permisos de Salida

PostgreSQL sigue siendo la fuente oficial. Google Sheets es una vista sincronizada para RR.HH.

Variables de Render requeridas:

- `GOOGLE_SHEET_ID`
- `GOOGLE_CREDENTIALS_JSON`
- `SHEETS_ENABLED=true`

La cuenta de servicio debe tener acceso **Editor** al Google Sheet.

Al sincronizar se crean/actualizan las pestañas `PERMISOS`, `REPOSICIONES` y `RESUMEN`. Esas pestañas son administradas por el sistema y se reescriben en cada sincronización.
