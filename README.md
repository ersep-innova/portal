# Portal de Innovación y Análisis de Datos · ERSeP

Proyecto integrado por:

- **Portal web estático:** ubicado en la raíz y preparado para GitHub Pages.
- **Buscador del Boletín Oficial:** frontend dentro de `modulos/boletin-oficial/` y servicio FastAPI dentro de `backend/`.
- **Cumpleaños ERSeP:** módulo protegido de manera independiente, con nómina cifrada en `assets/data/cumpleanos.enc.json`.

## URLs actuales

- Portal: `https://ersepobservatorio-cyt.github.io/portal-observatorio-ersep/`
- Servicio del Boletín: `https://portal-observatorio-ersep-boletin.onrender.com`
- Estado del servicio: `https://portal-observatorio-ersep-boletin.onrender.com/api/health`

Los identificadores técnicos y las URLs anteriores se conservaron para no romper la publicación existente, aunque el nombre visible del portal cambió.

## Publicación rápida

1. Subir todo el contenido del proyecto a la rama `main` del repositorio `portal-observatorio-ersep`.
2. En GitHub, abrir **Settings → Pages**.
3. Seleccionar **Deploy from a branch → main → /(root)**.
4. Crear o actualizar en Render el Blueprint definido por `render.yaml`.
5. Verificar la URL asignada al servicio. Si fuera distinta, editar únicamente `API_BASE_URL` en `assets/js/boletin-config.js`.

## Acceso y privacidad

- El portal general y el Boletín Oficial no solicitan contraseña.
- Cumpleaños solicita la clave institucional únicamente dentro de ese módulo.
- La contraseña no se guarda en `localStorage` ni en `sessionStorage`.
- La nómina legible no forma parte del repositorio; se publica únicamente el archivo cifrado.

### Limitación importante

GitHub Pages es un alojamiento estático. Por ello, cualquier archivo publicado puede descargarse, incluido el archivo cifrado. La solución evita exponer la nómina en texto legible, pero una contraseña compartida validada en el navegador no equivale a un control de acceso de servidor. Para una protección fuerte, la nómina debería alojarse fuera del repositorio y entregarse desde un servicio autenticado con usuarios individuales.

## Configuración del Boletín

Las variables definidas en `render.yaml` son:

- `FRONTEND_ORIGINS`: origen autorizado para las solicitudes del navegador.
- `SCRAPER_HTTP_TIMEOUT`: tiempo máximo de espera para las consultas documentales.

El servicio no utiliza `APP_PASSWORD`, JWT ni secretos de acceso del portal.

## Persistencia

La base SQLite se guarda por defecto en el disco local del servicio. En un plan sin almacenamiento persistente, un nuevo despliegue o reinicio puede eliminar alertas e historial. Para conservarlos, configurar un disco persistente y definir `DATA_ROOT` apuntando al punto de montaje.

## Prueba local

Portal estático:

```bash
python -m http.server 8000
```

Luego abrir `http://localhost:8000/`.

Backend:

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

Para conectar el frontend local al backend local, cambiar temporalmente `API_BASE_URL` en `assets/js/boletin-config.js` a `http://localhost:8001` y añadir `http://localhost:8000` a `FRONTEND_ORIGINS`.
