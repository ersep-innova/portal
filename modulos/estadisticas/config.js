/* =============================================================================
   Estadísticas · conexión con el servicio de datos
   -----------------------------------------------------------------------------
   El panel consulta un backend FastAPI publicado en Render. En los archivos del
   otro portal figuran DOS direcciones posibles, así que se prueban en orden y se
   usa la primera que responda.

   Para que funcione desde este portal, el servicio de Render necesita:
     · PUBLIC_READ_ONLY = true
     · CORS_ORIGINS con https://ersep-innova.github.io  (separado por comas
       si ya había otros orígenes)

   Render en plan gratuito se "duerme" tras un rato sin uso: la primera consulta
   puede tardar hasta un minuto. Por eso se reintenta antes de dar error.
   ============================================================================= */
(function () {
  "use strict";

  var CANDIDATOS = [
    "https://api-estadisticas.onrender.com",
    "https://api-integral-costos.onrender.com"
  ];

  var INTENTOS = 3;          // por dirección
  var ESPERA_MS = 5000;      // entre intentos (el servicio puede estar despertando)
  var TIEMPO_MAX_MS = 70000; // tiempo máximo por intento

  var base = CANDIDATOS[0];

  window.ERSEP_CONFIG = {
    get API_BASE_URL() { return base; }
  };

  window.apiUrl = function apiUrl(path) {
    var value = String(path || "");
    if (/^https?:\/\//i.test(value)) return value;
    var normalized = value.charAt(0) === "/" ? value : "/" + value;
    return base.replace(/\/+$/, "") + normalized;
  };

  function dormir(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function probar(url) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, TIEMPO_MAX_MS) : null;
    return fetch(url + "/api/meta", { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (t) clearTimeout(t);
        if (r.status === 401 || r.status === 403) {
          var e = new Error("no-publico"); e.tipo = "no-publico"; throw e;
        }
        if (!r.ok) { var e2 = new Error("HTTP " + r.status); e2.tipo = "http"; throw e2; }
        return r.json();
      });
  }

  function avisar(texto) {
    var s = document.getElementById("status");
    if (s) s.textContent = texto;
  }

  /* Resuelve con la primera dirección que responde; si ninguna, explica por qué */
  window.ERSEP_API_READY = (async function () {
    var ultimo = null;

    for (var i = 0; i < CANDIDATOS.length; i++) {
      for (var n = 1; n <= INTENTOS; n++) {
        try {
          if (n > 1) avisar("Despertando el servicio de datos… (intento " + n + " de " + INTENTOS + ")");
          await probar(CANDIDATOS[i]);
          base = CANDIDATOS[i];
          return base;
        } catch (e) {
          ultimo = e;
          if (e.tipo === "no-publico") break;   // responde, pero exige login: no sirve reintentar
          if (n < INTENTOS) await dormir(ESPERA_MS);
        }
      }
    }

    var motivo;
    if (ultimo && ultimo.tipo === "no-publico") {
      motivo = "El servicio responde pero exige iniciar sesión. En Render hay que activar PUBLIC_READ_ONLY=true.";
    } else {
      motivo = "El navegador no pudo leer el servicio de datos. Casi siempre es la configuración CORS: " +
        "en Render hay que agregar https://ersep-innova.github.io a CORS_ORIGINS.";
    }
    var err = new Error(motivo);
    err.diagnostico = true;
    throw err;
  })();

  // Evita el aviso de promesa rechazada sin manejar: el panel muestra el error
  window.ERSEP_API_READY.catch(function () {});
})();
