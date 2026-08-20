# Permisos de Salida V2 — Cambios funcionales

Esta versión agrega:

1. **Usuarios activos/inactivos**: Administración puede quitar acceso y reactivar usuarios sin borrar historial.
2. **Jornada habitual por agente**: por defecto `08:00–14:00`, editable en Administración.
3. **Jornada congelada en cada permiso**: el permiso conserva el horario aplicable al momento de solicitarlo.
4. **Cálculo automático mejorado**:
   - Con regreso: `hora_regreso - hora_salida`.
   - Sin regreso: `fin_jornada - hora_salida`.
5. **Tiempo declarado editable por el agente**: puede diferir del cálculo automático; si difiere, exige justificación.
6. **Reposición completa**: fecha + tramo `desde/hasta`.
7. **Plazo de 7 días hábiles como advertencia**: ya no bloquea el envío; si se supera, exige observación para RR.HH.
8. **RR.HH. puede aprobar o rechazar**: el rechazo exige motivo; la aprobación mantiene observación opcional.
9. **Estados diferenciados**: `RECHAZADO_JEFE` y `RECHAZADO_RRHH`.
10. **Google Sheets preparado** para exportar jornada, cálculo/declaración, excepción de plazo y tramo de reposición.
11. **Protección bootstrap admin**: las cuentas incluidas en `BOOTSTRAP_ADMIN_EMAILS` recuperan `AGENTE + ADMIN` automáticamente.

## Importante al desplegar

El archivo `backend-permisos/schema.sql` contiene migraciones idempotentes (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) para actualizar la PostgreSQL ya existente sin borrar registros.

Al subir estos archivos a GitHub, Render debería redeplegar automáticamente el backend. Durante el startup, `init_schema()` ejecutará la migración.

## Archivos modificados

- `backend-permisos/schema.sql`
- `backend-permisos/main.py`
- `backend-permisos/app/workflow.py`
- `backend-permisos/app/auth.py`
- `backend-permisos/app/sheets_service.py`
- `modulos/permisos-salida/index.html`
- `assets/js/permisos.js`
- `assets/js/permisos-config.js`
- `assets/css/permisos.css`
