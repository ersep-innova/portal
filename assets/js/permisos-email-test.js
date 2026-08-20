// ERSeP · Permisos de Salida
// V5.1b · Botón de prueba de correo
// Archivo independiente: NO reemplaza permisos.js

(function () {
  "use strict";

  const API_BASE =
    "https://portal-observatorio-ersep-permisos.onrender.com";

  function getToken() {
    const keys = [
      "token",
      "access_token",
      "id_token",
      "google_token",
      "credential"
    ];

    for (const key of keys) {
      const localValue = localStorage.getItem(key);

      if (localValue) {
        return localValue;
      }

      const sessionValue = sessionStorage.getItem(key);

      if (sessionValue) {
        return sessionValue;
      }
    }

    return null;
  }

  async function portalFetch(path, options = {}) {
    /*
      Primero intentamos utilizar una función de API
      que ya exista en el Portal.

      Esto permite reutilizar la autenticación existente
      en lugar de inventar una sesión paralela.
    */

    if (typeof window.apiFetch === "function") {
      return window.apiFetch(path, options);
    }

    if (
      window.PermisosAPI &&
      typeof window.PermisosAPI.fetch === "function"
    ) {
      return window.PermisosAPI.fetch(path, options);
    }

    /*
      Si el Portal no expone un helper global,
      intentamos encontrar el token almacenado.
    */

    const headers = new Headers(options.headers || {});

    headers.set("Accept", "application/json");

    const token = getToken();

    if (
      token &&
      !headers.has("Authorization")
    ) {
      headers.set(
        "Authorization",
        `Bearer ${token}`
      );
    }

    return fetch(
      `${API_BASE}${path}`,
      {
        ...options,
        headers,
        credentials: "include"
      }
    );
  }

  async function testEmail() {
    const btn =
      document.getElementById("test_email_btn");

    const status =
      document.getElementById("test_email_status");

    if (!btn) {
      console.error(
        "No existe #test_email_btn en el HTML."
      );

      return;
    }

    const originalText =
      btn.textContent;

    btn.disabled = true;

    btn.textContent =
      "Enviando…";

    if (status) {
      status.textContent = "";
    }

    try {
      const response =
        await portalFetch(
          "/api/admin/email/test",
          {
            method: "POST"
          }
        );

      let data = {};

      try {
        data =
          await response.json();
      } catch (_) {
        data = {};
      }

      if (!response.ok) {
        const detail =
          data.detail ||
          data.message ||
          `Error HTTP ${response.status}`;

        throw new Error(detail);
      }

      if (status) {
        status.textContent =
          "✅ Enviado";
      }

      alert(
        "Correo de prueba enviado correctamente.\n\n" +
        "Revisá tu bandeja de entrada y también Spam."
      );

    } catch (error) {

      console.error(
        "Error al probar correo:",
        error
      );

      if (status) {
        status.textContent =
          "❌ Error";
      }

      alert(
        "No se pudo enviar el correo de prueba.\n\n" +
        (
          error &&
          error.message
            ? error.message
            : "Error desconocido"
        )
      );

    } finally {

      btn.disabled = false;

      btn.textContent =
        originalText;
    }
  }

  function init() {
    const btn =
      document.getElementById("test_email_btn");

    if (!btn) {
      console.warn(
        "Permisos Email Test: " +
        "no se encontró el botón #test_email_btn."
      );

      return;
    }

    /*
      Evita registrar el mismo evento dos veces
      si por alguna razón el JS se vuelve a cargar.
    */

    if (
      btn.dataset.emailTestReady === "1"
    ) {
      return;
    }

    btn.dataset.emailTestReady = "1";

    btn.addEventListener(
      "click",
      testEmail
    );
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }
})();
