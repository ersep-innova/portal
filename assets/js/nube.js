/* =============================================================================
   ERSeP · Portal de Innovación — Cliente de la base compartida
   -----------------------------------------------------------------------------
   Habla con el Apps Script publicado (ver apps-script/Codigo.gs) y resuelve tres
   cosas que el navegador solo no puede:

     · que los datos se vean desde cualquier computadora,
     · que dos personas no tomen el mismo número de pedido,
     · que si no hay internet el trabajo no se pierda (queda en una cola y se
       envía cuando vuelve la conexión).

   La copia local sigue existiendo como caché: la pantalla nunca queda vacía
   esperando a la red.
   ============================================================================= */
window.ERSePNube = (function () {
  'use strict';

  var CFG = window.CONFIG_NUBE || {};
  var COLA = 'ersep.nube.cola';

  function configurada() {
    return !!(CFG.url && CFG.url.indexOf('http') === 0 && CFG.token);
  }

  function usuario() {
    try { return localStorage.getItem('ersep.nube.usuario') || ''; } catch (e) { return ''; }
  }

  function definirUsuario(nombre) {
    try { localStorage.setItem('ersep.nube.usuario', nombre || ''); } catch (e) {}
  }

  /* El POST va como texto plano a propósito: así el navegador no dispara la
     consulta previa de CORS, que Apps Script no responde. */
  function enviar(cuerpo) {
    return fetch(CFG.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: CFG.token, usuario: usuario() }, cuerpo))
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j.ok) throw new Error(j.error || 'Error del servidor');
      return j;
    });
  }

  function consultar(params) {
    var url = CFG.url + '?token=' + encodeURIComponent(CFG.token);
    Object.keys(params).forEach(function (k) {
      url += '&' + k + '=' + encodeURIComponent(params[k]);
    });
    return fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || 'Error del servidor');
        return j;
      });
  }

  /* ═════ Cola de pendientes ═════ */

  function leerCola() {
    try { return JSON.parse(localStorage.getItem(COLA) || '[]'); } catch (e) { return []; }
  }

  function escribirCola(c) {
    try { localStorage.setItem(COLA, JSON.stringify(c)); } catch (e) {}
  }

  function encolar(coleccion, id, datos) {
    var c = leerCola().filter(function (x) {
      return !(x.coleccion === coleccion && x.id === id);   // sólo la última versión
    });
    c.push({ coleccion: coleccion, id: id, datos: datos, fecha: new Date().toISOString() });
    escribirCola(c);
  }

  function pendientes() { return leerCola().length; }

  function sincronizarPendientes() {
    var c = leerCola();
    if (!configurada() || !c.length) return Promise.resolve({ enviados: 0, pendientes: c.length });

    var porColeccion = {};
    c.forEach(function (x) {
      (porColeccion[x.coleccion] = porColeccion[x.coleccion] || []).push({ id: x.id, datos: x.datos });
    });

    var envios = Object.keys(porColeccion).map(function (col) {
      return enviar({ accion: 'guardarLote', coleccion: col, registros: porColeccion[col] });
    });

    return Promise.all(envios)
      .then(function () { escribirCola([]); return { enviados: c.length, pendientes: 0 }; })
      .catch(function () { return { enviados: 0, pendientes: c.length }; });
  }

  /* ═════ Operaciones ═════ */

  function listar(coleccion) {
    if (!configurada()) return Promise.reject(new Error('sin configurar'));
    return consultar({ accion: 'listar', coleccion: coleccion })
      .then(function (j) { return j.registros || []; });
  }

  /* Si no hay red, el registro queda en la cola y se reintenta después */
  function guardar(coleccion, id, datos) {
    if (!configurada()) return Promise.resolve({ diferido: true });
    return enviar({ accion: 'guardar', coleccion: coleccion, id: id, datos: datos })
      .then(function (j) { return { diferido: false, resultado: j.resultado }; })
      .catch(function (err) {
        encolar(coleccion, id, datos);
        return { diferido: true, error: err.message };
      });
  }

  function numero(clave) {
    if (!configurada()) return Promise.reject(new Error('sin configurar'));
    return enviar({ accion: 'numero', clave: clave }).then(function (j) { return j.numero; });
  }

  function ping() {
    if (!configurada()) return Promise.resolve({ ok: false, motivo: 'sin configurar' });
    return consultar({ accion: 'ping' })
      .then(function () { return { ok: true }; })
      .catch(function (e) { return { ok: false, motivo: e.message }; });
  }

  /* Al recuperar la conexión se vacía la cola sin que el usuario haga nada */
  window.addEventListener('online', function () { sincronizarPendientes(); });
  if (configurada()) {
    window.setTimeout(sincronizarPendientes, 1500);
  }

  return {
    configurada: configurada,
    listar: listar,
    guardar: guardar,
    numero: numero,
    ping: ping,
    pendientes: pendientes,
    sincronizarPendientes: sincronizarPendientes,
    usuario: usuario,
    definirUsuario: definirUsuario
  };
})();
