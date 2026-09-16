/* =============================================================
   ERSeP · Compras y Contrataciones
   Base compartida: Supabase.
   Se mantiene localStorage como copia local de respaldo.
   ============================================================= */

window.ComprasStore = (function () {
  "use strict";

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
    } catch (e) {
      return false;
    }
  })();

  function config() {
    return window.CONFIG_SUPABASE_COMPRAS || {};
  }

  function enNube() {
    var c = config();
    return !!(c.url && c.key);
  }

  function headers(extra) {
    var c = config();
    var h = {
      "apikey": c.key,
      "Authorization": "Bearer " + c.key,
      "Content-Type": "application/json"
    };

    if (extra) {
      Object.keys(extra).forEach(function (k) {
        h[k] = extra[k];
      });
    }

    return h;
  }

  function api(ruta, opciones) {
    var c = config();
    opciones = opciones || {};
    opciones.headers = headers(opciones.headers);

    return fetch(c.url + "/rest/v1/" + ruta, opciones)
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (texto) {
            throw new Error(texto || ("HTTP " + r.status));
          });
        }

        if (r.status === 204) return null;

        var tipo = r.headers.get("content-type") || "";
        return tipo.indexOf("application/json") >= 0 ? r.json() : r.text();
      });
  }

  function rpc(nombre, datos) {
    var c = config();

    return fetch(c.url + "/rest/v1/rpc/" + nombre, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(datos || {})
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (texto) {
          throw new Error(texto || ("HTTP " + r.status));
        });
      }
      return r.json();
    });
  }

  function leerJSON(clave, porDefecto) {
    if (!hayStorage) return porDefecto;
    try {
      var crudo = window.localStorage.getItem(clave);
      return crudo ? JSON.parse(crudo) : porDefecto;
    } catch (e) {
      return porDefecto;
    }
  }

  function escribirJSON(clave, valor) {
    if (!hayStorage) return false;
    try {
      window.localStorage.setItem(clave, JSON.stringify(valor));
      return true;
    } catch (e) {
      return false;
    }
  }

  function normalizar(p) {
    if (!p.estado || !ESTADOS[p.estado]) p.estado = "pendiente";

    if (!Array.isArray(p.historial) || !p.historial.length) {
      p.historial = [{
        estado: p.estado,
        fecha: p.registrado || new Date().toISOString(),
        nota: "Pedido registrado"
      }];
    }

    p.etapa = ESTADOS[p.estado].etapa;
    return p;
  }

  function desdeFila(r) {
    return normalizar({
      id: r.id,
      numero: r.numero,
      anio: r.anio,
      numeroTexto: r.numero_texto,
      provisional: !!r.provisional,
      fecha: r.fecha || "",
      area: r.area || "",
      tipo: r.tipo || "Libre",
      numerado: r.numerado || "",
      items: Array.isArray(r.items) ? r.items : [],
      observaciones: r.observaciones || "",
      afectacion: r.afectacion || "",
      partida: r.partida || "",
      codigo: r.codigo || "",
      total: Number(r.total) || 0,
      registrado: r.registrado,
      estado: r.estado || "pendiente",
      etapa: r.etapa || "analizar",
      historial: Array.isArray(r.historial) ? r.historial : [],
      actualizadoEn: r.actualizado_en || r.registrado
    });
  }

  function aFila(p) {
    return {
      id: p.id,
      numero: Number(p.numero),
      anio: Number(p.anio),
      numero_texto: p.numeroTexto,
      provisional: !!p.provisional,
      fecha: p.fecha || null,
      area: p.area || null,
      tipo: p.tipo || "Libre",
      numerado: p.numerado || null,
      items: p.items || [],
      observaciones: p.observaciones || null,
      afectacion: p.afectacion || null,
      partida: p.partida || null,
      codigo: p.codigo || null,
      total: Number(p.total) || 0,
      registrado: p.registrado || new Date().toISOString(),
      estado: p.estado || "pendiente",
      etapa: p.etapa || "analizar",
      historial: p.historial || []
    };
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

  function proximoNumero(anio) {
    anio = anio || new Date().getFullYear();
    var c = contadores();
    var siguiente = (Number(c[anio]) || 0) + 1;

    return {
      anio: anio,
      numero: siguiente,
      texto: pad(siguiente) + "/" + anio
    };
  }

  function ultimoMovimiento(p) {
    if (p.actualizadoEn) return String(p.actualizadoEn);

    var h = p.historial || [];
    return h.length
      ? String(h[h.length - 1].fecha)
      : String(p.registrado || "");
  }

  function fusionar(remotos) {
    var locales = pedidos();
    var porId = {};

    locales.forEach(function (p) {
      porId[p.id] = p;
    });

    remotos.forEach(function (p) {
      if (!p.id) return;

      var actual = porId[p.id];
      var fechaR = ultimoMovimiento(p);
      var fechaL = actual ? ultimoMovimiento(actual) : "";

      if (!actual || fechaR >= fechaL) {
        porId[p.id] = p;
      }
    });

    var lista = Object.keys(porId).map(function (id) {
      return normalizar(porId[id]);
    });

    lista.sort(function (a, b) {
      return String(a.registrado || "").localeCompare(String(b.registrado || ""));
    });

    guardarPedidos(lista);
    return lista;
  }

  function subir(pedido) {
    if (!enNube()) return Promise.resolve(false);

    return api("compras_pedidos?on_conflict=id", {
      method: "POST",
      headers: {
        "Prefer": "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(aFila(pedido))
    }).then(function () {
      return true;
    }).catch(function (e) {
      console.error("Compras · error al guardar en Supabase:", e);
      return false;
    });
  }

  function sincronizar() {
    if (!enNube()) {
      return Promise.resolve({
        nube: false,
        pedidos: pedidos()
      });
    }

    return api("compras_pedidos?select=*&order=registrado.asc")
      .then(function (filas) {
        var remotos = (filas || []).map(desdeFila);
        var lista = fusionar(remotos);

        var idsRemotos = {};
        remotos.forEach(function (p) {
          idsRemotos[p.id] = true;
        });

        var faltantes = lista.filter(function (p) {
          return !idsRemotos[p.id];
        });

        return Promise.all(faltantes.map(subir)).then(function () {
          return {
            nube: true,
            pedidos: lista
          };
        });
      })
      .catch(function (e) {
        console.error("Compras · error de sincronización:", e);

        return {
          nube: false,
          error: e.message,
          pedidos: pedidos()
        };
      });
  }

  function pedirNumero(anio) {
    anio = Number(anio) || new Date().getFullYear();

    if (!enNube()) {
      var sinNube = proximoNumero(anio);
      sinNube.provisional = true;
      return Promise.resolve(sinNube);
    }

    return rpc("compras_siguiente_numero", {
      p_anio: anio
    }).then(function (n) {
      n = Number(n);

      return {
        anio: anio,
        numero: n,
        texto: pad(n) + "/" + anio,
        provisional: false
      };
    }).catch(function (e) {
      console.error("Compras · no se pudo obtener número de Supabase:", e);

      var local = proximoNumero(anio);
      local.provisional = true;
      return local;
    });
  }

  function registrar(datos, prox) {
    var anio =
      Number(String(datos.fecha || "").slice(0, 4)) ||
      new Date().getFullYear();

    prox = prox || proximoNumero(anio);

    var ahora = new Date().toISOString();

    var pedido = {
      id: "P" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      numero: prox.numero,
      anio: prox.anio,
      numeroTexto: prox.texto,
      provisional: !!prox.provisional,
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
      registrado: ahora,
      actualizadoEn: ahora,
      estado: "pendiente",
      etapa: "analizar",
      historial: [{
        estado: "pendiente",
        fecha: ahora,
        nota: "Pedido registrado"
      }]
    };

    var lista = pedidos();
    lista.push(pedido);

    var ok = guardarPedidos(lista);

    var c = contadores();
    if (!c[prox.anio] || prox.numero > c[prox.anio]) {
      c[prox.anio] = prox.numero;
    }
    guardarContadores(c);

    subir(pedido);

    return {
      ok: ok,
      pedido: pedido,
      persistido: (hayStorage && ok) || enNube()
    };
  }

  function cambiarEstado(id, estado, nota) {
    if (!ESTADOS[estado]) {
      return {
        ok: false,
        mensaje: "Estado desconocido."
      };
    }

    var lista = pedidos();
    var pedido = null;

    lista.forEach(function (p) {
      if (p.id === id) pedido = p;
    });

    if (!pedido) {
      return {
        ok: false,
        mensaje: "No se encontró el pedido."
      };
    }

    var ahora = new Date().toISOString();

    pedido.estado = estado;
    pedido.etapa = ESTADOS[estado].etapa;
    pedido.actualizadoEn = ahora;

    pedido.historial.push({
      estado: estado,
      fecha: ahora,
      nota: (nota || "").trim()
    });

    var ok = guardarPedidos(lista);
    subir(pedido);

    return {
      ok: ok,
      pedido: pedido
    };
  }

  function vaciar() {
    guardarPedidos([]);
    return guardarContadores({});
  }

  function exportar() {
    return {
      formato: "ersep-compras-v1",
      generado: new Date().toISOString(),
      contadores: contadores(),
      pedidos: pedidos()
    };
  }

  function importar(datos) {
    if (!datos || !Array.isArray(datos.pedidos)) {
      return {
        ok: false,
        agregados: 0,
        mensaje: "El archivo no tiene el formato esperado."
      };
    }

    var lista = pedidos();
    var existentes = {};

    lista.forEach(function (p) {
      existentes[p.id] = true;
    });

    var agregados = 0;

    datos.pedidos.forEach(function (p) {
      if (p && p.id && !existentes[p.id]) {
        p = normalizar(p);
        lista.push(p);
        existentes[p.id] = true;
        agregados++;
        subir(p);
      }
    });

    lista.sort(function (a, b) {
      return String(a.registrado || "").localeCompare(String(b.registrado || ""));
    });

    guardarPedidos(lista);

    var c = contadores();

    lista.forEach(function (p) {
      var anio = p.anio || new Date().getFullYear();

      if (!c[anio] || Number(p.numero) > Number(c[anio])) {
        c[anio] = Number(p.numero) || 0;
      }
    });

    guardarContadores(c);

    return {
      ok: true,
      agregados: agregados,
      mensaje: "Se agregaron " + agregados + " pedido(s)."
    };
  }

  return {
    disponible: hayStorage,
    pedidos: pedidos,
    proximoNumero: proximoNumero,
    registrar: registrar,
    cambiarEstado: cambiarEstado,
    sincronizar: sincronizar,
    pedirNumero: pedirNumero,
    enNube: enNube,
    ESTADOS: ESTADOS,
    ETAPAS: ETAPAS,
    vaciar: vaciar,
    exportar: exportar,
    importar: importar
  };
})();
