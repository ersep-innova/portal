(() => {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  let currentUser = null;
  let backendReady = false;
  let returnDeadline = null;
  let declaredTouched = false;
  let adminUsersCache = [];

  function toast(message, type = "") {
    const el = document.createElement("div");
    el.className = `perm-toast ${type}`;
    el.textContent = message;
    $("#toast_stack").appendChild(el);
    setTimeout(() => el.remove(), 4600);
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#039;",'"':"&quot;"}[c]));
  }

  function prettyState(state) {
    const map = {
      BORRADOR: "Borrador",
      PENDIENTE_JEFE: "Pendiente de Jefatura",
      PENDIENTE_RRHH: "Pendiente de RR.HH.",
      VERIFICADO_RRHH: "Aprobado por RR.HH.",
      RECHAZADO: "Rechazado (registro anterior)",
      RECHAZADO_JEFE: "Rechazado por Jefatura",
      RECHAZADO_RRHH: "Rechazado por RR.HH.",
      CANCELADO_AGENTE: "Cancelado"
    };
    return map[state] || state;
  }

  function badgeState(state) {
    let cls = "";
    if (state === "VERIFICADO_RRHH") cls = "green";
    else if (["PENDIENTE_JEFE", "PENDIENTE_RRHH", "BORRADOR"].includes(state)) cls = "yellow";
    else if (["RECHAZADO", "RECHAZADO_JEFE", "RECHAZADO_RRHH", "CANCELADO_AGENTE"].includes(state)) cls = "red";
    return `<span class="perm-badge ${cls}">${escapeHtml(prettyState(state))}</span>`;
  }

  function fmtDate(value) {
    if (!value) return "—";
    const [y, m, d] = value.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }

  function formatMinutes(minutes) {
    if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return "—";
    minutes = Number(minutes);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h && m) return `${h} h ${m} min`;
    if (h) return `${h} h`;
    return `${m} min`;
  }

  function minutesFromClock(value) {
    if (!value) return null;
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  }

  function minutesBetweenClock(start, end) {
    const a = minutesFromClock(start);
    const b = minutesFromClock(end);
    if (a === null || b === null) return null;
    return b - a;
  }

  function setConnection(state) {
    const el = $("#connection_state");
    el.className = `perm-connection ${state}`;
    const text = state === "online" ? "Sistema conectado" : state === "offline" ? "Servicio no disponible" : "Conectando…";
    el.innerHTML = `<span class="perm-dot"></span><span>${text}</span>`;
    const backend = $("#status_backend");
    if (backend) backend.textContent = state === "online" ? "● Render: conectado" : state === "offline" ? "● Render: sin conexión" : "○ Render: conectando";
  }

  function setView(name) {
    $$(".perm-view").forEach(v => v.classList.toggle("active", v.dataset.viewPanel === name));
    $$(".perm-nav button").forEach(b => b.classList.toggle("active", b.dataset.view === name));
    if (name === "mios") loadMyPermissions();
    if (name === "jefatura") loadBossQueue();
    if (name === "rrhh") loadRRHH();
    if (name === "admin") loadUsers();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applyRoles() {
    $$(".role-only").forEach(el => {
      const role = el.dataset.role;
      el.style.display = currentUser?.roles?.includes(role) ? "flex" : "none";
    });
  }

  function fillUser() {
    const fullName = [currentUser.nombre, currentUser.apellido].filter(Boolean).join(" ");
    $("#user_name").textContent = fullName || currentUser.email;
    $("#user_roles").textContent = currentUser.roles.join(" · ");
    $("#user_avatar").textContent = (currentUser.nombre?.[0] || currentUser.email[0]).toUpperCase();
    $("#dashboard_greeting").textContent = `Buen día, ${currentUser.nombre || ""}`.trim();
    $("#form_agente").value = fullName;
    $("#form_legajo").value = currentUser.legajo || "";
    $("#form_dni").value = currentUser.dni || "";
    $("#form_area").value = currentUser.area || "";
    $("#form_jornada").textContent = `${currentUser.jornada_desde || "08:00"} → ${currentUser.jornada_hasta || "14:00"}`;
  }

  async function loadDashboard() {
    try {
      const data = await PermisosAPI.request("/api/permisos/mios");
      const rows = data.items || [];
      $("#stat_mis_total").textContent = rows.length;
      $("#stat_mis_pendientes").textContent = rows.filter(x => ["BORRADOR", "PENDIENTE_JEFE", "PENDIENTE_RRHH"].includes(x.estado)).length;
      $("#stat_mis_aprobados").textContent = rows.filter(x => x.estado === "VERIFICADO_RRHH").length;
      const now = new Date();
      $("#stat_mis_mes").textContent = rows.filter(x => {
        const d = new Date(`${x.fecha_salida}T00:00:00`);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length;
      renderPermissionList($("#recent_permissions"), rows.slice(0, 5), { actions: false });
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderPermissionList(target, rows, options = {}) {
    if (!rows?.length) {
      target.innerHTML = '<div class="perm-empty"><strong>No hay registros.</strong><span>Cuando existan solicitudes aparecerán aquí.</span></div>';
      return;
    }

    target.innerHTML = `<div class="perm-table-wrap"><table class="perm-table perm-table-wide"><thead><tr>
      <th>Número</th><th>Fecha</th><th>Agente</th><th>Jornada</th><th>Salida</th><th>Tiempo</th><th>Estado</th><th></th>
    </tr></thead><tbody>${rows.map(p => {
      const agent = p.agente_nombre || [currentUser?.nombre, currentUser?.apellido].filter(Boolean).join(" ");
      const departure = `${p.hora_salida || "—"} → ${p.sin_regreso ? "Sin regreso" : (p.hora_regreso || "—")}`;
      const declared = p.minutos_declarados ?? p.minutos_autorizados;
      const auto = p.minutos_calculados;
      const diff = auto !== null && auto !== undefined && declared !== null && declared !== undefined && Number(auto) !== Number(declared);
      const outside = p.fuera_plazo_reglamentario;
      return `<tr class="${outside ? "perm-row-warning" : ""}">
        <td><strong>${escapeHtml(p.numero_permiso || `#${p.id}`)}</strong>${outside ? '<br><span class="perm-mini-warning">Fuera de plazo</span>' : ""}</td>
        <td>${fmtDate(p.fecha_salida)}</td>
        <td>${escapeHtml(agent || "—")}</td>
        <td>${escapeHtml(p.jornada_desde || "08:00")} → ${escapeHtml(p.jornada_hasta || "14:00")}</td>
        <td>${escapeHtml(departure)}</td>
        <td><strong>${formatMinutes(declared)}</strong>${diff ? `<br><small>Auto: ${formatMinutes(auto)}</small>` : ""}</td>
        <td>${badgeState(p.estado)}</td>
        <td class="perm-row-actions"><button data-detail="${p.id}">Ver</button>${options.bossActions && p.estado === "PENDIENTE_JEFE" ? ` <button data-authorize="${p.id}">Autorizar</button> <button class="danger-link" data-reject="${p.id}">Rechazar</button>` : ""}${options.rrhhActions && p.estado === "PENDIENTE_RRHH" ? ` <button data-verify="${p.id}">Aprobar</button> <button class="danger-link" data-reject-rrhh="${p.id}">Rechazar</button>` : ""}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;

    $$('[data-detail]', target).forEach(btn => btn.addEventListener('click', () => openDetail(btn.dataset.detail)));
    $$('[data-authorize]', target).forEach(btn => btn.addEventListener('click', () => authorizePermission(btn.dataset.authorize)));
    $$('[data-reject]', target).forEach(btn => btn.addEventListener('click', () => rejectPermission(btn.dataset.reject)));
    $$('[data-verify]', target).forEach(btn => btn.addEventListener('click', () => verifyPermission(btn.dataset.verify)));
    $$('[data-reject-rrhh]', target).forEach(btn => btn.addEventListener('click', () => rejectRRHHPermission(btn.dataset.rejectRrhh)));
  }

  async function loadMyPermissions() {
    try {
      const data = await PermisosAPI.request("/api/permisos/mios");
      renderPermissionList($("#my_permissions"), data.items || []);
    } catch (error) { toast(error.message, "error"); }
  }

  async function loadBossQueue() {
    try {
      const data = await PermisosAPI.request("/api/jefatura/pendientes");
      renderPermissionList($("#boss_permissions"), data.items || [], { bossActions: true });
    } catch (error) { toast(error.message, "error"); }
  }

  async function loadRRHH() {
    try {
      const params = new URLSearchParams();
      const estado = $("#rrhh_filter_estado").value;
      const tipo = $("#rrhh_filter_tipo").value;
      if (estado) params.set("estado", estado);
      if (tipo) params.set("tipo", tipo);
      const [data, dashboard] = await Promise.all([
        PermisosAPI.request(`/api/rrhh/permisos?${params}`),
        PermisosAPI.request("/api/rrhh/dashboard")
      ]);
      renderPermissionList($("#rrhh_permissions"), data.items || [], { rrhhActions: true });
      $("#rrhh_total_mes").textContent = dashboard.total_mes ?? 0;
      $("#rrhh_pendientes").textContent = dashboard.pendientes_rrhh ?? 0;
      $("#rrhh_particulares").textContent = dashboard.particulares_mes ?? 0;
      $("#rrhh_minutos").textContent = dashboard.minutos_particulares_mes ?? 0;
    } catch (error) { toast(error.message, "error"); }
  }

  async function openDetail(id) {
    try {
      const p = await PermisosAPI.request(`/api/permisos/${id}`);
      const declared = p.minutos_declarados ?? p.minutos_autorizados;
      const calculated = p.minutos_calculados;
      const modal = $("#modal_root");
      modal.innerHTML = `<div class="perm-modal-backdrop" id="detail_backdrop"><div class="perm-modal perm-modal-large">
        <div class="perm-modal-header"><div><h3>${escapeHtml(p.numero_permiso || `#${p.id}`)}</h3><small>${badgeState(p.estado)}</small></div><button class="perm-modal-close" id="detail_close">×</button></div>
        <div class="perm-card-body">
          ${p.fuera_plazo_reglamentario ? `<div class="perm-alert warning"><strong>Devolución fuera del plazo reglamentario sugerido.</strong><span>Fecha límite: ${fmtDate(p.fecha_limite_devolucion)}. RR.HH. debe considerar la justificación informada.</span></div>` : ""}
          <div class="perm-detail-grid">
            <div><strong>Agente</strong><p>${escapeHtml(p.agente_nombre || "—")} · Legajo ${escapeHtml(p.legajo || "—")}</p></div>
            <div><strong>Área</strong><p>${escapeHtml(p.area || "—")}</p></div>
            <div><strong>Jornada aplicada</strong><p>${escapeHtml(p.jornada_desde || "08:00")} → ${escapeHtml(p.jornada_hasta || "14:00")}</p></div>
            <div><strong>Tipo</strong><p>${escapeHtml(p.tipo)}</p></div>
            <div><strong>Fecha</strong><p>${fmtDate(p.fecha_salida)}</p></div>
            <div><strong>Salida</strong><p>${escapeHtml(p.hora_salida || "—")} → ${p.sin_regreso ? "Sin regreso" : escapeHtml(p.hora_regreso || "—")}</p></div>
            <div><strong>Cálculo automático</strong><p>${formatMinutes(calculated)}</p></div>
            <div><strong>Tiempo declarado</strong><p>${formatMinutes(declared)}</p></div>
            <div><strong>Destino</strong><p>${escapeHtml(p.lugar_destino || "—")}</p></div>
            <div><strong>Jefatura</strong><p>${escapeHtml(p.jefe_nombre || "—")}</p></div>
          </div>
          ${p.justificacion_minutos ? `<div class="perm-detail-note"><strong>Justificación de diferencia de tiempo</strong><p>${escapeHtml(p.justificacion_minutos)}</p></div>` : ""}
          ${p.tipo === "PARTICULAR" ? `<div class="perm-detail-note"><strong>Reposición propuesta</strong><p>${fmtDate(p.reposicion_fecha_prevista || p.fecha_devolucion)} · ${escapeHtml(p.reposicion_hora_desde || "—")} → ${escapeHtml(p.reposicion_hora_hasta || "—")} · ${formatMinutes(p.reposicion_minutos ?? declared)}</p>${p.fecha_limite_devolucion ? `<small>Plazo sugerido: hasta ${fmtDate(p.fecha_limite_devolucion)}</small>` : ""}</div>` : ""}
          ${p.justificacion_fuera_plazo ? `<div class="perm-detail-note warning-note"><strong>Observación por devolución fuera de término</strong><p>${escapeHtml(p.justificacion_fuera_plazo)}</p></div>` : ""}
          <div class="perm-detail-note"><strong>Observaciones generales</strong><p>${escapeHtml(p.observaciones || "—")}</p></div>
          <hr class="perm-divider">
          <h4>Trazabilidad</h4>
          <div class="perm-timeline">${(p.historial || []).map(h => `<div class="perm-timeline-item"><div class="perm-timeline-dot"></div><div><strong>${escapeHtml(h.evento)}</strong><span>${escapeHtml(h.usuario_nombre || "Sistema")} · ${new Date(h.fecha_hora).toLocaleString("es-AR")}${h.detalle ? ` · ${escapeHtml(h.detalle)}` : ""}</span></div></div>`).join("") || '<div class="perm-empty">Sin historial.</div>'}</div>
        </div></div></div>`;
      $("#detail_close").onclick = () => modal.innerHTML = "";
      $("#detail_backdrop").addEventListener("click", e => { if (e.target.id === "detail_backdrop") modal.innerHTML = ""; });
    } catch (error) { toast(error.message, "error"); }
  }

  async function authorizePermission(id) {
    const observation = prompt("Observación de autorización (opcional):", "") ?? null;
    if (observation === null) return;
    try {
      await PermisosAPI.request(`/api/permisos/${id}/autorizar`, { method: "POST", body: JSON.stringify({ observacion: observation }) });
      toast("Permiso autorizado y enviado a RR.HH.", "success");
      loadBossQueue();
    } catch (error) { toast(error.message, "error"); }
  }

  async function rejectPermission(id) {
    const reason = prompt("Motivo del rechazo (obligatorio):", "");
    if (!reason?.trim()) return;
    try {
      await PermisosAPI.request(`/api/permisos/${id}/rechazar`, { method: "POST", body: JSON.stringify({ observacion: reason.trim() }) });
      toast("Solicitud rechazada por Jefatura.", "success");
      loadBossQueue();
    } catch (error) { toast(error.message, "error"); }
  }

  async function verifyPermission(id) {
    const obs = prompt("Observación de RR.HH. (opcional):", "") ?? null;
    if (obs === null) return;
    try {
      await PermisosAPI.request(`/api/permisos/${id}/verificar-rrhh`, { method: "POST", body: JSON.stringify({ observacion: obs }) });
      toast("Permiso aprobado por RR.HH.", "success");
      loadRRHH();
    } catch (error) { toast(error.message, "error"); }
  }

  async function rejectRRHHPermission(id) {
    const reason = prompt("Motivo del rechazo de RR.HH. (obligatorio):", "");
    if (!reason?.trim()) {
      if (reason !== null) toast("Para rechazar, RR.HH. debe informar un motivo.", "error");
      return;
    }
    try {
      await PermisosAPI.request(`/api/permisos/${id}/rechazar-rrhh`, { method: "POST", body: JSON.stringify({ observacion: reason.trim() }) });
      toast("Solicitud rechazada por RR.HH.", "success");
      loadRRHH();
    } catch (error) { toast(error.message, "error"); }
  }

  function selectedType() {
    return $('input[name="tipo"]:checked')?.value || "";
  }

  function updateFormRules() {
    const type = selectedType();
    const official = type === "OFICIAL";
    const privateOut = type === "PARTICULAR";
    $("#field_destino").hidden = !official;
    $("#form_destino").required = official;
    $("#private_return_block").hidden = !privateOut;
    $("#form_fecha_devolucion").required = privateOut;
    $("#form_devolucion_desde").required = privateOut;
    $("#form_devolucion_hasta").required = privateOut;
    if (privateOut) loadReturnDeadline();
    else {
      returnDeadline = null;
      $("#deadline_warning").hidden = true;
      $("#field_deadline_reason").hidden = true;
      $("#form_justificacion_fuera_plazo").required = false;
    }
  }

  function updateReturnRules() {
    const noReturn = $("#form_regreso_tipo").value === "SIN_REGRESO";
    $("#field_hora_regreso").hidden = noReturn;
    $("#form_hora_regreso").required = !noReturn;
    $("#form_duracion_help").textContent = noReturn
      ? `Sin regreso: fin de jornada (${currentUser?.jornada_hasta || "14:00"}) menos hora de salida.`
      : "Con regreso: hora de regreso menos hora de salida.";
    calculateDuration();
  }

  function autoMinutes() {
    const start = $("#form_hora_salida").value;
    if (!start) return null;
    const noReturn = $("#form_regreso_tipo").value === "SIN_REGRESO";
    const end = noReturn ? (currentUser?.jornada_hasta || "14:00") : $("#form_hora_regreso").value;
    if (!end) return null;
    const mins = minutesBetweenClock(start, end);
    if (noReturn) return Math.max(0, mins);
    return mins > 0 ? mins : null;
  }

  function setDeclaredMinutes(total) {
    total = Math.max(0, Number(total) || 0);
    $("#form_tiempo_horas").value = Math.floor(total / 60);
    $("#form_tiempo_minutos").value = total % 60;
  }

  function declaredMinutes() {
    const h = Math.max(0, Number($("#form_tiempo_horas").value || 0));
    const m = Math.min(59, Math.max(0, Number($("#form_tiempo_minutos").value || 0)));
    return h * 60 + m;
  }

  function updateTimeDifference() {
    const auto = autoMinutes();
    if (auto === null) {
      $("#time_difference_warning").hidden = true;
      $("#field_time_reason").hidden = true;
      $("#form_justificacion_minutos").required = false;
      return;
    }
    const diff = declaredMinutes() !== auto;
    $("#time_difference_warning").hidden = !diff;
    $("#field_time_reason").hidden = !diff;
    $("#form_justificacion_minutos").required = diff;
  }

  function calculateDuration() {
    const auto = autoMinutes();
    if (auto === null) {
      $("#form_duracion").textContent = $("#form_hora_salida").value ? "Horario inválido o incompleto" : "—";
      updateTimeDifference();
      return;
    }
    $("#form_duracion").textContent = formatMinutes(auto);
    if (!declaredTouched) setDeclaredMinutes(auto);
    updateTimeDifference();
  }

  function calculateReturnDuration() {
    const start = $("#form_devolucion_desde").value;
    const end = $("#form_devolucion_hasta").value;
    if (!start || !end) {
      $("#return_duration").textContent = "—";
      return;
    }
    const mins = minutesBetweenClock(start, end);
    if (mins <= 0) {
      $("#return_duration").textContent = "Horario inválido";
      return;
    }
    const declared = declaredMinutes();
    $("#return_duration").textContent = `${formatMinutes(mins)}${mins !== declared ? ` · declarado: ${formatMinutes(declared)}` : ""}`;
  }

  async function loadReturnDeadline() {
    if (selectedType() !== "PARTICULAR") return;
    const date = $("#form_fecha").value;
    if (!date) {
      returnDeadline = null;
      $("#return_deadline").textContent = "Seleccioná la fecha de salida";
      return;
    }
    try {
      const data = await PermisosAPI.request(`/api/reglas/plazo-devolucion?fecha_salida=${encodeURIComponent(date)}`);
      returnDeadline = data.fecha_limite;
      $("#return_deadline").textContent = `Hasta ${fmtDate(returnDeadline)} (7 días hábiles)`;
      updateDeadlineWarning();
    } catch (error) {
      returnDeadline = null;
      $("#return_deadline").textContent = "No fue posible calcular el plazo";
    }
  }

  function updateDeadlineWarning() {
    const selected = $("#form_fecha_devolucion").value;
    const outside = !!(selected && returnDeadline && selected > returnDeadline);
    $("#deadline_warning").hidden = !outside;
    $("#field_deadline_reason").hidden = !outside;
    $("#form_justificacion_fuera_plazo").required = outside;
  }

  function formPayload() {
    return {
      tipo: selectedType(),
      fecha_salida: $("#form_fecha").value,
      lugar_destino: $("#form_destino").value.trim() || null,
      hora_salida: $("#form_hora_salida").value,
      hora_regreso: $("#form_regreso_tipo").value === "SIN_REGRESO" ? null : $("#form_hora_regreso").value,
      sin_regreso: $("#form_regreso_tipo").value === "SIN_REGRESO",
      minutos_declarados: declaredMinutes(),
      justificacion_minutos: $("#form_justificacion_minutos").value.trim() || null,
      fecha_devolucion: selectedType() === "PARTICULAR" ? $("#form_fecha_devolucion").value || null : null,
      devolucion_hora_desde: selectedType() === "PARTICULAR" ? $("#form_devolucion_desde").value || null : null,
      devolucion_hora_hasta: selectedType() === "PARTICULAR" ? $("#form_devolucion_hasta").value || null : null,
      justificacion_fuera_plazo: $("#form_justificacion_fuera_plazo").value.trim() || null,
      observaciones: $("#form_observaciones").value.trim() || null
    };
  }

  function resetPermissionForm() {
    const form = $("#permission_form");
    form.reset();
    declaredTouched = false;
    returnDeadline = null;
    $("#form_fecha").valueAsDate = new Date();
    $("#form_tiempo_horas").value = 0;
    $("#form_tiempo_minutos").value = 0;
    $("#return_deadline").textContent = "Seleccioná una salida particular";
    $("#return_duration").textContent = "—";
    updateFormRules();
    updateReturnRules();
    updateTimeDifference();
    updateDeadlineWarning();
  }

  async function createPermission(sendNow) {
    const form = $("#permission_form");
    calculateDuration();
    calculateReturnDuration();
    updateDeadlineWarning();
    if (!form.reportValidity()) return;
    try {
      const created = await PermisosAPI.request("/api/permisos", { method: "POST", body: JSON.stringify(formPayload()) });
      if (sendNow) {
        await PermisosAPI.request(`/api/permisos/${created.id}/enviar`, { method: "POST" });
        toast(`${created.numero_permiso} enviado a autorización.`, "success");
      } else {
        toast(`${created.numero_permiso} guardado como borrador.`, "success");
      }
      resetPermissionForm();
      setView("mios");
      loadDashboard();
    } catch (error) { toast(error.message, "error"); }
  }

  function clearAdminForm() {
    const form = $("#admin_user_form");
    form.reset();
    $("#admin_jornada_desde").value = "08:00";
    $("#admin_jornada_hasta").value = "14:00";
    const agentRole = $('input[name="admin_role"][value="AGENTE"]');
    if (agentRole) agentRole.checked = true;
  }

  function editAdminUser(id) {
    const u = adminUsersCache.find(x => Number(x.id) === Number(id));
    if (!u) return;
    $("#admin_email").value = u.email || "";
    $("#admin_nombre").value = u.nombre || "";
    $("#admin_apellido").value = u.apellido || "";
    $("#admin_legajo").value = u.legajo || "";
    $("#admin_dni").value = u.dni || "";
    $("#admin_area").value = u.area || "";
    $("#admin_jornada_desde").value = u.jornada_desde || "08:00";
    $("#admin_jornada_hasta").value = u.jornada_hasta || "14:00";
    $("#admin_jefe_email").value = u.jefe_email || "";
    $$('input[name="admin_role"]').forEach(cb => cb.checked = (u.roles || []).includes(cb.value));
    $("#admin_user_form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function changeUserStatus(id, active) {
    const u = adminUsersCache.find(x => Number(x.id) === Number(id));
    if (!u) return;
    const action = active ? "reactivar" : "quitar el acceso a";
    if (!confirm(`¿Querés ${action} ${u.nombre || ""} ${u.apellido || ""}?\n\nEl historial de permisos no se eliminará.`)) return;
    try {
      await PermisosAPI.request(`/api/admin/usuarios/${id}/estado`, { method: "POST", body: JSON.stringify({ activo: active }) });
      toast(active ? "Usuario reactivado." : "Acceso del usuario deshabilitado.", "success");
      loadUsers();
    } catch (error) { toast(error.message, "error"); }
  }

  async function loadUsers() {
    try {
      const data = await PermisosAPI.request("/api/admin/usuarios");
      const rows = data.items || [];
      adminUsersCache = rows;
      const target = $("#admin_users");
      if (!rows.length) {
        target.innerHTML = '<div class="perm-empty">No hay usuarios.</div>';
        return;
      }
      target.innerHTML = `<div class="perm-table-wrap"><table class="perm-table perm-table-wide"><thead><tr><th>Usuario</th><th>Estado</th><th>Jornada</th><th>Roles</th><th>Jefe</th><th></th></tr></thead><tbody>${rows.map(u => `<tr class="${u.activo ? "" : "perm-row-disabled"}">
        <td><strong>${escapeHtml(`${u.nombre || ""} ${u.apellido || ""}`.trim())}</strong><br><small>${escapeHtml(u.email)}</small><br><small>Legajo ${escapeHtml(u.legajo || "—")}</small></td>
        <td>${u.activo ? '<span class="perm-badge green">Activo</span>' : '<span class="perm-badge red">Sin acceso</span>'}</td>
        <td>${escapeHtml(u.jornada_desde || "08:00")} → ${escapeHtml(u.jornada_hasta || "14:00")}</td>
        <td>${escapeHtml((u.roles || []).join(", "))}</td>
        <td>${escapeHtml(u.jefe_nombre || "—")}</td>
        <td class="perm-row-actions"><button data-edit-user="${u.id}">Editar</button>${u.activo ? `<button class="danger-link" data-disable-user="${u.id}">Quitar acceso</button>` : `<button data-enable-user="${u.id}">Reactivar</button>`}</td>
      </tr>`).join("")}</tbody></table></div>`;
      $$('[data-edit-user]', target).forEach(btn => btn.addEventListener('click', () => editAdminUser(btn.dataset.editUser)));
      $$('[data-disable-user]', target).forEach(btn => btn.addEventListener('click', () => changeUserStatus(btn.dataset.disableUser, false)));
      $$('[data-enable-user]', target).forEach(btn => btn.addEventListener('click', () => changeUserStatus(btn.dataset.enableUser, true)));
    } catch (error) { toast(error.message, "error"); }
  }

  async function loadSheetsStatus() {
    if (!currentUser || !(currentUser.roles.includes("RRHH") || currentUser.roles.includes("ADMIN"))) return;
    try {
      const status = await PermisosAPI.request("/api/sheets/status");
      const label = $("#status_sheets");
      const link = $("#rrhh_sheet_link");
      const connect = $("#connect_sheets_btn");
      const sync = $("#sync_sheets_btn");
      const disconnect = $("#disconnect_sheets_btn");

      if (!status.base_configured) {
        label.textContent = "○ Google Sheets: falta configuración en Render";
        connect.hidden = true;
        sync.hidden = true;
        disconnect.hidden = true;
        link.hidden = true;
        return;
      }

      if (status.authorized && status.enabled) {
        label.textContent = status.authorized_email
          ? `● Google Sheets: conectado · ${status.authorized_email}`
          : "● Google Sheets: conectado";
        connect.hidden = true;
        sync.hidden = false;
        disconnect.hidden = false;
        if (status.sheet_url) {
          link.href = status.sheet_url;
          link.hidden = false;
        }
      } else {
        label.textContent = "○ Google Sheets: cuenta Google no conectada";
        connect.hidden = false;
        sync.hidden = true;
        disconnect.hidden = true;
        link.hidden = true;
      }
    } catch (_) {
      $("#status_sheets").textContent = "○ Google Sheets: sin verificar";
    }
  }

  async function connectSheets() {
    try {
      const result = await PermisosAPI.request("/api/sheets/connect", { method: "POST" });
      if (!result.authorization_url) throw new Error("El backend no devolvió la URL de autorización.");
      window.location.assign(result.authorization_url);
    } catch (error) { toast(error.message, "error"); }
  }

  async function disconnectSheets() {
    if (!confirm("¿Desconectar la cuenta Google utilizada para sincronizar RR.HH.?")) return;
    try {
      const result = await PermisosAPI.request("/api/sheets/disconnect", { method: "POST" });
      toast(result.message || "Google Sheets desconectado.", "success");
      await loadSheetsStatus();
    } catch (error) { toast(error.message, "error"); }
  }

  async function syncSheets() {
    try {
      const result = await PermisosAPI.request("/api/sheets/sync", { method: "POST" });
      toast(result.message || "Sincronización finalizada.", result.status === "ok" ? "success" : "");
      await loadSheetsStatus();
    } catch (error) { toast(error.message, "error"); }
  }

  function bindEvents() {
    $$("[data-view]").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
    $$("[data-go]").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.go)));
    $("#logout_btn").addEventListener("click", () => PermisosAuth.logout(true));
    $$('input[name="tipo"]').forEach(el => el.addEventListener("change", updateFormRules));
    $("#form_regreso_tipo").addEventListener("change", updateReturnRules);
    $("#form_hora_salida").addEventListener("input", calculateDuration);
    $("#form_hora_regreso").addEventListener("input", calculateDuration);
    $("#form_fecha").addEventListener("change", loadReturnDeadline);
    $("#form_fecha_devolucion").addEventListener("change", updateDeadlineWarning);
    $("#form_devolucion_desde").addEventListener("input", calculateReturnDuration);
    $("#form_devolucion_hasta").addEventListener("input", calculateReturnDuration);
    $("#form_tiempo_horas").addEventListener("input", () => { declaredTouched = true; updateTimeDifference(); calculateReturnDuration(); });
    $("#form_tiempo_minutos").addEventListener("input", () => { declaredTouched = true; updateTimeDifference(); calculateReturnDuration(); });
    $("#use_auto_time").addEventListener("click", () => {
      const auto = autoMinutes();
      if (auto === null) return toast("Primero completá el horario de salida/regreso.", "error");
      declaredTouched = false;
      setDeclaredMinutes(auto);
      $("#form_justificacion_minutos").value = "";
      updateTimeDifference();
      calculateReturnDuration();
    });
    $("#permission_form").addEventListener("submit", e => { e.preventDefault(); createPermission(true); });
    $("#save_draft_btn").addEventListener("click", () => createPermission(false));
    $("#refresh_jefatura").addEventListener("click", loadBossQueue);
    $("#refresh_rrhh").addEventListener("click", loadRRHH);
    $("#rrhh_filter_estado").addEventListener("change", loadRRHH);
    $("#rrhh_filter_tipo").addEventListener("change", loadRRHH);
    $("#connect_sheets_btn").addEventListener("click", connectSheets);
    $("#sync_sheets_btn").addEventListener("click", syncSheets);
    $("#disconnect_sheets_btn").addEventListener("click", disconnectSheets);
    $("#refresh_users").addEventListener("click", loadUsers);
    $("#admin_clear_form").addEventListener("click", clearAdminForm);
    $("#admin_user_form").addEventListener("submit", async e => {
      e.preventDefault();
      const roles = $$('input[name="admin_role"]:checked').map(x => x.value);
      try {
        await PermisosAPI.request("/api/admin/usuarios", { method: "POST", body: JSON.stringify({
          email: $("#admin_email").value.trim(),
          nombre: $("#admin_nombre").value.trim(),
          apellido: $("#admin_apellido").value.trim(),
          legajo: $("#admin_legajo").value.trim(),
          dni: $("#admin_dni").value.trim() || null,
          area: $("#admin_area").value.trim() || null,
          jornada_desde: $("#admin_jornada_desde").value || "08:00",
          jornada_hasta: $("#admin_jornada_hasta").value || "14:00",
          roles,
          jefe_email: $("#admin_jefe_email").value.trim() || null
        }) });
        toast("Usuario guardado.", "success");
        clearAdminForm();
        loadUsers();
      } catch (error) { toast(error.message, "error"); }
    });
  }

  async function onAuthenticated(user) {
    currentUser = user;
    $("#login_screen").hidden = true;
    $("#app_sidebar").hidden = false;
    $("#app_content").hidden = false;
    $("#user_widget").hidden = false;
    fillUser();
    applyRoles();
    resetPermissionForm();
    await loadDashboard();
    await loadSheetsStatus();
  }

  function onLoggedOut() {
    currentUser = null;
    $("#login_screen").hidden = false;
    $("#app_sidebar").hidden = true;
    $("#app_content").hidden = true;
    $("#user_widget").hidden = true;
    PermisosAuth.renderGoogleButton();
  }

  async function init() {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("sheets") === "connected") {
      setTimeout(() => toast("Google Sheets quedó conectado correctamente.", "success"), 300);
      history.replaceState({}, document.title, window.location.pathname);
    } else if (qs.get("sheets") === "error") {
      const msg = qs.get("message") || "No se pudo conectar Google Sheets.";
      setTimeout(() => toast(`Google Sheets: ${msg}`, "error"), 300);
      history.replaceState({}, document.title, window.location.pathname);
    }
    bindEvents();
    updateFormRules();
    updateReturnRules();
    window.addEventListener("permisos:error", e => toast(e.detail, "error"));
    window.addEventListener("permisos:auth", e => e.detail ? onAuthenticated(e.detail) : onLoggedOut());

    backendReady = await PermisosAPI.wakeBackend(state => setConnection(state));
    $("#status_database").textContent = backendReady ? "● PostgreSQL: backend disponible" : "○ PostgreSQL: sin verificar";

    if (PermisosAPI.getToken() && backendReady) {
      try { await PermisosAuth.loadMe(); return; } catch (_) {}
    }
    PermisosAuth.renderGoogleButton();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
