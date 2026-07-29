# PRUEBAS REALIZADAS — VERSIÓN 3.0

Fecha de validación: 29/07/2026.

## Resultado general

La versión fue validada antes de empaquetarse. Se completaron **124 verificaciones automáticas de regresión**, además de pruebas visuales y funcionales en resoluciones de escritorio y celular.

## Privacidad y nómina

- Descifrado correcto de `cumpleanos.enc.json` mediante PBKDF2-SHA256 y AES-GCM.
- Verificación de la contraseña institucional y correspondencia entre el verificador y la nómina cifrada.
- Confirmación de 216 registros y ausencia de nombres duplicados exactos.
- Confirmación de altas, bajas y traslados solicitados.
- Confirmación de que `cumpleanos.js` ya no existe y que no queda una copia legible de la nómina.
- Confirmación de que la autenticación se carga únicamente en cumpleaños.
- Confirmación de que la contraseña no se guarda en `localStorage` ni en `sessionStorage` por el código de acceso.

## Portal y rutas

- Revisión de todos los HTML y de sus referencias locales a CSS, JavaScript, imágenes y páginas.
- Confirmación de que no quedan textos visibles con las denominaciones institucionales anteriores.
- Confirmación de que cumpleaños ocupa la tercera tarjeta del menú, dentro de la fila superior en escritorio.
- Confirmación de ausencia de desbordamiento horizontal general en 1440 px y 390 px.

## Cumpleaños

- Carga de los 216 registros descifrados.
- Búsqueda en vivo sin distinguir mayúsculas ni tildes.
- Búsqueda específica de Leandro Emmanuel Gregorat Almirón.
- Combinación de filtros por dependencia y sede.
- Estado sin resultados.
- Doce barras mensuales y detalle de personas por mes.
- Navegación del calendario y visualización por cursor, foco y toque.
- Comprobación del 27 de septiembre y su detalle de cumpleaños.
- Pruebas visuales en escritorio y celular.

## Boletín Oficial

- Base nueva sin alertas precargadas.
- Migración idempotente que elimina solamente las tres alertas heredadas.
- Creación, edición, pausa y eliminación de alertas.
- Prevención de duplicados sin distinguir mayúsculas ni tildes.
- Creación del botón predefinido de Aguas Cordobesas con sus variantes.
- Estado vacío y operaciones completas comprobadas desde la interfaz.
- Pantalla de preparación y desaparición automática comprobadas.
- API pública, endpoint de salud y operaciones de alertas comprobados.
- CORS autorizado para el origen institucional y no habilitado para un origen ajeno.
- Pruebas visuales en escritorio y celular.

## Validaciones técnicas

- Sintaxis JavaScript verificada con `node --check`.
- Backend compilado con `python -m compileall`.
- Endpoints FastAPI probados mediante `TestClient`.
- Integridad de la base SQLite y de su migración comprobada en bases temporales.

## Límites que requieren consideración al publicar

- El cifrado en GitHub Pages evita publicar la nómina en texto legible, pero no reemplaza una autenticación de servidor.
- CORS limita qué páginas pueden llamar a la API desde un navegador, pero no es una autenticación fuerte de API.
- Las alertas y el historial requieren almacenamiento persistente para sobrevivir a todos los despliegues o reinicios del servicio.
