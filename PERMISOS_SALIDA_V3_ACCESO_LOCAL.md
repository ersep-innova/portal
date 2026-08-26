# Permisos de Salida V3 · Acceso local y correo

## Qué cambió

- Se eliminó Google Identity Services del inicio de sesión.
- El acceso ahora es por **usuario + clave** contra PostgreSQL.
- Las claves se almacenan con PBKDF2-SHA256 y salt aleatorio; no se guardan en texto plano.
- Las sesiones son tokens opacos guardados de forma hasheada en `sesiones_usuario` y vencen por defecto a las 12 horas.
- Se preservan las pestañas y roles: Agente, Jefatura, RR.HH. y Administración.
- Administración ahora permite definir `Usuario de acceso`, una clave inicial/nueva y el email para notificaciones.
- Se corrigieron los orígenes CORS para aceptar `https://ersep-innova.github.io`.
- El login se muestra inmediatamente: el despertar de Render ocurre en paralelo y ya no congela la interfaz.
- Google Sheets queda opcional y desactivado por defecto (`SHEETS_ENABLED=false`).
- El envío recomendado de correos usa Gmail API por HTTPS, compatible con Render Free; SMTP queda sólo como compatibilidad heredada.

## Variables mínimas en Render para poder entrar

Mantener `DATABASE_URL` como está y agregar/configurar:

- `BOOTSTRAP_ADMIN_USERNAME=admin`
- `BOOTSTRAP_ADMIN_PASSWORD=<una clave temporal que sólo conozcan ustedes>`
- `BOOTSTRAP_ADMIN_EMAIL=<email real del administrador>`
- `AUTH_SESSION_HOURS=12`
- `FRONTEND_ORIGINS=https://ersep-innova.github.io,https://ersepobservatorio-cyt.github.io`

La contraseña inicial **no debe subirse a GitHub**. Por eso `render.yaml` la deja como `sync: false`.

Al iniciar el backend, si existe un usuario anterior con el mismo email, se migra a acceso local sin duplicarlo. Si no existe, se crea el administrador inicial.

## Crear usuarios

Entrar con el administrador → pestaña **Administración** → completar:

- Usuario de acceso.
- Clave inicial de al menos 6 caracteres.
- Email para notificaciones.
- Nombre, apellido, legajo, DNI y área.
- Jornada.
- Roles.
- Email de su jefe inmediato, si corresponde.

Al editar un usuario, dejar la clave vacía conserva la clave actual.

## Gmail para notificaciones automáticas

La versión V3.2 usa Gmail API por HTTPS en lugar de SMTP. Ver la guía completa `GMAIL_API_HTTPS_SETUP.md`.

Variables principales en Render:

- `EMAIL_ENABLED=true`
- `EMAIL_PROVIDER=gmail_api`
- `EMAIL_FROM=ersep.observatorio@gmail.com`
- `GMAIL_API_CLIENT_ID=<OAuth Client ID>`
- `GMAIL_API_CLIENT_SECRET=<OAuth Client Secret>`
- `GMAIL_API_REFRESH_TOKEN=<OAuth Refresh Token>`

El botón **“Probar correo”** envía una prueba al email del administrador autenticado. Las notificaciones siguen disparándose en segundo plano cuando el agente envía una solicitud y cuando Jefatura/RR.HH. aprueban o rechazan. Un fallo de correo nunca revierte el cambio de estado ya guardado.

## Google Sheets

Para estabilizar primero Permisos de Salida, `SHEETS_ENABLED` queda en `false`. Esto evita que una autorización OAuth de Sheets interfiera con el circuito principal. Más adelante puede volver a habilitarse sin cambiar el login local.
