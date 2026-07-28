# Portal Observatorio ERSeP

Repositorio único para:

- **GitHub Pages:** portal estático en la raíz.
- **Render:** backend FastAPI del Boletín Oficial dentro de `backend/`.

## URLs previstas

- Portal: `https://ersepobservatorio-cyt.github.io/portal-observatorio-ersep/`
- Backend: `https://portal-observatorio-ersep-boletin.onrender.com`
- Salud del backend: `https://portal-observatorio-ersep-boletin.onrender.com/api/health`

## Publicación rápida

1. Subir el contenido de este proyecto a la rama `main` del repositorio `portal-observatorio-ersep`.
2. En GitHub: **Settings → Pages → Deploy from a branch → main → /(root) → Save**.
3. En Render, iniciar sesión con la cuenta deseada y crear un **Blueprint** apuntando a este repositorio. Render leerá `render.yaml`.
4. Durante la creación, cargar `APP_PASSWORD` con la misma contraseña institucional del portal.
5. Verificar la URL asignada por Render. Si no es exactamente `portal-observatorio-ersep-boletin.onrender.com`, editar `assets/js/boletin-config.js` y reemplazar `API_BASE_URL`.

## Seguridad

No subas `.env`, contraseñas ni secretos al repositorio. `APP_PASSWORD` y `JWT_SECRET` se administran en Render.

## Persistencia en el plan gratuito

La base SQLite vive en el disco local de la instancia. Render gratuito puede reiniciar o volver a desplegar el servicio, por lo que el historial puede borrarse. Exportá los resultados importantes. Si más adelante se contrata un disco persistente, montarlo y definir `DATA_ROOT=/var/data`.
