window.ERSEP_PERMISOS_CONFIG = Object.freeze({
  // URL pública del servicio FastAPI de Permisos en Render.
  API_BASE_URL: "https://portal-observatorio-ersep-permisos.onrender.com",

  // Client ID público de Google Identity Services (NO es un secreto).
  // Client ID OAuth Web ya configurado para el Portal.
  GOOGLE_CLIENT_ID: "253893593941-ben23304bbehfadu5j8cfarf0996s50q.apps.googleusercontent.com",

  HEALTH_PATH: "/api/health",
  HEALTH_TIMEOUT_MS: 75000,
  RETRY_DELAY_MS: 5000,
});
