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
- El envío de correos puede funcionar por Gmail SMTP o, alternativamente, Resend.

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

Cuando tengan la cuenta de Google dedicada, en Render configurar:

- `EMAIL_ENABLED=true`
- `EMAIL_PROVIDER=gmail_smtp`
- `EMAIL_FROM=<cuenta que enviará>`
- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=465`
- `SMTP_SSL=true`
- `SMTP_USER=<misma cuenta Gmail/Workspace>`
- `SMTP_PASSWORD=<contraseña de aplicación de Google, no la contraseña normal>`

El botón **“Probar correo”** del panel de RR.HH./Administración envía una prueba al email del administrador autenticado.

Las notificaciones actuales se disparan en segundo plano cuando el agente envía una solicitud y cuando Jefatura/RR.HH. aprueban o rechazan. Si el correo falla, el acto administrativo ya guardado no se revierte; el error queda auditado en PostgreSQL.

## Google Sheets

Para estabilizar primero Permisos de Salida, `SHEETS_ENABLED` queda en `false`. Esto evita que una autorización OAuth de Sheets interfiera con el circuito principal. Más adelante puede volver a habilitarse sin cambiar el login local.
