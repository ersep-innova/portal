# Permisos de Salida V3.1 — ajuste visual de inicio

Se corrige el estado inicial del login.

## Problema
Cuando el sidebar estaba oculto antes de iniciar sesión, `.perm-shell` seguía teniendo dos columnas (`260px + 1fr`). Como el sidebar no participaba visualmente del grid, el `<main>` quedaba ubicado en la columna fija de 260px. Por eso el encabezado y la tarjeta de acceso aparecían comprimidos contra la izquierda hasta iniciar sesión.

## Corrección
En `assets/css/permisos.css` se agregó una regla para que, mientras el sidebar tenga el atributo `hidden`, `.perm-main` abarque las dos columnas del grid.

No se modificó la lógica de autenticación, permisos, pestañas, RR.HH., Jefatura ni Administración.
