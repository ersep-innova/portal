# CAMBIOS REALIZADOS — VERSIÓN 3.0

## Privacidad y acceso

- Se eliminó la contraseña general del portal.
- La contraseña quedó limitada al módulo de cumpleaños.
- La clave ya no se guarda en `sessionStorage` ni en `localStorage`.
- Se eliminó `assets/data/cumpleanos.js`, que exponía la nómina en texto legible.
- Se regeneró la nómina cifrada en `assets/data/cumpleanos.enc.json`.
- El Boletín Oficial dejó de depender de la contraseña general, JWT y `APP_PASSWORD`.

## Identidad institucional

- El nombre visible pasó a ser **Portal de Innovación y Análisis de Datos**.
- En el organigrama, el equipo figura como **Innovación y Análisis de Datos**.
- Se actualizó **Subdirección de J. de Costos y Tarifas**.
- Se actualizó **Subdirección de J. de Faltas Regulatorias**.
- Se dejó **Administración y Finanzas** sin el prefijo “Área”.
- Se quitaron las restantes apariciones visibles del prefijo “Área”.
- No se modificaron URLs, nombres del repositorio ni identificadores técnicos existentes.

## Personal

- Miguel Ángel Rojas fue trasladado a Gerencia de Energía · Sede Centro.
- Leandro Gabriel Ramallo fue trasladado a Gerencia de Transporte · Innovación y Análisis de Datos.
- Jorge Iván Guevara fue eliminado de la nómina.
- Se incorporó Leandro Emmanuel Gregorat Almirón, cumpleaños 27 de septiembre, en Sistemas y Telecomunicaciones.
- Se incorporó Camila Ángela Lotumolo Sueldo, cumpleaños 21 de mayo, en la Subdirección de J. de Costos y Tarifas.
- Se incorporó Julieta Roxana Gallegos, cumpleaños 21 de agosto, en la Subdirección de J. de Costos y Tarifas.
- Se actualizó el organigrama de Innovación y Análisis de Datos.

## Cumpleaños

- Se agregó búsqueda por nombre y apellido, sin distinguir mayúsculas ni tildes.
- Se conservaron y combinaron filtros por dependencia y ubicación.
- Se agregó un calendario navegable con días destacados y detalle por cursor, foco o toque.
- Se rediseñó la distribución mensual con barras seleccionables y detalle de personas.
- Se agregaron indicadores, próximos cumpleaños y una lista ordenada por cercanía.
- Todos los componentes responden conjuntamente a la búsqueda y los filtros.

## Portal y estética

- El botón de cumpleaños quedó en la fila superior del menú.
- Se eliminaron textos técnicos visibles sobre arquitectura, alojamiento y servidores.
- Se aplicó una estética institucional inspirada en el sitio del ERSeP: Open Sans, rojo institucional, blanco, grises, jerarquías más sobrias y estados de foco.
- Se mantuvo la visualización clara y oscura.

## Boletín Oficial

- Se reemplazó la pantalla técnica por una barra de carga indeterminada y mensajes comprensibles.
- Se eliminaron las tres alertas iniciales automáticas.
- Se agregó una migración de una sola ejecución para retirar esas alertas heredadas de una base ya existente.
- Se agregó el botón **Agregar alerta de Aguas Cordobesas**.
- La alerta incluye variantes de razón social, siglas y denominaciones frecuentes.
- Se evita la duplicación de alertas ignorando mayúsculas y tildes.
- La alerta predefinida se administra como cualquier alerta manual.

## Limitaciones vigentes

- El cifrado de cumpleaños mejora la privacidad, pero GitHub Pages no brinda autenticación real de servidor.
- El backend del Boletín es público y CORS restringe su uso desde navegadores a los orígenes configurados; CORS no reemplaza una autenticación de API.
- Sin almacenamiento persistente, el historial SQLite puede perderse ante un nuevo despliegue o reinicio de la instancia.

## Pruebas finales

- Se completaron 124 verificaciones automáticas de regresión.
- Se probaron las interfaces en escritorio y celular, sin desbordamiento horizontal general.
- Se validaron búsqueda, filtros, calendario, alertas, migración, API, CORS, rutas y sintaxis.
- El detalle completo se encuentra en `PRUEBAS_REALIZADAS.md`.
