/* =============================================================
   ERSeP · Compras y Contrataciones
   Registro local de pedidos de provisión.

   IMPORTANTE: los pedidos se guardan en el navegador de cada
   equipo (localStorage). No se comparten entre computadoras ni
   entre navegadores. Para consolidar, usar Exportar / Importar
   desde la página de registro.
   ============================================================= */
window.ComprasStore = (function () {
  "use strict";

  var KEY_PEDIDOS = "ersep.compras.pedidos";
  var KEY_CONTADOR = "ersep.compras.contadores";
  var memoria = { pedidos: [], contadores: {} };
  var hayStorage = (function () {
    try {
      var t = "__ersep_test__";
      window.localStorage.setItem(t, "1");
      window.localStorage.removeItem(t);
      return true;
    } catch (e) { return false; }
  })();

  function leerJSON(clave, porDefecto) {
    if (!hayStorage) return porDefecto;
    try {
      var crudo = window.localStorage.getItem(clave);
      return crudo ? JSON.parse(crudo) : porDefecto;
    } catch (e) { return porDefecto; }
  }

  function escribirJSON(clave, valor) {
    if (!hayStorage) return false;
    try {
      window.localStorage.setItem(clave, JSON.stringify(valor));
      return true;
    } catch (e) { return false; }
  }

  function pedidos() {
    var lista = hayStorage ? leerJSON(KEY_PEDIDOS, []) : memoria.pedidos;
    return Array.isArray(lista) ? lista : [];
  }

  function guardarPedidos(lista) {
    memoria.pedidos = lista;
    return escribirJSON(KEY_PEDIDOS, lista);
  }

  function contadores() {
    var c = hayStorage ? leerJSON(KEY_CONTADOR, {}) : memoria.contadores;
    return (c && typeof c === "object") ? c : {};
  }

  function guardarContadores(c) {
    memoria.contadores = c;
    return escribirJSON(KEY_CONTADOR, c);
  }

  function pad(n) {
    return String(n).padStart(4, "0");
  }

  /* Próximo número disponible del ejercicio, sin consumirlo. */
  function proximoNumero(anio) {
    anio = anio || new Date().getFullYear();
    var c = contadores();
    var siguiente = (Number(c[anio]) || 0) + 1;
    return { anio: anio, numero: siguiente, texto: pad(siguiente) + "/" + anio };
  }

  /* Registra el pedido y consume el número. Devuelve el pedido guardado. */
  function registrar(datos) {
    var anio = Number(String(datos.fecha || "").slice(0, 4)) || new Date().getFullYear();
    var prox = proximoNumero(anio);

    var pedido = {
      id: "P" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      numero: prox.numero,
      anio: prox.anio,
      numeroTexto: prox.texto,
      fecha: datos.fecha || "",
      area: datos.area || "",
      tipo: datos.tipo || "Libre",
      numerado: datos.numerado || "",
      items: datos.items || [],
      observaciones: datos.observaciones || "",
      afectacion: datos.afectacion || "",
      partida: datos.partida || "",
      codigo: datos.codigo || "",
      total: Number(datos.total) || 0,
      registrado: new Date().toISOString()
    };

    var lista = pedidos();
    lista.push(pedido);
    var ok = guardarPedidos(lista);

    var c = contadores();
    c[prox.anio] = prox.numero;
    guardarContadores(c);

    return { ok: ok, pedido: pedido, persistido: hayStorage && ok };
  }

  function eliminar(id) {
    var lista = pedidos().filter(function (p) { return p.id !== id; });
    return guardarPedidos(lista);
  }

  function vaciar() {
    guardarPedidos([]);
    return guardarContadores({});
  }

  /* Copia de seguridad completa (pedidos + contadores). */
  function exportar() {
    return {
      formato: "ersep-compras-v1",
      generado: new Date().toISOString(),
      contadores: contadores(),
      pedidos: pedidos()
    };
  }

  /* Importa una copia sin pisar lo existente: sólo agrega los que faltan. */
  function importar(datos) {
    if (!datos || !Array.isArray(datos.pedidos)) {
      return { ok: false, agregados: 0, mensaje: "El archivo no tiene el formato esperado." };
    }

    var lista = pedidos();
    var existentes = {};
    lista.forEach(function (p) { existentes[p.id] = true; });

    var agregados = 0;
    datos.pedidos.forEach(function (p) {
      if (p && p.id && !existentes[p.id]) {
        lista.push(p);
        existentes[p.id] = true;
        agregados++;
      }
    });

    lista.sort(function (a, b) {
      return String(a.registrado || "").localeCompare(String(b.registrado || ""));
    });
    guardarPedidos(lista);

    // El contador de cada ejercicio queda en el número más alto conocido.
    var c = contadores();
    lista.forEach(function (p) {
      var anio = p.anio || new Date().getFullYear();
      if (!c[anio] || Number(p.numero) > Number(c[anio])) c[anio] = Number(p.numero) || 0;
    });
    guardarContadores(c);

    return { ok: true, agregados: agregados, mensaje: "Se agregaron " + agregados + " pedido(s)." };
  }

  return {
    disponible: hayStorage,
    pedidos: pedidos,
    proximoNumero: proximoNumero,
    registrar: registrar,
    eliminar: eliminar,
    vaciar: vaciar,
    exportar: exportar,
    importar: importar
  };
})();
