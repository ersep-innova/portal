/* =============================================================================
   ERSeP · Portal de Innovación — Asistente del portal
   -----------------------------------------------------------------------------
   Asistente conversacional por reglas (sin IA ni servicios pagos). Responde con
   los datos reales que el propio portal publica:

     · módulos disponibles y qué hace cada uno (se leen de las tarjetas),
     · padrón de electricistas habilitados e instaladores de generación distribuida,
     · relevamiento de antenas por operador, departamento y zona,
     · tarifas de peaje de la Red de Accesos a Córdoba y Convenio N.º 38,
     · valores de referencia de antenas (minuto y Unidad de Multa),
     · índices estadísticos, consultando la API pública de estadísticas.

   Entiende varias preguntas en un mismo mensaje: las separa y contesta cada una.
   Los datos se cargan sólo cuando hacen falta y quedan en memoria.
   ============================================================================= */
(function () {
  'use strict';

  /* ══════════════════════════ Utilidades ══════════════════════════ */

  var RAIZ = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/assets\/js\/asistente-portal\.js.*$/, '') : '';
  })();

  function norm(t) {
    return String(t == null ? '' : t)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/ñ/gi, 'n').replace(/\?/g, 'n')
      .toLowerCase().replace(/[^a-z0-9%$.,/\- ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function num(n, dec) {
    return Number(n).toLocaleString('es-AR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  }

  function tiene(q, palabras) {
    return palabras.some(function (p) { return q.indexOf(p) !== -1; });
  }

  function cargarScript(ruta) {
    return new Promise(function (ok, mal) {
      var s = document.createElement('script');
      s.src = RAIZ + ruta + (ruta.indexOf('?') === -1 ? '?v=' + Date.now() : '');
      s.onload = ok; s.onerror = function () { mal(new Error('No se pudo cargar ' + ruta)); };
      document.head.appendChild(s);
    });
  }

  function cargarTexto(ruta) {
    return fetch(RAIZ + ruta, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  function partirCSV(linea, sep) {
    var out = [], act = '', q = false;
    for (var i = 0; i < linea.length; i++) {
      var c = linea[i];
      if (c === '"') { if (q && linea[i + 1] === '"') { act += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(act); act = ''; }
      else act += c;
    }
    out.push(act);
    return out.map(function (x) { return x.trim(); });
  }

  /* ══════════════════════════ Fuentes de datos ══════════════════════════ */

  var CACHE = {};

  function modulos() {
    if (CACHE.modulos) return CACHE.modulos;
    var lista = [];
    document.querySelectorAll('#portal_tool_grid > .tool-card').forEach(function (c) {
      var t = c.querySelector('strong'), d = c.querySelector('small'),
          b = c.querySelector('.menu-card-badge'), m = c.querySelector('.tool-meta');
      if (!t) return;
      lista.push({
        nombre: t.textContent.trim(),
        descripcion: d ? d.textContent.trim().replace(/\s+/g, ' ') : '',
        estado: b ? b.textContent.trim() : '',
        area: m ? m.textContent.trim().replace(/\s+/g, ' ') : '',
        href: c.getAttribute('href') || '',
        clave: norm(t.textContent + ' ' + (m ? m.textContent : ''))
      });
    });
    CACHE.modulos = lista;
    return lista;
  }

  function electricistas() {
    if (CACHE.elec) return CACHE.elec;
    CACHE.elec = Promise.all([
      cargarTexto('modulos/electricistas/datos/electricistas-general.csv'),
      cargarTexto('modulos/electricistas/datos/electricistas-gd.csv').catch(function () { return ''; }),
      cargarScript('modulos/electricistas/departamentos-localidades.js').catch(function () {})
    ]).then(function (r) {
      var idx = {};
      var D = window.DEPARTAMENTOS_LOCALIDADES || {};
      Object.keys(D).forEach(function (d) { D[d].forEach(function (l) { idx[norm(l)] = d; }); });

      function leer(txt, gd) {
        var lineas = txt.replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
        if (!lineas.length) return [];
        var sep = lineas[0].split(';').length > lineas[0].split(',').length ? ';' : ',';
        var cab = partirCSV(lineas[0], sep).map(norm);
        var col = function (re) { for (var i = 0; i < cab.length; i++) if (re.test(cab[i])) return i; return -1; };
        var iN = col(/nombre/), iC = col(/cuil/), iCat = col(/categoria/), iL = col(/localidad/),
            iB = col(/barrio/), iT1 = col(/telefono1|celular/), iCont = col(/contacto/), iM = col(/email/);
        return lineas.slice(1).map(function (l) {
          var p = partirCSV(l, sep);
          var loc = (p[iL] || '').trim();
          var tel = iT1 >= 0 ? p[iT1] : (iCont >= 0 ? (p[iCont] || '').split('|').map(function (x) { return x.trim(); })
            .filter(function (x) { return x && x.indexOf('@') === -1 && !/^-+$/.test(x); })[0] || '' : '');
          return {
            nombre: p[iN] || '', cuil: p[iC] || '', categoria: (p[iCat] || '').toUpperCase(),
            localidad: loc, barrio: p[iB] || '', tel: tel || '',
            email: iM >= 0 ? p[iM] : '', depto: loc ? (idx[norm(loc)] || 'Sin departamento asignado') : '',
            gd: gd
          };
        }).filter(function (x) { return x.nombre; });
      }

      var gen = leer(r[0], false), gd = leer(r[1], true);
      var cuilGD = {};
      gd.forEach(function (x) { if (x.cuil) cuilGD[x.cuil] = true; });
      gen.forEach(function (x) { x.esGD = !!cuilGD[x.cuil]; });
      return { general: gen, gd: gd };
    });
    return CACHE.elec;
  }

  function antenas() {
    if (CACHE.ant) return CACHE.ant;
    CACHE.ant = cargarScript('modulos/antenas/datos-antenas.js').then(function () {
      return String(window.ANTENAS_DATOS || '').split('\n').map(function (l) { return l.trim(); })
        .filter(Boolean).map(function (l) {
          var p = l.split('|');
          return { operador: p[0], codigo: p[1], direccion: p[3], depto: (p[4] || '').trim(), zona: (p[7] || '').trim() };
        });
    });
    return CACHE.ant;
  }

  /* Los paneles tarifarios son la fuente: se leen sus tablas tal como están publicadas */
  function panel(nombre) {
    CACHE.panel = CACHE.panel || {};
    if (CACHE.panel[nombre]) return CACHE.panel[nombre];
    CACHE.panel[nombre] = cargarTexto('assets/paneles/' + nombre + '.html').then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var tablas = [];
      doc.querySelectorAll('.pcard').forEach(function (card) {
        var h = card.querySelector('h4');
        card.querySelectorAll('table').forEach(function (t) {
          var filas = [].map.call(t.querySelectorAll('tr'), function (tr) {
            return [].map.call(tr.querySelectorAll('th,td'), function (c) { return c.textContent.trim().replace(/\s+/g, ' '); });
          });
          tablas.push({ titulo: h ? h.textContent.trim() : '', filas: filas });
        });
      });
      var metricas = [].map.call(doc.querySelectorAll('.metric'), function (m) {
        var n = m.querySelector('.name'), v = m.querySelector('.value'), s = m.querySelector('small');
        var card = m.closest('.pcard'), h = card && card.querySelector('h4');
        return { seccion: h ? h.textContent.trim() : '', nombre: n ? n.textContent.trim() : '',
                 valor: v ? v.textContent.trim() : '', nota: s ? s.textContent.trim() : '' };
      });
      var cajas = [].map.call(doc.querySelectorAll('.maxbox, .benef > div, .notice'), function (b) {
        return b.textContent.trim().replace(/\s+/g, ' ');
      });
      return { tablas: tablas, metricas: metricas, cajas: cajas };
    });
    return CACHE.panel[nombre];
  }

  function apiEstadisticas() {
    if (CACHE.statsBase) return CACHE.statsBase;
    CACHE.statsBase = cargarTexto('modulos/estadisticas/config.js').then(function (t) {
      var m = /API_BASE_URL:\s*["']([^"']+)["']/.exec(t);
      if (!m) throw new Error('sin URL');
      return m[1].replace(/\/+$/, '');
    });
    return CACHE.statsBase;
  }

  function metaEstadisticas() {
    if (CACHE.statsMeta) return CACHE.statsMeta;
    CACHE.statsMeta = apiEstadisticas().then(function (base) {
      return fetch(base + '/api/meta').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (m) { m._base = base; return m; });
    });
    CACHE.statsMeta.catch(function () { CACHE.statsMeta = null; });
    return CACHE.statsMeta;
  }

  /* ══════════════════════════ Entendimiento ══════════════════════════ */

  var MESES = { enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5,
    junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9,
    octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12 };

  function fechas(q) {
    var re = new RegExp('\\b(' + Object.keys(MESES).sort(function (a, b) { return b.length - a.length; }).join('|') +
      ')\\s*(?:de\\s*|del\\s*|-|/)?\\s*(20\\d{2})\\b', 'g');
    var out = [], m;
    while ((m = re.exec(q))) out.push(m[2] + '-' + String(MESES[m[1]]).padStart(2, '0') + '-01');
    return out;
  }

  /* Varias preguntas en un mismo mensaje */
  function separar(texto) {
    var partes = String(texto).split(/\?|\n|;|\s(?:y ademas|ademas|y tambien|tambien|y por otro lado|por otro lado)\s/i)
      .map(function (p) { return p.replace(/^[\s¿,.\-y]+|[\s,.]+$/g, '').trim(); })
      .filter(function (p) { return p.length > 2; });
    return partes.length ? partes : [String(texto).trim()];
  }

  var TEMAS = [
    { id: 'saludo', claves: ['hola', 'buen dia', 'buenas', 'que tal'] },
    { id: 'ayuda', claves: ['ayuda', 'que podes', 'que puedo preguntar', 'como funciona', 'que sabes'] },
    { id: 'modulos', claves: ['modulos', 'herramientas', 'que hay en el portal', 'que tiene el portal', 'secciones', 'listado de'] },
    { id: 'electricistas', claves: ['electricista', 'matriculado', 'idoneo', 'tecnico', 'profesional', 'instalador',
        'generacion distribuida', ' gd', 'a1', 'b1', 'habilitado'] },
    { id: 'antenas', claves: ['antena', 'claro', 'personal', 'movistar', 'telecom', 'operador'] },
    { id: 'antenasTarifa', claves: ['unidad de multa', ' um ', 'minuto', 'llamada', 'prepago'] },
    { id: 'peaje', claves: ['peaje', 'tarifa vial', 'telepeaje', 'caminos de las sierras', 'rac', 'categoria 2',
        'automovil', 'moto', 'camion', 'ejes', 'convenio', 'la calera', 'malagueno', 'e-55', 'e55', 'circunvalacion'] },
    { id: 'estadistica', claves: ['ipc', 'inflacion', 'dolar', 'ripte', 'ipim', 'indice', 'salario', 'variacion', 'cer', 'uva',
        'icl', 'alquiler', 'mayorista', 'cuanto aumento', 'cuanto subio'] },
    { id: 'compras', claves: ['compra', 'pedido', 'provision', 'libreria', 'cafeteria'] }
  ];

  function detectar(q) {
    var qq = ' ' + q + ' ';
    var puntos = TEMAS.map(function (t) {
      var n = 0;
      t.claves.forEach(function (c) { if (qq.indexOf(c) !== -1) n += c.length; });
      return { id: t.id, n: n };
    }).filter(function (x) { return x.n > 0; }).sort(function (a, b) { return b.n - a.n; });

    // Las tarifas de antenas se piden con palabras de antenas: se priorizan cuando aparecen
    if (puntos.some(function (p) { return p.id === 'antenasTarifa'; }) && tiene(qq, ['antena', 'minuto', 'um ', 'multa'])) {
      return 'antenasTarifa';
    }
    return puntos.length ? puntos[0].id : null;
  }

  /* ══════════════════════════ Respuestas ══════════════════════════ */

  function enlace(href, texto) {
    return '<a class="ap-link" href="' + esc(href) + '">' + esc(texto) + ' →</a>';
  }

  function tabla(cab, filas) {
    return '<div class="ap-tabla"><table><thead><tr>' + cab.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + filas.map(function (f) {
        return '<tr>' + f.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function conteo(lista, clave, tope) {
    var c = {};
    lista.forEach(function (x) { var k = x[clave] || '—'; c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).map(function (k) { return [k, c[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, tope || 50);
  }

  var R = {};

  R.saludo = function () {
    return Promise.resolve('¡Hola! Soy el asistente del Portal de Innovación del ERSeP. Podés hacerme varias preguntas juntas, ' +
      'por ejemplo: <i>“¿cuántos electricistas hay en Villa María? ¿y cuánto sale el peaje para autos?”</i>');
  };

  R.ayuda = function () {
    return Promise.resolve('<b>Puedo responder con los datos del portal sobre:</b><ul>' +
      '<li><b>Módulos</b>: qué hay, para qué sirve cada uno y dónde entrar.</li>' +
      '<li><b>Electricistas</b>: cantidad por localidad, departamento o categoría; instaladores de generación distribuida; nombres y contacto.</li>' +
      '<li><b>Antenas</b>: cantidad por operador, departamento o zona.</li>' +
      '<li><b>Peajes</b>: tarifas por categoría, telepeaje, Convenio N.º 38 y residentes.</li>' +
      '<li><b>Antenas · tarifas</b>: valor del minuto y Unidad de Multa.</li>' +
      '<li><b>Estadísticas</b>: IPC, dólar, RIPTE y demás índices; valor de un mes o variación entre dos.</li>' +
      '<li><b>Compras</b>: cómo registrar un pedido y sus etapas.</li></ul>' +
      'Podés escribir varias preguntas en un mismo mensaje, separadas por signos de pregunta o en renglones distintos.');
  };

  R.modulos = function (q) {
    var lista = modulos();
    var disp = lista.filter(function (m) { return /disponible|contrase|cuenta/i.test(norm(m.estado)); });
    var prox = lista.filter(function (m) { return /proxim/.test(norm(m.estado)); });
    return Promise.resolve('<b>El portal tiene ' + lista.length + ' módulos.</b> ' + disp.length + ' están en funcionamiento' +
      (prox.length ? ' y ' + prox.length + ' en desarrollo' : '') + ':' +
      tabla(['Módulo', 'Área', 'Estado'], lista.map(function (m) {
        return [m.href ? enlace(m.href, m.nombre) : esc(m.nombre), esc(m.area), esc(m.estado)];
      })) + 'Preguntame por cualquiera para ver el detalle.');
  };

  function moduloMencionado(q) {
    var mejor = null, pm = 0;
    modulos().forEach(function (m) {
      var n = 0;
      norm(m.nombre).split(' ').forEach(function (w) { if (w.length > 3 && q.indexOf(w) !== -1) n += w.length; });
      if (n > pm) { pm = n; mejor = m; }
    });
    return pm >= 5 ? mejor : null;
  }

  R.modulo = function (m) {
    return Promise.resolve('<b>' + esc(m.nombre) + '</b> · <span class="ap-tag">' + esc(m.estado) + '</span><br>' +
      '<small>' + esc(m.area) + '</small><p>' + esc(m.descripcion) + '</p>' +
      (m.href ? enlace(m.href, 'Abrir ' + m.nombre) : ''));
  };

  R.electricistas = function (q) {
    return electricistas().then(function (d) {
      var gd = tiene(' ' + q + ' ', ['generacion distribuida', ' gd ', 'instalador', 'calificado', ' a1', ' b1', ' a2', ' b2']);
      var base = gd ? d.gd : d.general;
      var lista = base.slice();
      var filtros = [];

      // Categoría
      var cats = gd ? ['A1', 'A2', 'B1', 'B2'] : ['IDONEO', 'TECNICO', 'PROFESIONAL'];
      var cat = cats.filter(function (c) { return (' ' + q + ' ').indexOf(' ' + norm(c)) !== -1; })[0];
      if (cat) { lista = lista.filter(function (x) { return norm(x.categoria) === norm(cat); }); filtros.push('categoría ' + cat); }

      // Localidad (la más larga que aparezca en la pregunta)
      var locs = {};
      base.forEach(function (x) { if (x.localidad) locs[norm(x.localidad)] = x.localidad; });
      var loc = Object.keys(locs).filter(function (l) { return l.length > 3 && (' ' + q + ' ').indexOf(' ' + l + ' ') !== -1; })
        .sort(function (a, b) { return b.length - a.length; })[0];

      // Departamento
      var deps = {};
      base.forEach(function (x) { if (x.depto) deps[norm(x.depto)] = x.depto; });
      var dep = Object.keys(deps).filter(function (dd) {
        return dd.length > 3 && tiene(q, ['depto', 'departamento']) && q.indexOf(dd) !== -1;
      })[0];

      if (dep) { lista = lista.filter(function (x) { return norm(x.depto) === dep; }); filtros.push('departamento ' + deps[dep]); }
      else if (loc) { lista = lista.filter(function (x) { return norm(x.localidad) === loc; }); filtros.push(locs[loc]); }

      // Barrio (sólo si ya hay localidad)
      if (loc && /barrio\s+([a-z0-9 ]+)/.test(q)) {
        var b = /barrio\s+([a-z0-9 ]+)/.exec(q)[1].trim();
        lista = lista.filter(function (x) { return norm(x.barrio).indexOf(b) !== -1; });
        filtros.push('barrio ' + b);
      }

      var titulo = gd ? 'instaladores calificados de generación distribuida' : 'electricistas habilitados';
      var html = '<b>' + num(lista.length) + ' ' + titulo + '</b>' + (filtros.length ? ' en ' + esc(filtros.join(' · ')) : ' en el padrón') + '.';

      if (!filtros.length) {
        html += tabla(['Categoría', 'Cantidad'], conteo(lista, 'categoria').map(function (r) { return [esc(r[0]), num(r[1])]; }));
        html += '<p>Localidades con más matriculados:</p>' +
          tabla(['Localidad', 'Cantidad'], conteo(lista.filter(function (x) { return x.localidad; }), 'localidad', 8)
            .map(function (r) { return [esc(r[0]), num(r[1])]; }));
        var sinLoc = lista.filter(function (x) { return !x.localidad; }).length;
        if (sinLoc) html += '<small>' + num(sinLoc) + ' no declaran localidad.</small>';
      } else if (!cat && lista.length) {
        html += tabla(['Categoría', 'Cantidad'], conteo(lista, 'categoria').map(function (r) { return [esc(r[0]), num(r[1])]; }));
      }

      // Nombres: sólo si se piden o si son pocos
      if (lista.length && (tiene(q, ['quienes', 'quien', 'nombre', 'listar', 'lista', 'contacto', 'telefono', 'mostrame']) || lista.length <= 5)) {
        var muestra = lista.slice(0, 15);
        html += tabla(['Nombre', 'Categoría', 'Localidad', 'Teléfono'], muestra.map(function (x) {
          return [esc(x.nombre), esc(x.categoria), esc(x.localidad + (x.barrio ? ' · ' + x.barrio : '')), esc(x.tel || '—')];
        }));
        if (lista.length > 15) html += '<small>Se muestran 15 de ' + num(lista.length) + '. El resto, con filtros y WhatsApp, está en el módulo.</small>';
      }

      if (!gd && !filtros.length) {
        html += '<p>' + num(d.general.filter(function (x) { return x.esGD; }).length) +
          ' de ellos también están habilitados para instalar generación distribuida.</p>';
      }
      return html + enlace('modulos/electricistas/', 'Abrir el buscador de electricistas');
    });
  };

  R.antenas = function (q) {
    return antenas().then(function (lista) {
      var filtros = [];
      var qq = ' ' + q + ' ';
      var ops = ['CLARO', 'PERSONAL', 'MOVISTAR', 'TELECOM'].filter(function (o) { return qq.indexOf(' ' + norm(o)) !== -1; });
      if (ops.length) { lista = lista.filter(function (a) { return ops.indexOf(a.operador) !== -1; }); filtros.push(ops.join(' y ')); }

      var deps = {};
      lista.forEach(function (a) { if (a.depto) deps[norm(a.depto)] = a.depto; });
      var dep = Object.keys(deps).filter(function (dd) { return dd.length > 3 && qq.indexOf(' ' + dd + ' ') !== -1; })
        .sort(function (a, b) { return b.length - a.length; })[0];
      if (dep) { lista = lista.filter(function (a) { return norm(a.depto) === dep; }); filtros.push('departamento ' + deps[dep]); }

      var zonas = {};
      lista.forEach(function (a) { if (a.zona) zonas[norm(a.zona)] = a.zona; });
      var zona = Object.keys(zonas).filter(function (z) { return qq.indexOf(' ' + z + ' ') !== -1; })[0];
      if (zona) { lista = lista.filter(function (a) { return norm(a.zona) === zona; }); filtros.push('zona ' + zonas[zona]); }

      var html = '<b>' + num(lista.length) + ' antenas relevadas</b>' + (filtros.length ? ' · ' + esc(filtros.join(' · ')) : '') + '.';
      if (!ops.length) html += tabla(['Operador', 'Antenas'], conteo(lista, 'operador').map(function (r) { return [esc(r[0]), num(r[1])]; }));
      if (!dep) html += '<p>Por departamento:</p>' + tabla(['Departamento', 'Antenas'],
        conteo(lista, 'depto', 10).map(function (r) { return [esc(r[0]), num(r[1])]; }));
      if (!zona && !dep) html += tabla(['Zona', 'Antenas'], conteo(lista, 'zona').map(function (r) { return [esc(r[0]), num(r[1])]; }));
      return html + enlace('modulos/antenas/', 'Ver el mapa de antenas');
    });
  };

  R.antenasTarifa = function () {
    return panel('antenas').then(function (p) {
      var filas = p.metricas.map(function (m) { return [esc(m.seccion), esc(m.nombre), '<b>' + esc(m.valor) + '</b>']; });
      var um = p.cajas.filter(function (c) { return /UM|Unidad|Máximo/i.test(c); });
      return '<b>Valores de referencia de telefonía móvil</b> (llamada local de 60 segundos, prepago):' +
        tabla(['Fuente', 'Operador', 'Minuto'], filas) +
        (um.length ? '<ul>' + um.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') +
        '<small>La Unidad de Multa equivale a 12 veces el valor máximo del último informe.</small><br>' +
        enlace('#', 'Ver el panel completo filtrando por Antenas').replace('href="#"', 'href="#" data-ap-filtro="antennas"');
    });
  };

  R.peaje = function (q) {
    return panel('vial').then(function (p) {
      var qq = ' ' + q + ' ';
      var html = '';
      var manual = p.tablas.filter(function (t) { return /pago manual|vigentes/i.test(t.titulo); })[0];
      var tele = p.tablas.filter(function (t) { return /telepeaje/i.test(t.titulo); })[0];
      var conv = p.tablas.filter(function (t) { return /convenio|e-55/i.test(t.titulo + ' ' + (t.filas[0] || []).join(' ')); })[0];

      var quiereConvenio = tiene(qq, ['convenio', 'la calera', 'malagueno', 'residente', 'e-55', 'e55', 'circunvalacion', 'anillo']);
      var quiereTele = tiene(qq, ['telepeaje', 'pasada', 'dinamico', 'tag']);

      if (quiereConvenio) {
        html += '<b>Convenio N.º 38 · régimen diferencial de residentes</b><ul>' +
          p.cajas.filter(function (c) { return /anillo|residentes|E-55|Ruta 20/i.test(c); })
            .map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>';
        if (conv) html += tabla(conv.filas[0], conv.filas.slice(1).map(function (f) { return f.map(esc); }));
      }

      if (!quiereConvenio || tiene(qq, ['categoria', 'auto', 'moto', 'camion', 'eje', 'cuanto', 'tarifa', 'peaje'])) {
        if (manual) {
          var filas = manual.filas.slice(1);
          var catN = /categoria\s*(\d)/.exec(qq);
          var ejes = /(\d)\s*(?:o\s*\d\s*)?ejes/.exec(qq);
          if (catN) {
            filas = filas.filter(function (f) { return f[0].indexOf(catN[1] + ' ') === 0; });
          } else if (tiene(qq, ['auto', 'automovil'])) {
            filas = filas.filter(function (f) { return /^2 /.test(f[0]); });
          } else if (tiene(qq, ['moto'])) {
            filas = filas.filter(function (f) { return /^1 /.test(f[0]); });
          } else if (ejes) {
            // La categoría surge de la cantidad de ejes declarada en el cuadro
            var n = Number(ejes[1]);
            filas = filas.filter(function (f) {
              var m = f[0].match(/(\d)(?:\s*\/\s*|\s+o\s+)?(\d)?\s*ejes/);
              if (!m) return false;
              return n === Number(m[1]) || (m[2] && n === Number(m[2])) ||
                     (/mas de 6/.test(norm(f[0])) && n > 6);
            });
          }
          if (!filas.length) filas = manual.filas.slice(1);
          html += '<b>Tarifas vigentes · pago manual</b>' + tabla(manual.filas[0], filas.map(function (f) { return f.map(esc); }));
          if (tiene(qq, ['moto'])) html += '<small>Las motocicletas abonan únicamente sábados, domingos y feriados.</small>';
        }
      }

      if (quiereTele || tiene(qq, ['auto', 'categoria 2'])) {
        if (tele) html += '<b>Telepeaje · Categoría 2</b>' + tabla(tele.filas[0], tele.filas.slice(1).map(function (f) { return f.map(esc); }));
      }

      return (html || 'No encontré ese dato en el tarifario publicado.') + '<br>' +
        enlace('#', 'Ver el panel completo filtrando por Vial').replace('href="#"', 'href="#" data-ap-filtro="road"');
    });
  };

  R.estadistica = function (q) {
    return metaEstadisticas().then(function (meta) {
      var series = (meta.value_columns || []).map(function (s) { return { id: s.id, nombre: s.name, n: norm(s.name) }; });

      // La serie con más palabras en común con la pregunta
      var ALIAS = { inflacion: 'ipc', dolar: 'dolar', salarios: 'salario', alquileres: 'alquiler' };
      var palabras = q.split(' ').map(function (w) { return ALIAS[w] || w; }).filter(function (w) { return w.length >= 3; });
      var puntuadas = series.map(function (s) {
        var n = 0;
        palabras.forEach(function (w) { if (s.n.indexOf(w) !== -1) n += w.length; });
        return { s: s, n: n };
      }).filter(function (x) { return x.n > 0; }).sort(function (a, b) { return b.n - a.n; });

      if (!puntuadas.length) {
        return 'No identifiqué el índice. Algunos disponibles: ' + series.slice(0, 12).map(function (s) { return esc(s.nombre); }).join(', ') +
          '…<br>' + enlace('modulos/estadisticas/', 'Ver todas las series');
      }

      var serie = puntuadas[0].s;
      var f = fechas(q);
      var disponibles = (meta.index_values || []).map(function (x) { return x.value; });
      var ultimo = disponibles[disponibles.length - 1];

      if (f.length >= 2 || tiene(q, ['variacion', 'aumento', 'subio', 'cuanto crecio'])) {
        var desde = f[0] || disponibles[Math.max(0, disponibles.length - 13)];
        var hasta = f[1] || ultimo;
        var url = meta._base + '/api/variaciones?col_idxs=' + encodeURIComponent(serie.id) +
          '&desde=' + encodeURIComponent(desde) + '&hasta=' + encodeURIComponent(hasta);
        return fetch(url).then(function (r) { return r.json(); }).then(function (d) {
          var x = (d.data || [])[0];
          if (!x || x.variacion == null) return '<b>' + esc(serie.nombre) + '</b>: no hay datos suficientes entre esas fechas.';
          return '<b>' + esc(serie.nombre) + '</b><br>' + esc(desde.slice(0, 7)) + ': ' + num(x.inicial, 2) +
            ' → ' + esc(hasta.slice(0, 7)) + ': ' + num(x.final, 2) +
            '<br>Variación punta a punta: <b>' + num(x.variacion, 2) + ' %</b><br>' +
            enlace('modulos/estadisticas/', 'Analizarlo en el panel de estadísticas');
        });
      }

      var mes = f[0] || ultimo;
      var url2 = meta._base + '/api/data?col_idxs=' + encodeURIComponent(serie.id) +
        '&desde=' + encodeURIComponent(mes) + '&hasta=' + encodeURIComponent(mes);
      return fetch(url2).then(function (r) { return r.json(); }).then(function (d) {
        var fila = (d.rows || [])[0];
        if (!fila) return '<b>' + esc(serie.nombre) + '</b>: sin dato para ' + esc(mes.slice(0, 7)) + '.';
        var v = Number(String(fila[1]).replace(',', '.'));
        var texto = isFinite(v) ? num(v, 2) : esc(fila[1]);
        return '<b>' + esc(serie.nombre) + '</b> · ' + esc(mes.slice(0, 7)) + ': <b>' + texto + '</b><br>' +
          '<small>Para ver una variación, indicá dos meses: “IPC de enero 2025 a julio 2026”.</small><br>' +
          enlace('modulos/estadisticas/', 'Abrir el panel de estadísticas');
      });
    }).catch(function () {
      return 'No pude conectarme al servicio de estadísticas en este momento.<br>' +
        enlace('modulos/estadisticas/', 'Probar desde el panel de estadísticas');
    });
  };

  R.compras = function () {
    return Promise.resolve('<b>Compras</b> permite armar la Solicitud de Pedido de Provisión en formato oficial, con ' +
      'preformularios de Librería y Cafetería, número correlativo e impresión en PDF.<ul>' +
      '<li>Cada pedido registrado pasa por las etapas <b>pendiente de analizar → aprobado o rechazado → entregado</b>.</li>' +
      '<li>El registro de pedidos es interno del Área Compras y pide contraseña.</li></ul>' +
      enlace('modulos/compras/', 'Abrir el formulario de compras'));
  };

  function responder(fragmento) {
    var q = norm(fragmento);
    var tema = detectar(q);
    var mod = moduloMencionado(q);

    if (tema && R[tema]) return R[tema](q);
    if (mod) return R.modulo(mod);

    // Búsqueda general en las descripciones de los módulos
    var candidatos = modulos().map(function (m) {
      var n = 0;
      q.split(' ').forEach(function (w) { if (w.length > 3 && norm(m.descripcion + ' ' + m.nombre).indexOf(w) !== -1) n++; });
      return { m: m, n: n };
    }).filter(function (x) { return x.n > 0; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 3);

    if (candidatos.length) {
      return Promise.resolve('No tengo una respuesta exacta, pero esto puede servirte:<ul>' +
        candidatos.map(function (c) {
          return '<li>' + (c.m.href ? enlace(c.m.href, c.m.nombre) : esc(c.m.nombre)) + ' — ' + esc(c.m.descripcion) + '</li>';
        }).join('') + '</ul>');
    }
    return Promise.resolve('No entendí esa pregunta. Escribí <b>ayuda</b> para ver todo lo que puedo responder.');
  }

  /* ══════════════════════════ Interfaz ══════════════════════════ */

  var CSS = '' +
    '.ap-boton{position:fixed;right:18px;bottom:18px;z-index:9990;display:flex;align-items:center;gap:8px;border:0;cursor:pointer;' +
    'padding:13px 18px;border-radius:999px;background:linear-gradient(135deg,#850921,#b51234);color:#fff;font:800 13.5px system-ui,Segoe UI,Arial,sans-serif;' +
    'box-shadow:0 10px 26px rgba(133,9,33,.38)}.ap-boton:hover{transform:translateY(-2px)}' +
    '.ap-panel{position:fixed;right:18px;bottom:84px;z-index:9991;width:min(430px,calc(100vw - 24px));height:min(640px,calc(100vh - 110px));' +
    'display:none;flex-direction:column;background:var(--card,#fff);color:var(--text,#1d2429);border:1px solid var(--border,#dcdcdc);' +
    'border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.28);overflow:hidden;font:400 13.5px/1.55 system-ui,Segoe UI,Arial,sans-serif}' +
    '.ap-panel.abierto{display:flex}' +
    '.ap-cab{display:flex;align-items:center;gap:10px;padding:14px 16px;background:linear-gradient(135deg,#850921,#b51234);color:#fff}' +
    '.ap-cab b{font-size:14.5px}.ap-cab small{display:block;opacity:.85;font-size:11.5px}' +
    '.ap-cab button{margin-left:auto;border:0;background:rgba(255,255,255,.18);color:#fff;border-radius:9px;width:32px;height:32px;cursor:pointer;font-size:16px}' +
    '.ap-hilo{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--bg-subtle,#f5f6f7)}' +
    '.ap-msj{max-width:92%;padding:10px 13px;border-radius:14px;word-wrap:break-word}' +
    '.ap-msj.bot{align-self:flex-start;background:var(--card,#fff);border:1px solid var(--border,#e2e5e8);border-top-left-radius:4px}' +
    '.ap-msj.yo{align-self:flex-end;background:#b51234;color:#fff;border-top-right-radius:4px}' +
    '.ap-msj ul{margin:6px 0;padding-left:18px}.ap-msj p{margin:6px 0}' +
    '.ap-msj .ap-num{display:block;font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#b51234;margin-bottom:3px}' +
    '.ap-tabla{overflow:auto;margin:7px 0;border:1px solid var(--border,#e2e5e8);border-radius:9px}' +
    '.ap-tabla table{width:100%;border-collapse:collapse;font-size:12px}' +
    '.ap-tabla th{background:var(--bg-subtle,#f2f4f5);text-align:left;padding:6px 8px;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px}' +
    '.ap-tabla td{padding:6px 8px;border-top:1px solid var(--border,#eceff1)}' +
    '.ap-link{display:inline-block;margin-top:6px;font-weight:700;color:#b51234;text-decoration:none}.ap-link:hover{text-decoration:underline}' +
    '.ap-tag{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--bg-subtle,#eef0f2);font-size:11px;font-weight:700}' +
    '.ap-sug{display:flex;gap:6px;flex-wrap:wrap;padding:9px 12px 0;background:var(--card,#fff);border-top:1px solid var(--border,#e2e5e8)}' +
    '.ap-sug button{border:1px solid var(--border,#dcdcdc);background:var(--card,#fff);color:var(--text,#1d2429);border-radius:999px;' +
    'padding:5px 10px;font:600 11.5px system-ui,Arial;cursor:pointer}.ap-sug button:hover{border-color:#b51234;color:#b51234}' +
    '.ap-form{display:flex;gap:8px;padding:10px 12px 12px;background:var(--card,#fff)}' +
    '.ap-form textarea{flex:1;resize:none;height:44px;max-height:120px;padding:10px 12px;border:1px solid var(--border,#d9dde1);' +
    'border-radius:12px;font:500 13.5px system-ui,Arial;background:var(--card,#fff);color:var(--text,#1d2429)}' +
    '.ap-form button{border:0;background:#b51234;color:#fff;border-radius:12px;padding:0 16px;font:800 13px system-ui,Arial;cursor:pointer}' +
    '.ap-form button:disabled{opacity:.55;cursor:default}' +
    '.ap-pensando{display:inline-flex;gap:4px}.ap-pensando i{width:6px;height:6px;border-radius:50%;background:#b51234;animation:apb 1s infinite}' +
    '.ap-pensando i:nth-child(2){animation-delay:.15s}.ap-pensando i:nth-child(3){animation-delay:.3s}' +
    '@keyframes apb{0%,80%,100%{opacity:.25}40%{opacity:1}}' +
    '@media(max-width:560px){.ap-panel{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0}.ap-boton span{display:none}}' +
    '@media print{.ap-boton,.ap-panel{display:none!important}}';

  var SUGERENCIAS = [
    '¿Qué módulos hay?',
    '¿Cuántos electricistas hay en Río Cuarto? ¿Y técnicos en Villa María?',
    '¿Cuánto sale el peaje para autos? ¿Qué dice el Convenio 38?',
    '¿Cuántas antenas tiene Claro en Capital?',
    'Variación del IPC de enero 2025 a julio 2026'
  ];

  function montar() {
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    var boton = document.createElement('button');
    boton.className = 'ap-boton'; boton.type = 'button';
    boton.setAttribute('aria-label', 'Abrir el asistente del portal');
    boton.innerHTML = '💬 <span>Asistente</span>';

    var panelEl = document.createElement('section');
    panelEl.className = 'ap-panel'; panelEl.setAttribute('aria-label', 'Asistente del portal');
    panelEl.innerHTML =
      '<div class="ap-cab"><div><b>Asistente del Portal</b><small>Responde con los datos publicados · sin IA</small></div>' +
      '<button type="button" aria-label="Cerrar">✕</button></div>' +
      '<div class="ap-hilo" aria-live="polite"></div>' +
      '<div class="ap-sug">' + SUGERENCIAS.map(function (s) { return '<button type="button">' + esc(s) + '</button>'; }).join('') + '</div>' +
      '<form class="ap-form"><textarea placeholder="Escribí una o varias preguntas…" aria-label="Tu pregunta"></textarea>' +
      '<button type="submit">Enviar</button></form>';

    document.body.appendChild(boton);
    document.body.appendChild(panelEl);

    var hilo = panelEl.querySelector('.ap-hilo');
    var entrada = panelEl.querySelector('textarea');
    var enviar = panelEl.querySelector('.ap-form button');

    function mensaje(html, quien) {
      var d = document.createElement('div');
      d.className = 'ap-msj ' + quien;
      d.innerHTML = html;
      hilo.appendChild(d);
      hilo.scrollTop = hilo.scrollHeight;
      return d;
    }

    function preguntar(texto) {
      texto = String(texto || '').trim();
      if (!texto) return;
      mensaje(esc(texto), 'yo');
      entrada.value = '';
      enviar.disabled = true;

      var partes = separar(texto);
      var espera = mensaje('<span class="ap-pensando"><i></i><i></i><i></i></span>', 'bot');

      // Se responden en orden, cada una en su propia burbuja
      var cadena = Promise.resolve();
      partes.forEach(function (p, i) {
        cadena = cadena.then(function () {
          return responder(p).catch(function () {
            return 'No pude obtener ese dato ahora. Probá de nuevo en un momento.';
          }).then(function (html) {
            if (i === 0) espera.remove();
            mensaje((partes.length > 1 ? '<span class="ap-num">Pregunta ' + (i + 1) + ' · ' + esc(p) + '</span>' : '') + html, 'bot');
          });
        });
      });
      cadena.then(function () { enviar.disabled = false; entrada.focus(); });
    }

    boton.addEventListener('click', function () {
      panelEl.classList.toggle('abierto');
      if (panelEl.classList.contains('abierto')) {
        if (!hilo.children.length) {
          mensaje('¡Hola! Preguntame por los módulos, electricistas, antenas, peajes o índices estadísticos. ' +
            'Podés hacer <b>varias preguntas juntas</b>.', 'bot');
        }
        entrada.focus();
      }
    });
    panelEl.querySelector('.ap-cab button').addEventListener('click', function () { panelEl.classList.remove('abierto'); });
    panelEl.querySelector('.ap-form').addEventListener('submit', function (e) { e.preventDefault(); preguntar(entrada.value); });
    entrada.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); preguntar(entrada.value); }
    });
    panelEl.querySelector('.ap-sug').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (b) preguntar(b.textContent);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') panelEl.classList.remove('abierto'); });

    // Enlaces que activan el filtro de una gerencia en el propio portal
    hilo.addEventListener('click', function (e) {
      var a = e.target.closest('[data-ap-filtro]');
      if (!a) return;
      e.preventDefault();
      var f = document.querySelector('[data-service-filter="' + a.getAttribute('data-ap-filtro') + '"]');
      if (f) { panelEl.classList.remove('abierto'); f.click(); f.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });

    window.AsistentePortal = { preguntar: preguntar, responder: responder, separar: separar };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
