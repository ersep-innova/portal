# Permisos de Salida ERSeP — puesta en marcha

## 1. Qué se agregó

- `modulos/permisos-salida/index.html`: interfaz GitHub Pages.
- `assets/css/permisos.css`: estética y responsive.
- `assets/js/permisos-*.js`: API, autenticación y lógica UI.
- `backend-permisos/`: FastAPI + PostgreSQL + Google Sheets.
- `render.yaml`: segundo Web Service y una base PostgreSQL.
- tarjeta nueva en `index.html` del Portal.

## 2. Arquitectura

`GitHub Pages -> Render/FastAPI -> PostgreSQL -> Google Sheets (copia RR.HH.)`

PostgreSQL es la fuente oficial. Google Sheets es una vista sincronizada.

## 3. Crear las credenciales Google para LOGIN

En Google Cloud Console:

1. Crear o elegir un proyecto.
2. Configurar la pantalla de consentimiento OAuth.
3. Crear **OAuth Client ID > Web application**.
4. En **Authorized JavaScript origins** agregar:
   - `https://ersepobservatorio-cyt.github.io`
   - para pruebas locales: `http://localhost:8000`
5. Copiar el Client ID.
6. Pegar el mismo Client ID en:
   - `assets/js/permisos-config.js` -> `GOOGLE_CLIENT_ID`
   - Render -> variable `GOOGLE_OAUTH_CLIENT_ID`

El Client ID es público. No es una contraseña.

## 4. Primer administrador

En Render, definir:

`BOOTSTRAP_ADMIN_EMAILS=tu_cuenta_google@gmail.com`

La primera vez que esa cuenta inicia sesión, el backend crea automáticamente el usuario y le asigna `AGENTE + ADMIN`.

Desde **Administración** podés después crear los demás usuarios, asignar roles y jefaturas.

## 5. Render + PostgreSQL

El `render.yaml` define:

- `portal-observatorio-ersep-boletin` (existente)
- `portal-observatorio-ersep-permisos` (nuevo)
- `ersep-permisos-db` (PostgreSQL)

Al crear/sincronizar el Blueprint, Render solicitará las variables marcadas `sync: false`.

### Importante

La base gratuita de Render se utiliza sólo para beta/aprendizaje. Antes de cargar datos institucionales reales hay que migrar a un plan persistente y revisar política institucional de alojamiento de datos personales.

## 6. Configurar Google Sheets RR.HH.

1. Crear un Google Sheet privado, por ejemplo `PERMISOS DE SALIDA — RR.HH.`.
2. Crear una Service Account en Google Cloud.
3. Habilitar Google Sheets API (y Drive API si se usa para localizar archivos).
4. Crear una clave JSON de la Service Account.
5. Compartir el Sheet **como editor** con el email de la Service Account.
6. En Render:
   - `GOOGLE_SHEET_ID`: el ID de la URL del Sheet.
   - `GOOGLE_CREDENTIALS_JSON`: contenido completo del JSON de la Service Account.
7. En `assets/js/permisos-config.js`, opcionalmente colocar `RRHH_SHEET_URL` para mostrar el botón "Abrir Google Sheets" a RR.HH./ADMIN.

No subir el JSON de credenciales a GitHub.

## 7. Primera prueba

1. Publicar la rama en GitHub.
2. Confirmar que `modulos/permisos-salida/` abre desde GitHub Pages.
3. Confirmar `https://portal-observatorio-ersep-permisos.onrender.com/api/health`.
4. Iniciar sesión con el email configurado en `BOOTSTRAP_ADMIN_EMAILS`.
5. En Administración, crear:
   - un usuario JEFE;
   - un usuario AGENTE y asignarle ese jefe;
   - un usuario RRHH.
6. Ingresar como AGENTE y crear un permiso.
7. Enviarlo al jefe.
8. Ingresar como JEFE y autorizar.
9. Ingresar como RRHH y verificar.
10. Pulsar `Sincronizar Sheets`.

## 8. Seguridad aplicada

- GitHub Pages no contiene DNI, permisos ni credenciales de PostgreSQL.
- PostgreSQL se define con `ipAllowList: []`, bloqueando acceso público directo en Render; FastAPI usa la conexión interna.
- Cada request protegido lleva un Google ID Token.
- FastAPI verifica criptográficamente el token con Google y además consulta roles en PostgreSQL.
- Un agente sólo puede consultar sus permisos.
- Un jefe sólo puede actuar sobre permisos asignados a él.
- RR.HH. tiene acceso transversal.
- Las credenciales de la Service Account sólo viven en secretos de Render.

## 9. Estados del workflow

`BORRADOR -> PENDIENTE_JEFE -> PENDIENTE_RRHH -> VERIFICADO_RRHH`

Alternativas:

- `PENDIENTE_JEFE -> RECHAZADO`
- futura: `CANCELADO_AGENTE`

## 10. Tablas PostgreSQL

- `usuarios`
- `roles`
- `usuario_roles`
- `jefaturas`
- `feriados`
- `permisos_salida`
- `aprobaciones`
- `historial_permiso`
- `reposiciones`
- `sync_sheets`

El esquema se crea automáticamente al iniciar el backend en esta beta (`schema.sql`). Para producción conviene pasar a migraciones versionadas (Alembic).
