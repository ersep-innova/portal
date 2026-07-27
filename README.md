# Portal RR.HH. ERSeP — GitHub Pages

Sitio estático e independiente de `API_Estadisticas`.

## Qué contiene

- Menú principal preparado para incorporar nuevos módulos.
- Panel **Cumpleaños RR.HH. ERSeP**.
- 216 cumpleaños.
- 18 filtros por Gerencia/Área.
- Modo claro y oscuro.
- Sin contraseña.
- Sin FastAPI, Render, Python, base de datos ni instalación de dependencias.

## Publicación rápida en GitHub Pages

1. Crear un repositorio nuevo en GitHub.
2. Extraer este ZIP.
3. Subir **el contenido interno** de esta carpeta a la raíz del repositorio. `index.html` debe quedar en la raíz.
4. En el repositorio, abrir **Settings → Pages**.
5. En **Build and deployment**, seleccionar **Deploy from a branch**.
6. Elegir la rama `main`, carpeta `/(root)` y guardar.
7. Esperar a que GitHub informe la dirección publicada.

No es necesario configurar Render ni ejecutar comandos.

## Actualizar cumpleaños

Editar:

`assets/data/cumpleanos.js`

Cada registro sigue esta estructura:

```js
{
  "name": "Nombre y apellido",
  "day": 15,
  "month": 8,
  "area": "Gerencia o Área",
  "location": "Sede Centro"
}
```

- `day`: día numérico.
- `month`: mes numérico entre 1 y 12.
- `area`: determina el botón de filtro.
- `location`: lugar mostrado en la tarjeta.

Después de editar, guardar el archivo y volver a subirlo o confirmarlo en GitHub.

## Agregar nuevos módulos

Crear una carpeta dentro de `modulos/`, por ejemplo:

`modulos/directorio/index.html`

Luego convertir una tarjeta del menú principal (`index.html`) en un enlace:

```html
<a class="tool-card" href="modulos/directorio/">
  ...
</a>
```

## Privacidad

GitHub Pages publica el contenido como un sitio web accesible por Internet. Al no existir contraseña, los nombres, fechas de cumpleaños, áreas y sedes incorporados en el archivo de datos pueden quedar expuestos públicamente. Antes de publicar, verificá que RR.HH. autorice esa modalidad y que los datos incluidos sean los estrictamente necesarios.
