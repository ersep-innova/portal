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


## Identidad institucional ERSeP · v3.1

- Se verificaron todos los enlaces locales `href` y `src` de los HTML: **0 referencias faltantes**.
- Se verificó sintaxis JavaScript con `node --check` para `menu.js`, `theme.js`, `auth.js`, `birthday.js` y `boletin.js`.
- Se realizó prueba HTTP local con respuesta **200** para la portada, la nueva hoja de estilo, el logotipo y los seis módulos internos.
- Se preservaron los enlaces externos, la lógica de autenticación, el cifrado de cumpleaños y la configuración del backend.

## Actualización v3.2 · Herramientas anunciadas

- Se verificó que la portada contenga **10 tarjetas** y los nuevos módulos anunciados.
- Se verificó la presencia de **Asistencia de reclamos ERSeP**, **Control de Cargos Tarifarios** y **Vial y Edilicia**.
- Se verificó que los tres nuevos módulos tengan estado **Próximamente** y no naveguen a páginas inexistentes.
- Se verificó que **Estadísticas** utilice el logotipo institucional del ERSeP y la categoría **Datos Estadísticos**.
- Se comprobaron 102 referencias locales `href` y `src`: **0 referencias faltantes**.
- Se verificó sintaxis JavaScript con `node --check` para todos los archivos de `assets/js`.
- Se realizó prueba HTTP local con respuesta **200** para la portada, la hoja de estilo institucional y los logotipos utilizados.
