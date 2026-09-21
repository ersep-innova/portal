/* =============================================================================
   Estadísticas · configuración del servicio de datos
   -----------------------------------------------------------------------------
   Dirección del backend de índices (FastAPI en Render). La consulta es pública
   y de solo lectura: el servicio debe tener PUBLIC_READ_ONLY=true y aceptar el
   origen https://ersep-innova.github.io en CORS_ORIGINS.
   ============================================================================= */
window.ERSEP_CONFIG = Object.freeze({
  API_BASE_URL: "https://api-estadisticas.onrender.com"
});

window.apiUrl = function apiUrl(path) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  const base = String(window.ERSEP_CONFIG.API_BASE_URL || "").replace(/\/+$/, "");
  const normalized = value.startsWith("/") ? value : `/${value}`;
  return `${base}${normalized}`;
};
