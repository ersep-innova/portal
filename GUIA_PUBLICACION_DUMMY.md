# GUÍA PASO A PASO — PUBLICAR EL PORTAL Y EL BOLETÍN

## A. Reemplazar el proyecto en GitHub

1. Descargá y descomprimí el ZIP entregado.
2. Entrá al repositorio `ersepobservatorio-cyt/portal-observatorio-ersep`.
3. Reemplazá el contenido actual por todo el contenido de la carpeta del proyecto.
4. Verificá que `index.html`, `render.yaml`, `assets/`, `modulos/` y `backend/` queden directamente en la raíz.
5. Confirmá los cambios en la rama `main`.

## B. Confirmar GitHub Pages

1. Abrí **Settings** en el repositorio.
2. Ingresá en **Pages**.
3. En **Build and deployment**, elegí **Deploy from a branch**.
4. Seleccioná `main`, carpeta `/(root)` y presioná **Save**.
5. Abrí `https://ersepobservatorio-cyt.github.io/portal-observatorio-ersep/`.
6. Actualizá con `Ctrl + F5` para evitar que el navegador muestre una versión anterior.

## C. Actualizar el servicio del Boletín en Render

### Cuando el servicio ya existe

1. Entrá en Render.
2. Abrí el servicio `portal-observatorio-ersep-boletin`.
3. Verificá que esté conectado al repositorio y a la rama `main`.
4. Ejecutá **Manual Deploy → Deploy latest commit** si el despliegue automático no comenzó.
5. Esperá hasta que el estado sea **Live**.
6. Abrí la URL del servicio seguida de `/api/health`. Debe responder con `"ok": true`.

### Cuando se crea desde cero

1. Presioná **New + → Blueprint**.
2. Conectá la cuenta de GitHub que administra el repositorio.
3. Elegí `portal-observatorio-ersep`.
4. Render leerá automáticamente `render.yaml`.
5. Confirmá la creación del servicio.
6. No hace falta configurar contraseña, `APP_PASSWORD` ni JWT.

## D. Revisar la URL del servicio

La configuración entregada utiliza:

`https://portal-observatorio-ersep-boletin.onrender.com`

Si Render asignó otra dirección:

1. Abrí `assets/js/boletin-config.js`.
2. Reemplazá únicamente el valor de `API_BASE_URL`.
3. Confirmá el cambio en `main`.
4. Esperá la actualización de GitHub Pages y recargá con `Ctrl + F5`.

## E. Pruebas luego de publicar

1. Abrí el portal: debe ingresar sin contraseña.
2. Entrá en **Cumpleaños ERSeP**: allí debe solicitarse `Pers0na1*`.
3. Probá el buscador por nombre, los filtros, el calendario y los gráficos.
4. Cerrá cumpleaños y verificá que el resto del portal siga abierto.
5. Entrá en **Buscador de Boletín Oficial**.
6. La pantalla debe decir **Estamos preparando el buscador** y desaparecer automáticamente cuando esté disponible.
7. Entrá en **Alertas**: la tabla debe comenzar vacía cuando la base no contiene alertas propias.
8. Presioná **Agregar alerta de Aguas Cordobesas** y verificá que pueda editarse, pausarse y eliminarse.
9. Intentá agregarla nuevamente: debe informarse que ya existe.
10. Ejecutá una prueba de monitoreo y comprobá exportaciones e historial.

## F. Errores comunes

- **No se abre el Boletín:** comprobá que `API_BASE_URL` coincida con la URL real del servicio.
- **Aparece “Failed to fetch” o un error CORS:** verificá que `FRONTEND_ORIGINS` sea `https://ersepobservatorio-cyt.github.io`, sin la ruta del repositorio.
- **El historial desapareció:** el servicio no tiene almacenamiento persistente; configurá un disco y `DATA_ROOT`.
- **GitHub Pages muestra el diseño anterior:** esperá el despliegue y recargá con `Ctrl + F5`.
- **Cumpleaños no abre con la clave correcta:** verificá que `assets/data/cumpleanos.enc.json`, `assets/js/auth-config.js` y `assets/js/auth.js` correspondan a la misma versión.
