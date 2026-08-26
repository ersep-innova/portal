# Permisos de Salida V3.2 · Gmail API por HTTPS

Esta versión deja de depender de SMTP para Gmail. El backend obtiene un `access_token` de Google mediante OAuth 2.0 y envía cada mensaje con:

`POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`

Así el envío usa HTTPS/443 y funciona en Render Free.

## 1. Cuenta remitente

Cuenta elegida: `ersep.observatorio@gmail.com`.

La cuenta se usa únicamente como remitente automático. El inicio de sesión de Permisos de Salida sigue siendo usuario + clave local.

## 2. Crear o elegir un proyecto en Google Cloud

1. Entrar en Google Cloud Console con la cuenta que administrará la integración.
2. Crear un proyecto nuevo, por ejemplo `ERSeP Permisos de Salida`, o seleccionar uno existente destinado a este sistema.
3. Abrir **APIs y servicios / Biblioteca**.
4. Buscar **Gmail API**.
5. Pulsar **Habilitar / Enable**.

## 3. Configurar Google Auth Platform / pantalla OAuth

En el proyecto, abrir **Google Auth Platform** (en algunas vistas todavía aparece como **OAuth consent screen / Pantalla de consentimiento OAuth**).

Configurar:

- Nombre de la aplicación: `Permisos de Salida ERSeP`.
- Correo de soporte: la cuenta administradora que corresponda.
- Audiencia: **External / Externa** si se usa una cuenta `gmail.com`.
- Agregar `ersep.observatorio@gmail.com` como usuario de prueba mientras se configura.
- En **Data Access / Acceso a datos**, agregar únicamente este scope:

`https://www.googleapis.com/auth/gmail.send`

No hace falta pedir acceso de lectura al buzón.

### Importante sobre el modo Testing

Para que el sistema funcione de manera continua, conviene pasar el proyecto a **In production / En producción** antes de generar el refresh token definitivo. Si queda en **Testing / En prueba**, Google puede hacer que el refresh token expire a los 7 días al usar scopes como `gmail.send`.

Para un uso limitado/personal con pocos usuarios puede aparecer el aviso de “app no verificada”. La única cuenta que debe autorizar el envío es `ersep.observatorio@gmail.com`.

## 4. Crear credenciales OAuth 2.0

1. Ir a **APIs y servicios → Credenciales** o **Google Auth Platform → Clients**.
2. Elegir **Create OAuth client / Crear cliente OAuth**.
3. Tipo: **Web application / Aplicación web**.
4. Nombre sugerido: `Permisos Salida Gmail Sender`.
5. En **Authorized redirect URIs / URI de redireccionamiento autorizados** agregar exactamente:

`https://developers.google.com/oauthplayground`

6. Crear el cliente.
7. Copiar y guardar temporalmente:
   - **Client ID**.
   - **Client secret**.

No subir el Client secret a GitHub.

## 5. Obtener el refresh token con OAuth 2.0 Playground

Abrir:

`https://developers.google.com/oauthplayground/`

1. Pulsar el engranaje de configuración.
2. Marcar **Use your own OAuth credentials**.
3. Verificar:
   - OAuth flow: **Server-side**.
   - Access type: **Offline**.
   - Force prompt: **Consent Screen**.
4. Pegar el **Client ID** y **Client secret** creados en el paso anterior.
5. Cerrar el panel.
6. En **Step 1**, en “Input your own scopes”, pegar:

`https://www.googleapis.com/auth/gmail.send`

7. Pulsar **Authorize APIs**.
8. Elegir `ersep.observatorio@gmail.com` y autorizar el envío de correo.
9. Volver al Playground.
10. En **Step 2**, pulsar **Exchange authorization code for tokens**.
11. Copiar el valor **Refresh token**.

No copiar el `access_token` a Render: dura poco tiempo. El backend genera y renueva automáticamente los access tokens usando el refresh token.

No compartir el refresh token por chat, correo o GitHub.

## 6. Variables de entorno en Render

En el Web Service `portal-observatorio-ersep-permisos` → **Environment**, dejar/agregar:

```text
EMAIL_ENABLED=true
EMAIL_PROVIDER=gmail_api
EMAIL_FROM=ersep.observatorio@gmail.com
GMAIL_API_CLIENT_ID=<Client ID de Google Cloud>
GMAIL_API_CLIENT_SECRET=<Client secret de Google Cloud>
GMAIL_API_REFRESH_TOKEN=<Refresh token del OAuth Playground>
```

Las variables SMTP dejan de ser necesarias:

```text
SMTP_HOST
SMTP_PORT
SMTP_SSL
SMTP_USER
SMTP_PASSWORD
```

Se pueden eliminar después de comprobar que Gmail API funciona.

Luego hacer **Save and Deploy**.

## 7. Primera prueba

Cuando Render quede `Live`:

1. Abrir Permisos de Salida.
2. Entrar como administrador.
3. Confirmar que el administrador tenga un email real cargado.
4. Pulsar **Probar correo**.

Si funciona, el popup debe informar éxito y Gmail devolverá un ID de mensaje que el backend registra como `proveedor_id`.

## 8. Prueba del flujo completo

Con un agente cuyo email sea real:

1. Crear un permiso.
2. Enviarlo a Jefatura → debe llegar `SOLICITUD_ENVIADA`.
3. Aprobar o rechazar en Jefatura → debe llegar `JEFATURA_APROBADO` o `JEFATURA_RECHAZADO`.
4. Si fue aprobado, verificar o rechazar en RR.HH. → debe llegar `RRHH_APROBADO` o `RRHH_RECHAZADO`.

Los errores de correo no revierten la decisión del permiso. La auditoría queda en `notificaciones_email`.

## 9. Qué hace internamente V3.2

- Usa OAuth 2.0 sobre HTTPS para obtener un access token desde `https://oauth2.googleapis.com/token`.
- Guarda el access token temporalmente en memoria y lo renueva antes de vencer.
- El `refresh_token`, `client_secret` y `client_id` permanecen sólo como variables del backend en Render.
- Construye el mensaje MIME HTML + texto plano.
- Lo codifica en base64URL.
- Lo envía a Gmail API mediante `users.messages.send`.
- Si Gmail devuelve 401, fuerza una renovación del token y reintenta una vez.
- Mantiene la compatibilidad con Resend y SMTP, aunque para Render Free el proveedor recomendado es `gmail_api`.

## 10. Después de confirmar Gmail API

La contraseña de aplicación de Google que se creó para SMTP ya no se necesita. Una vez comprobado el envío por API, puede revocarse desde **Cuenta de Google → Seguridad → Contraseñas de aplicaciones**.
