(() => {
  "use strict";

  async function testEmail() {
    const btn = document.getElementById("test_email_btn");
    const status = document.getElementById("test_email_status");

    if (!btn) {
      console.error("No se encontró el botón #test_email_btn");
      return;
    }

    const originalText = btn.textContent;

    btn.disabled = true;
    btn.textContent = "Enviando…";

    if (status) {
      status.textContent = "";
    }

    try {
      if (!window.PermisosAPI?.request) {
        throw new Error(
          "No está disponible PermisosAPI. Verificá que permisos-api.js cargue antes que permisos-email-test.js."
        );
      }

      const result = await window.PermisosAPI.request(
        "/api/admin/email/test",
        {
          method: "POST"
        }
      );

      console.log("Resultado prueba email:", result);

      if (status) {
        status.textContent = "✅ Enviado";
      }

      alert(
        "Correo de prueba enviado correctamente.\n\n" +
        "Revisá tu bandeja de entrada y también Spam/Correo no deseado."
      );

    } catch (error) {
      console.error("Error al probar correo:", error);

      if (status) {
        status.textContent = "❌ Error";
      }

      alert(
        "No se pudo enviar el correo de prueba.\n\n" +
        (error?.message || "Error desconocido")
      );

    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function init() {
    const btn = document.getElementById("test_email_btn");

    if (!btn) {
      console.warn(
        "No se encontró #test_email_btn. " +
        "El botón debe existir en index.html."
      );
      return;
    }

    if (btn.dataset.emailTestReady === "1") {
      return;
    }

    btn.dataset.emailTestReady = "1";
    btn.addEventListener("click", testEmail);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
