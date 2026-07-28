# GUÍA PASO A PASO — GitHub Pages + Render

## Parte A — Subir el proyecto a GitHub

1. Descargá y descomprimí el ZIP entregado.
2. Entrá al repositorio `ersepobservatorio-cyt/portal-observatorio-ersep`.
3. Reemplazá el contenido actual por **todo lo que está dentro** de la carpeta `portal-observatorio-ersep` del ZIP.
4. Confirmá que `index.html`, `render.yaml`, `assets/`, `modulos/` y `backend/` queden en la raíz del repositorio.
5. Confirmá los cambios en la rama `main`.

## Parte B — Confirmar GitHub Pages

1. Abrí **Settings** del repositorio.
2. En el menú lateral, abrí **Pages**.
3. En **Build and deployment**, elegí **Deploy from a branch**.
4. Elegí la rama `main`, carpeta `/(root)` y presioná **Save**.
5. Abrí `https://ersepobservatorio-cyt.github.io/portal-observatorio-ersep/`.

## Parte C — Crear el backend en Render

1. Iniciá sesión en Render con la cuenta de Google que administrará este backend.
2. Presioná **New +** y elegí **Blueprint**.
3. Conectá la cuenta de GitHub `ersepobservatorio-cyt` cuando Render lo solicite.
4. Autorizá el acceso al repositorio `portal-observatorio-ersep`.
5. Seleccioná ese repositorio. Render detectará `render.yaml`.
6. Confirmá la creación del servicio `portal-observatorio-ersep-boletin`.
7. Cuando Render solicite `APP_PASSWORD`, escribí la misma contraseña que usa el portal. No la agregues a ningún archivo.
8. `JWT_SECRET` se genera automáticamente por `render.yaml`.
9. Esperá a que el despliegue muestre **Live**.
10. Abrí `/api/health` en la URL del servicio. Debe responder con `"ok": true`.

## Parte D — Revisar la URL del backend

La configuración entregada espera:

`https://portal-observatorio-ersep-boletin.onrender.com`

Si Render asignó otra URL:

1. Abrí `assets/js/boletin-config.js` en GitHub.
2. Presioná el lápiz de edición.
3. Reemplazá únicamente el valor de `API_BASE_URL`.
4. Confirmá el cambio en `main`.
5. Esperá la actualización de GitHub Pages y recargá el portal con `Ctrl + F5`.

## Parte E — Probar

1. Entrá al portal y colocá la contraseña institucional.
2. Abrí **Buscador de Boletín Oficial**.
3. Verás el cartel **Estamos iniciando el servidor** si Render estaba dormido.
4. No recargues: el cartel desaparecerá solo cuando el backend responda y valide la contraseña.
5. Entrá en **Alertas**, comprobá que existan las alertas iniciales y luego realizá una prueba de monitoreo.

## Errores comunes

- **La contraseña de Render no coincide:** corregí `APP_PASSWORD` en Render → Environment y redeployá.
- **CORS / Failed to fetch:** verificá que `FRONTEND_ORIGINS` sea `https://ersepobservatorio-cyt.github.io` sin la ruta del repositorio.
- **El cartel nunca termina:** revisá que la URL de `boletin-config.js` coincida con la URL real de Render.
- **El historial desapareció:** es esperable en un Web Service gratuito sin disco persistente.
