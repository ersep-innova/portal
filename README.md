# Portal Observatorio ERSeP

Sitio estático para GitHub Pages, con menú principal y módulo de cumpleaños de RR.HH.

## Publicación
1. Subir todo el contenido a la raíz del repositorio `portal-observatorio-ersep`.
2. Settings → Pages → Deploy from a branch → `main` → `/(root)`.
3. Abrir la URL publicada.

## Acceso
La contraseña inicial configurada es la acordada internamente. La nómina se guarda cifrada con AES-GCM y una clave derivada mediante PBKDF2. La contraseña no está escrita en texto plano dentro del código.

## Advertencia de seguridad
GitHub Pages sigue siendo un alojamiento público. El cifrado del lado del navegador protege el archivo de datos frente a lectura directa, pero no reemplaza un sistema de autenticación de servidor, control de usuarios, auditoría ni revocación individual. Para información laboral especialmente sensible se recomienda Cloudflare Access, Microsoft Entra ID, GitHub Pages privado en Enterprise o un hosting con autenticación real.

## Estadísticas
Se incluyen distribución por mes, principales áreas, próximos 30 días y sedes. No se calculan edades porque la base no contiene año de nacimiento.
