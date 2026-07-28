# CAMBIOS REALIZADOS

- Se incorporó al portal la interfaz completa del buscador del Boletín Oficial.
- Se adaptaron todas las rutas para GitHub Pages bajo `/portal-observatorio-ersep/`.
- Se creó `backend/`, un FastAPI independiente que contiene únicamente el módulo del Boletín Oficial.
- Se agregó autenticación JWT del backend usando la contraseña ya validada por el portal.
- Se configuró CORS exclusivamente para `https://ersepobservatorio-cyt.github.io`.
- Se agregó una pantalla de espera que despierta Render y bloquea el buscador hasta que esté disponible.
- Se agregó `render.yaml` para desplegar el backend como Blueprint con raíz `backend/`.
- Se eliminó del nuevo backend toda dependencia de Google Sheets y de la API estadística general.
- Se actualizó la tarjeta del Boletín Oficial a estado Disponible.
- Se incluyeron advertencias sobre la pérdida del historial SQLite en Render gratuito.
