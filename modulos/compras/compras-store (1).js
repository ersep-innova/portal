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

  /* Etapas del trámite. Nada se borra: cada cambio queda asentado en el historial. */
  var ESTADOS = {
    pendiente: { nombre: 'Pendiente de analizar', etapa: 'analizar', color: '#b7791f' },
    aprobado:  { nombre: 'Aprobado · pendiente de entregar', etapa: 'entregar', color: '#0f4c8a' },
    entregado: { nombre: 'Entregado / realizado', etapa: 'finalizado', color: '#0c6858' },
    rechazado: { nombre: 'Rechazado', etapa: 'finalizado', color: '#b51234' }
  };

  var ETAPAS = {
    analizar:   'Pendiente de analizar',
    entregar:   'Pendiente de entregar',
    finalizado: 'Finalizados'
  };

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

  function normalizar(p) {
    if (!p.estado || !ESTADOS[p.estado]) p.estado = 'pendiente';
    if (!Array.isArray(p.historial) || !p.historial.length) {
      p.historial = [{ estado: p.estado, fecha: p.registrado || new Date().toISOString(), nota: 'Pedido registrado' }];
    }
    p.etapa = ESTADOS[p.estado].etapa;
    return p;
  }

  function pedidos() {
    var lista = hayStorage ? leerJSON(KEY_PEDIDOS, []) : memoria.pedidos;
    return Array.isArray(lista) ? lista.map(normalizar) : [];
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
      registrado: new Date().toISOString(),
      estado: 'pendiente',
      etapa: 'analizar',
      historial: [{ estado: 'pendiente', fecha: new Date().toISOString(), nota: 'Pedido registrado' }]
    };

    var lista = pedidos();
    lista.push(pedido);
    var ok = guardarPedidos(lista);

    var c = contadores();
    c[prox.anio] = prox.numero;
    guardarContadores(c);

    return { ok: ok, pedido: pedido, persistido: hayStorage && ok };
  }

  /* Los pedidos no se borran: cambian de estado y queda el historial completo. */
  function cambiarEstado(id, estado, nota) {
    if (!ESTADOS[estado]) return { ok: false, mensaje: 'Estado desconocido.' };

    var lista = pedidos();
    var pedido = null;
    lista.forEach(function (p) { if (p.id === id) pedido = p; });
    if (!pedido) return { ok: false, mensaje: 'No se encontró el pedido.' };

    pedido.estado = estado;
    pedido.etapa = ESTADOS[estado].etapa;
    pedido.historial.push({
      estado: estado,
      fecha: new Date().toISOString(),
      nota: (nota || '').trim()
    });

    var ok = guardarPedidos(lista);
    return { ok: ok, pedido: pedido };
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
    cambiarEstado: cambiarEstado,
    ESTADOS: ESTADOS,
    ETAPAS: ETAPAS,
    vaciar: vaciar,
    exportar: exportar,
    importar: importar
  };
})();
