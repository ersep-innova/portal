window.ERSEP_PERMISOS_CONFIG = Object.freeze({
  // URL pública del servicio FastAPI de Permisos en Render.
  API_BASE_URL: "https://portal-observatorio-ersep-permisos.onrender.com",

  // Client ID público de Google Identity Services (NO es un secreto).
  // Reemplazar al crear las credenciales OAuth Web en Google Cloud.
  GOOGLE_CLIENT_ID: "REEMPLAZAR_CON_CLIENT_ID.apps.googleusercontent.com",

  HEALTH_PATH: "/api/health",
  HEALTH_TIMEOUT_MS: 75000,
  RETRY_DELAY_MS: 5000,

  // El Sheet es privado. Este enlace solo se muestra a RR.HH./ADMIN si se configura.
  RRHH_SHEET_URL: ""
});
