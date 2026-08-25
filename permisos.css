(() => {
  "use strict";

  const cfg = window.ERSEP_PERMISOS_CONFIG;
  const TOKEN_KEY = "ersep_permisos_session_token";

  function apiUrl(path) {
    return `${cfg.API_BASE_URL.replace(/\/$/, "")}${path}`;
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getToken();

    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    let response;
    try {
      response = await fetch(apiUrl(path), { ...options, headers });
    } catch (error) {
      const networkError = new Error("No se pudo conectar con el servicio de Permisos. Reintentá en unos segundos.");
      networkError.cause = error;
      throw networkError;
    }

    let payload = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await response.json();
    } else if (response.status !== 204) {
      payload = await response.text();
    }

    if (!response.ok) {
      const detail = payload?.detail || payload?.message || payload || `Error ${response.status}`;
      const error = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  async function checkHealth() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(apiUrl(cfg.HEALTH_PATH), {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return null;
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function wakeBackend(onState) {
    const started = Date.now();
    let lastError = null;
    onState?.("connecting");

    while (Date.now() - started < cfg.HEALTH_TIMEOUT_MS) {
      try {
        const data = await checkHealth();
        if (data?.status === "ok") {
          onState?.("online", data);
          return true;
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, cfg.RETRY_DELAY_MS));
    }

    onState?.("offline", lastError);
    return false;
  }

  window.PermisosAPI = {
    getToken,
    setToken(token) {
      sessionStorage.setItem(TOKEN_KEY, token);
    },
    clearToken() {
      sessionStorage.removeItem(TOKEN_KEY);
      // Limpia también la clave histórica para evitar confusiones después de la migración.
      sessionStorage.removeItem("ersep_permisos_google_id_token");
    },
    request,
    checkHealth,
    wakeBackend,
  };
})();
