(() => {
  "use strict";

  const cfg = window.ERSEP_PERMISOS_CONFIG;

  function apiUrl(path) {
    return `${cfg.API_BASE_URL.replace(/\/$/, "")}${path}`;
  }

  function getToken() {
    return sessionStorage.getItem("ersep_permisos_google_id_token") || "";
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getToken();

    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(apiUrl(path), {
      ...options,
      headers
    });

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

  async function wakeBackend(onState) {
    const started = Date.now();
    let lastError = null;
    onState?.("connecting");

    while (Date.now() - started < cfg.HEALTH_TIMEOUT_MS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(apiUrl(cfg.HEALTH_PATH), {
          signal: controller.signal,
          cache: "no-store"
        });
        clearTimeout(timer);
        if (response.ok) {
          onState?.("online");
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
      sessionStorage.setItem("ersep_permisos_google_id_token", token);
    },
    clearToken() {
      sessionStorage.removeItem("ersep_permisos_google_id_token");
    },
    request,
    wakeBackend
  };
})();
