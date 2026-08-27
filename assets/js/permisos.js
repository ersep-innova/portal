(() => {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const RRHH_EMAIL = "ersep.capacitaciones@gmail.com";

  let currentUser = null;
  let returnDeadline = null;
  let declaredTouched = false;
  let adminUsersCache = [];
  let officesCache = [];

  function toast(message, type = "") {
    const el = document.createElement("div");
    el.className = `perm-toast ${type}`;
    el.textContent = message;
    $("#toast_stack")?.appendChild(el);
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
      VERIFICADO_RRHH: "Verificado por RR.HH.",
      RECHAZADO: "Rechazado",
      RECHAZADO_JEFE: "Rechazado por Jefatura",
      RECHAZADO_RRHH: "Rechazado por RR.HH.",
      CANCELADO_AGENTE: "Cancelado"
    };
    return map[state] || state || "—";
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
    const raw = String(value).slice(0, 10);
    const [y, m, d] = raw.split("-");
    return y && m && d ? `${d}/${m}/${y}` : raw;
  }

  function formatMinutes(minutes) {
    if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return "—";
    const total = Number(minutes);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h && m) return `${h} h ${m} min`;
    if (h) return `${h} h`;
    return `${m} min`;
  }

  function minutesFromClock(value) {
    if (!value) return null;
    const [h, m] = String(value).split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  }

  function minutesBetweenClock(start, end) {
    const a = minutesFromClock(start);
    const b = minutesFromClock(end);
    if (a === null || b === null) return null;
    return b - a;
  }

  async function copyRRHHEmail(button) {
    try {
      await navigator.clipboard.writeText(RRHH_EMAIL);
      const old = button?.textContent;
      if (button) button.textContent = "✓ Email copiado";
      toast("Email de RR.HH. copiado al portapapeles.", "success");
      if (button) setTimeout(() => button.textContent = old, 1600);
    } catch (_) {
      const input = document.createElement("input");
      input.value = RRHH_EMAIL;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      toast("Email de RR.HH. copiado al portapapeles.", "success");
    }
  }

  function setView(name) {
    $$(".perm-view").forEach(v => v.classList.toggle("active", v.dataset.viewPanel === name));
    $$(".perm-nav button").forEach(b => b.classList.toggle("active", b.dataset.view === name));
    if (name === "mios") loadMyPermissions();
    if (name === "jefatura") loadBossPanel();
    if (name === "rrhh") loadRRHH();
    if (name === "admin") loadAdmin();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applyRoles() {
    const isAdmin = currentUser?.roles?.includes("ADMIN");
    $$(".role-only").forEach(el => {
      el.style.display = (isAdmin || currentUser?.roles?.includes(el.dataset.role)) ? "flex" : "none";
    });
  }

  function fillUser() {
    if (!currentUser) return;
    const fullName = [currentUser.nombre, currentUser.apellido].filter(Boolean).join(" ");
    if ($("#user_name")) $("#user_name").textContent = fullName || currentUser.email;
    if ($("#user_roles")) $("#user_roles").textContent = (currentUser.roles || []).join(" · ");
    if ($("#user_avatar")) $("#user_avatar").textContent = (currentUser.nombre?.[0] || currentUser.email?.[0] || "U").toUpperCase();
    if ($("#dashboard_greeting")) $("#dashboard_greeting").textContent = `Buen día, ${currentUser.nombre || ""}`.trim();

    // Importante: se ejecuta también después de cada form.reset().
    if ($("#form_agente")) $("#form_agente").value = fullName;
    if ($("#form_legajo")) $("#form_legajo").value = currentUser.legajo || "";
    if ($("#form_dni")) $("#form_dni").value = currentUser.dni || "";
    if ($("#form_oficina")) $("#form_oficina").value = currentUser.oficina || currentUser.area || "Sin Oficina configurada";
    if ($("#form_jefatura")) $("#form_jefatura").value = currentUser.jefe_nombre || "Sin jefatura configurada";
    if ($("#form_jornada")) $("#form_jornada").textContent = `${currentUser.jornada_desde || "08:00"} → ${currentUser.jornada_hasta || "14:00"}`;
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
      renderPermissionList($("#recent_permissions"), rows.slice(0, 5), { compact: true });
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function compensationText(p) {
    if (p.tipo !== "PARTICULAR") return "No corresponde";
    const mode = p.reposicion_modalidad || p.modalidad_compensacion || "DEVOLVER_HORAS";
    if (mode === "HORAS_EXTRAS_PREVIAS") {
      return `Horas extra previas · ${fmtDate(p.fecha_horas_extra)} · ${p.hora_desde_horas_extra || "—"} → ${p.hora_hasta_horas_extra || "—"}`;
    }
    return `Devuelve · ${fmtDate(p.reposicion_fecha_prevista || p.fecha_devolucion)} · ${p.reposicion_hora_desde || "—"} → ${p.reposicion_hora_hasta || "—"}`;
  }

  function riskMarkup(p) {
    const risks = p.riesgos || [];
    if (!risks.length) return '<span class="perm-badge green">Sin alertas</span>';
    if (p.riesgo_critico) return `<span class="perm-critical-flag">Revisión crítica</span><br><small>${escapeHtml(risks[0]?.mensaje || "Revisar")}</small>`;
    return `<span class="perm-badge yellow">Atención</span><br><small>${escapeHtml(risks[0]?.mensaje || "Revisar")}</small>`;
  }

  function renderPermissionList(target, rows, options = {}) {
    if (!target) return;
    if (!rows?.length) {
      target.innerHTML = '<div class="perm-empty"><strong>No hay registros para mostrar.</strong><span>Probá cambiar los filtros o creá una nueva solicitud.</span></div>';
      return;
    }

    target.innerHTML = `<div class="perm-table-wrap"><table class="perm-table perm-table-wide"><thead><tr>
      <th>Número</th><th>Fecha</th><th>Agente</th><th>Oficina</th><th>Salida</th><th>Tiempo</th><th>Compensación</th><th>Estado</th><th>Control</th><th></th>
    </tr></thead><tbody>${rows.map(p => {
      const agent = p.agente_nombre || [currentUser?.nombre, currentUser?.apellido].filter(Boolean).join(" ");
      const departure = `${p.hora_salida || "—"} → ${p.sin_regreso ? "Sin regreso" : (p.hora_regreso || "—")}`;
      const declared = p.minutos_declarados ?? p.minutos_autorizados;
      const auto = p.minutos_calculados;
      const diff = auto !== null && auto !== undefined && declared !== null && declared !== undefined && Number(auto) !== Number(declared);
      const rowClass = p.riesgo_critico ? "perm-row-critical" : (p.fuera_plazo_reglamentario ? "perm-row-warning" : "");
      return `<tr class="${rowClass}">
        <td><strong>${escapeHtml(p.numero_permiso || `#${p.id}`)}</strong>${p.riesgo_critico ? '<br><span class="perm-critical-flag">Crítico</span>' : (p.fuera_plazo_reglamentario ? '<br><span class="perm-mini-warning">Fuera de plazo</span>' : '')}</td>
        <td>${fmtDate(p.fecha_salida)}</td>
        <td><strong>${escapeHtml(agent || "—")}</strong>${p.legajo ? `<br><small>Legajo ${escapeHtml(p.legajo)}</small>` : ""}</td>
        <td>${escapeHtml(p.oficina || currentUser?.oficina || "—")}</td>
        <td>${escapeHtml(departure)}</td>
        <td><strong>${formatMinutes(declared)}</strong>${diff ? `<br><small>Sistema: ${formatMinutes(auto)}</small>` : ""}</td>
        <td>${escapeHtml(compensationText(p))}</td>
        <td>${badgeState(p.estado)}${p.decision_jefatura ? `<br><small>Jefatura: ${p.decision_jefatura === "APROBADO" ? "Autorizado" : "Rechazado"}</small>` : ""}</td>
        <td>${riskMarkup(p)}</td>
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

  function paramsFrom(prefix) {
    const params = new URLSearchParams();
    const fields = ["estado", "tipo", "agente", "desde", "hasta"];
    fields.forEach(name => {
      const el = $(`#${prefix}_${name}`);
      if (!el?.value) return;
      const key = name === "desde" ? "fecha_desde" : name === "hasta" ? "fecha_hasta" : name;
      params.set(key, el.value.trim());
    });
    return params;
  }

  function renderBars(target, rows) {
    if (!target) return;
    if (!rows?.length) {
      target.innerHTML = '<div class="perm-empty">Sin datos para este filtro.</div>';
      return;
    }
    const max = Math.max(...rows.map(x => Number(x.valor || 0)), 1);
    target.innerHTML = `<div class="perm-bar-list">${rows.map(x => `<div class="perm-bar-row">
      <div class="perm-bar-label" title="${escapeHtml(x.label)}">${escapeHtml(x.label)}</div>
      <div class="perm-bar-track"><div class="perm-bar-fill" style="width:${Math.max(3, (Number(x.valor || 0) / max) * 100)}%"></div></div>
      <div class="perm-bar-value">${Number(x.valor || 0)}</div>
    </div>`).join("")}</div>`;
  }

  async function loadBossPanel() {
    try {
      const params = paramsFrom("boss_filter");
      const query = params.toString();
      const [data, dashboard] = await Promise.all([
        PermisosAPI.request(`/api/jefatura/permisos${query ? `?${query}` : ""}`),
        PermisosAPI.request(`/api/jefatura/dashboard${query ? `?${query}` : ""}`)
      ]);
      renderPermissionList($("#boss_permissions"), data.items || [], { bossActions: true });
      $("#boss_stat_total").textContent = dashboard.total ?? 0;
      $("#boss_stat_pending").textContent = dashboard.pendientes ?? 0;
      $("#boss_stat_approved").textContent = dashboard.autorizados ?? 0;
      $("#boss_stat_rejected").textContent = dashboard.rechazados ?? 0;
      $("#boss_stat_critical").textContent = dashboard.criticos ?? 0;
      renderBars($("#boss_chart_agents"), dashboard.por_agente || []);
      renderBars($("#boss_chart_hours"), dashboard.por_hora || []);
    } catch (error) { toast(error.message, "error"); }
  }

  function rrhhParams() {
    const params = paramsFrom("rrhh_filter");
    const office = $("#rrhh_filter_oficina")?.value;
    if (office) params.set("oficina_id", office);
    return params;
  }

  async function loadRRHH() {
    try {
      const params = rrhhParams();
      const query = params.toString();
      const [data, dashboard] = await Promise.all([
        PermisosAPI.request(`/api/rrhh/permisos${query ? `?${query}` : ""}`),
        PermisosAPI.request(`/api/rrhh/dashboard${query ? `?${query}` : ""}`)
      ]);
      renderPermissionList($("#rrhh_permissions"), data.items || [], { rrhhActions: true });
      $("#rrhh_total_mes").textContent = dashboard.total ?? 0;
      $("#rrhh_pendientes").textContent = dashboard.pendientes_rrhh ?? 0;
      $("#rrhh_particulares").textContent = dashboard.particulares ?? 0;
      $("#rrhh_minutos").textContent = dashboard.minutos_particulares ?? 0;
      $("#rrhh_criticos").textContent = dashboard.criticos ?? 0;
      renderBars($("#rrhh_chart_offices"), dashboard.por_oficina || []);
      renderBars($("#rrhh_chart_agents"), dashboard.agentes_recurrentes || []);
      renderBars($("#rrhh_chart_hours"), dashboard.por_hora || []);
    } catch (error) { toast(error.message, "error"); }
  }

  async function openDetail(id) {
    try {
      const p = await PermisosAPI.request(`/api/permisos/${id}`);
      const declared = p.minutos_declarados ?? p.minutos_autorizados;
      const calculated = p.minutos_calculados;
      const risks = p.riesgos || [];
      const modal = $("#modal_root");
      const riskBox = risks.length ? `<div class="perm-alert ${p.riesgo_critico ? "danger" : "warning"}"><strong>${p.riesgo_critico ? "REVISIÓN CRÍTICA" : "Atención"}</strong><span>${risks.map(x => escapeHtml(x.mensaje)).join(" · ")}</span></div>` : "";
      const compMode = p.reposicion_modalidad || p.modalidad_compensacion;
      const compDetail = p.tipo !== "PARTICULAR" ? "No corresponde" : compMode === "HORAS_EXTRAS_PREVIAS"
        ? `Usa horas extras previas del ${fmtDate(p.fecha_horas_extra)}, ${p.hora_desde_horas_extra || "—"} → ${p.hora_hasta_horas_extra || "—"} (${formatMinutes(p.minutos_horas_extra)})`
        : `Devuelve el ${fmtDate(p.reposicion_fecha_prevista || p.fecha_devolucion)}, ${p.reposicion_hora_desde || "—"} → ${p.reposicion_hora_hasta || "—"}`;

      modal.innerHTML = `<div class="perm-modal-backdrop" id="detail_backdrop"><div class="perm-modal perm-modal-large">
        <div class="perm-modal-header"><div><h3>${escapeHtml(p.numero_permiso || `#${p.id}`)}</h3><small>${badgeState(p.estado)}</small></div><button class="perm-modal-close" id="detail_close">×</button></div>
        <div class="perm-card-body">
          ${riskBox}
          <div class="perm-detail-grid">
            <div><strong>Agente</strong><p>${escapeHtml(p.agente_nombre || "—")} · Legajo ${escapeHtml(p.legajo || "—")}</p></div>
            <div><strong>Oficina</strong><p>${escapeHtml(p.oficina || "—")}</p></div>
            <div><strong>Jefatura</strong><p>${escapeHtml(p.jefe_nombre || "—")}</p></div>
            <div><strong>Jornada habitual</strong><p>${escapeHtml(p.jornada_desde || "08:00")} → ${escapeHtml(p.jornada_hasta || "14:00")}</p></div>
            <div><strong>Tipo</strong><p>${escapeHtml(p.tipo)}</p></div>
            <div><strong>Fecha</strong><p>${fmtDate(p.fecha_salida)}</p></div>
            <div><strong>Hora de salida / regreso</strong><p>${escapeHtml(p.hora_salida || "—")} → ${p.sin_regreso ? "Sin regreso" : escapeHtml(p.hora_regreso || "—")}</p></div>
            <div><strong>Destino</strong><p>${escapeHtml(p.lugar_destino || "—")}</p></div>
            <div><strong>Tiempo calculado</strong><p>${formatMinutes(calculated)}</p></div>
            <div><strong>Tiempo de salida declarado</strong><p>${formatMinutes(declared)}</p></div>
          </div>
          ${p.justificacion_minutos ? `<div class="perm-detail-note"><strong>Justificación de diferencia de tiempo</strong><p>${escapeHtml(p.justificacion_minutos)}</p></div>` : ""}
          ${p.tipo === "PARTICULAR" ? `<div class="perm-detail-note ${p.riesgo_critico ? "danger-note" : ""}"><strong>Compensación informada</strong><p>${escapeHtml(compDetail)}</p>${p.fecha_limite_devolucion ? `<small>Plazo sugerido: hasta ${fmtDate(p.fecha_limite_devolucion)}</small>` : ""}</div>` : ""}
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
      loadBossPanel();
    } catch (error) { toast(error.message, "error"); }
  }

  async function rejectPermission(id) {
    const reason = prompt("Motivo del rechazo (obligatorio):", "");
    if (!reason?.trim()) return;
    try {
      await PermisosAPI.request(`/api/permisos/${id}/rechazar`, { method: "POST", body: JSON.stringify({ observacion: reason.trim() }) });
      toast("Solicitud rechazada por Jefatura.", "success");
      loadBossPanel();
    } catch (error) { toast(error.message, "error"); }
  }

  async function verifyPermission(id) {
    const obs = prompt("Observación de RR.HH. (opcional):", "") ?? null;
    if (obs === null) return;
    try {
      await PermisosAPI.request(`/api/permisos/${id}/verificar-rrhh`, { method: "POST", body: JSON.stringify({ observacion: obs }) });
      toast("Permiso verificado por RR.HH.", "success");
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

  function selectedCompensation() {
    return $('input[name="compensacion_modo"]:checked')?.value || "DEVOLVER_HORAS";
  }

  function updateFormRules() {
    const type = selectedType();
    const official = type === "OFICIAL";
    const privateOut = type === "PARTICULAR";
    $("#field_destino").hidden = !official;
    $("#form_destino").required = official;
    $("#private_return_block").hidden = !privateOut;
    if (privateOut) updateCompensationRules();
    else {
      returnDeadline = null;
      setCompRequired(false, false);
    }
  }

  function setCompRequired(normal, extra) {
    $("#form_fecha_devolucion").required = normal;
    $("#form_devolucion_desde").required = normal;
    $("#form_devolucion_hasta").required = normal;
    $("#form_horas_extra_fecha").required = extra;
    $("#form_horas_extra_desde").required = extra;
    $("#form_horas_extra_hasta").required = extra;
  }

  function updateCompensationRules() {
    const extra = selectedCompensation() === "HORAS_EXTRAS_PREVIAS";
    $("#return_schedule_fields").hidden = extra;
    $("#extra_hours_fields").hidden = !extra;
    setCompRequired(!extra, extra);
    if (extra) {
      $("#form_justificacion_fuera_plazo").required = false;
      $("#deadline_warning").hidden = true;
      $("#field_deadline_reason").hidden = true;
      calculateExtraDuration();
    } else {
      loadReturnDeadline();
      calculateReturnDuration();
      updateDeadlineWarning();
    }
  }

  function updateReturnRules() {
    const noReturn = $("#form_regreso_tipo").value === "SIN_REGRESO";
    $("#field_hora_regreso").hidden = noReturn;
    $("#form_hora_regreso").required = !noReturn;
    $("#form_duracion_help").textContent = noReturn
      ? `Sin regreso: se calcula desde la salida hasta el fin de tu jornada (${currentUser?.jornada_hasta || "14:00"}).`
      : "Con regreso: se calcula desde la hora de salida hasta la hora estimada de regreso.";
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
    calculateReturnDuration();
    calculateExtraDuration();
  }

  function calculateReturnDuration() {
    if (selectedCompensation() !== "DEVOLVER_HORAS") return;
    const start = $("#form_devolucion_desde").value;
    const end = $("#form_devolucion_hasta").value;
    if (!start || !end) {
      $("#return_duration").textContent = "—";
      $("#return_short_warning").hidden = true;
      return;
    }
    const mins = minutesBetweenClock(start, end);
    if (mins <= 0) {
      $("#return_duration").textContent = "Horario inválido";
      $("#return_short_warning").hidden = true;
      return;
    }
    const declared = declaredMinutes();
    $("#return_duration").textContent = `${formatMinutes(mins)}${mins !== declared ? ` · salida declarada: ${formatMinutes(declared)}` : ""}`;
    $("#return_short_warning").hidden = !(mins < declared);
  }

  function calculateExtraDuration() {
    if (selectedCompensation() !== "HORAS_EXTRAS_PREVIAS") return;
    const start = $("#form_horas_extra_desde").value;
    const end = $("#form_horas_extra_hasta").value;
    if (!start || !end) {
      $("#extra_hours_duration").textContent = "—";
      $("#extra_short_warning").hidden = true;
      return;
    }
    const mins = minutesBetweenClock(start, end);
    if (mins <= 0) {
      $("#extra_hours_duration").textContent = "Horario inválido";
      $("#extra_short_warning").hidden = true;
      return;
    }
    $("#extra_hours_duration").textContent = `${formatMinutes(mins)} · salida declarada: ${formatMinutes(declaredMinutes())}`;
    $("#extra_short_warning").hidden = !(mins < declaredMinutes());
  }

  async function loadReturnDeadline() {
    if (selectedType() !== "PARTICULAR" || selectedCompensation() !== "DEVOLVER_HORAS") return;
    const date = $("#form_fecha").value;
    if (!date) {
      returnDeadline = null;
      $("#return_deadline").textContent = "Seleccioná la fecha de salida";
      return;
    }
    try {
      const data = await PermisosAPI.request(`/api/reglas/plazo-devolucion?fecha_salida=${encodeURIComponent(date)}`);
      returnDeadline = data.fecha_limite;
      $("#return_deadline").textContent = `Hasta ${fmtDate(returnDeadline)} · 7 días hábiles`;
      updateDeadlineWarning();
    } catch (_) {
      returnDeadline = null;
      $("#return_deadline").textContent = "No fue posible calcular el plazo";
    }
  }

  function updateDeadlineWarning() {
    if (selectedCompensation() !== "DEVOLVER_HORAS") return;
    const selected = $("#form_fecha_devolucion").value;
    const outside = !!(selected && returnDeadline && selected > returnDeadline);
    $("#deadline_warning").hidden = !outside;
    $("#field_deadline_reason").hidden = !outside;
    $("#form_justificacion_fuera_plazo").required = outside;
  }

  function updateExtraDateLimit() {
    const date = $("#form_fecha").value;
    if (!date) {
      $("#form_horas_extra_fecha").removeAttribute("max");
      return;
    }
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() - 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    $("#form_horas_extra_fecha").max = `${yyyy}-${mm}-${dd}`;
  }

  function formPayload() {
    const privateOut = selectedType() === "PARTICULAR";
    const mode = selectedCompensation();
    return {
      tipo: selectedType(),
      fecha_salida: $("#form_fecha").value,
      lugar_destino: $("#form_destino").value.trim() || null,
      hora_salida: $("#form_hora_salida").value,
      hora_regreso: $("#form_regreso_tipo").value === "SIN_REGRESO" ? null : $("#form_hora_regreso").value,
      sin_regreso: $("#form_regreso_tipo").value === "SIN_REGRESO",
      minutos_declarados: declaredMinutes(),
      justificacion_minutos: $("#form_justificacion_minutos").value.trim() || null,
      compensacion_modo: privateOut ? mode : "DEVOLVER_HORAS",
      fecha_devolucion: privateOut && mode === "DEVOLVER_HORAS" ? $("#form_fecha_devolucion").value || null : null,
      devolucion_hora_desde: privateOut && mode === "DEVOLVER_HORAS" ? $("#form_devolucion_desde").value || null : null,
      devolucion_hora_hasta: privateOut && mode === "DEVOLVER_HORAS" ? $("#form_devolucion_hasta").value || null : null,
      horas_extra_fecha: privateOut && mode === "HORAS_EXTRAS_PREVIAS" ? $("#form_horas_extra_fecha").value || null : null,
      horas_extra_desde: privateOut && mode === "HORAS_EXTRAS_PREVIAS" ? $("#form_horas_extra_desde").value || null : null,
      horas_extra_hasta: privateOut && mode === "HORAS_EXTRAS_PREVIAS" ? $("#form_horas_extra_hasta").value || null : null,
      justificacion_fuera_plazo: privateOut && mode === "DEVOLVER_HORAS" ? $("#form_justificacion_fuera_plazo").value.trim() || null : null,
      observaciones: $("#form_observaciones").value.trim() || null
    };
  }

  function resetPermissionForm() {
    const form = $("#permission_form");
    form.reset();
    declaredTouched = false;
    returnDeadline = null;
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    $("#form_fecha").value = `${yyyy}-${mm}-${dd}`;
    $("#form_tiempo_horas").value = 0;
    $("#form_tiempo_minutos").value = 0;
    $("#return_deadline").textContent = "Seleccioná una salida particular";
    $("#return_duration").textContent = "—";
    $("#extra_hours_duration").textContent = "—";
    fillUser(); // corrige el bug histórico del autorrellenado visible
    updateExtraDateLimit();
    updateFormRules();
    updateReturnRules();
    updateCompensationRules();
    updateTimeDifference();
    updateDeadlineWarning();
  }

  async function createPermission(sendNow) {
    const form = $("#permission_form");
    calculateDuration();
    calculateReturnDuration();
    calculateExtraDuration();
    updateDeadlineWarning();
    if (!form.reportValidity()) return;
    try {
      const created = await PermisosAPI.request("/api/permisos", { method: "POST", body: JSON.stringify(formPayload()) });
      if (sendNow) {
        await PermisosAPI.request(`/api/permisos/${created.id}/enviar`, { method: "POST" });
        toast(`${created.numero_permiso} enviado a la jefatura de tu Oficina.`, "success");
      } else {
        toast(`${created.numero_permiso} guardado como borrador.`, "success");
      }
      resetPermissionForm();
      setView("mios");
      loadDashboard();
    } catch (error) { toast(error.message, "error"); }
  }

  async function loadOfficeCatalog() {
    if (!currentUser) return;
    try {
      const data = await PermisosAPI.request("/api/catalogos/oficinas");
      officesCache = data.items || [];
      const selects = [$("#rrhh_filter_oficina"), $("#admin_oficina")].filter(Boolean);
      selects.forEach(select => {
        const previous = select.value;
        const first = select.id === "rrhh_filter_oficina" ? "Todas las Oficinas" : "Sin Oficina";
        select.innerHTML = `<option value="">${first}</option>` + officesCache.map(o => `<option value="${o.id}">${escapeHtml(o.nombre)}</option>`).join("");
        select.value = previous;
      });
    } catch (error) {
      if (currentUser.roles?.includes("RRHH") || currentUser.roles?.includes("ADMIN")) toast(error.message, "error");
    }
  }

  function clearAdminForm() {
    const form = $("#admin_user_form");
    form.reset();
    $("#admin_password").value = "";
    $("#admin_jornada_desde").value = "08:00";
    $("#admin_jornada_hasta").value = "14:00";
    const agentRole = $('input[name="admin_role"][value="AGENTE"]');
    if (agentRole) agentRole.checked = true;
  }

  function editAdminUser(id) {
    const u = adminUsersCache.find(x => Number(x.id) === Number(id));
    if (!u) return;
    $("#admin_username").value = u.username || "";
    $("#admin_password").value = "";
    $("#admin_email").value = u.email || "";
    $("#admin_nombre").value = u.nombre || "";
    $("#admin_apellido").value = u.apellido || "";
    $("#admin_legajo").value = u.legajo || "";
    $("#admin_dni").value = u.dni || "";
    $("#admin_oficina").value = u.oficina_id || "";
    $("#admin_jornada_desde").value = u.jornada_desde || "08:00";
    $("#admin_jornada_hasta").value = u.jornada_hasta || "14:00";
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
      await loadUsers();
      await loadOffices();
    } catch (error) { toast(error.message, "error"); }
  }

  function refreshOfficeBossOptions() {
    const select = $("#admin_office_boss");
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '<option value="">Sin jefatura asignada</option>' + adminUsersCache.filter(u => u.activo).map(u => `<option value="${u.id}">${escapeHtml(`${u.apellido || ""}, ${u.nombre || ""}`.replace(/^,\s*/, ""))} · ${escapeHtml(u.email)}</option>`).join("");
    select.value = previous;
  }

  async function loadUsers() {
    try {
      const data = await PermisosAPI.request("/api/admin/usuarios");
      const rows = data.items || [];
      adminUsersCache = rows;
      refreshOfficeBossOptions();
      const target = $("#admin_users");
      if (!rows.length) {
        target.innerHTML = '<div class="perm-empty">No hay usuarios.</div>';
        return;
      }
      target.innerHTML = `<div class="perm-table-wrap"><table class="perm-table perm-table-wide"><thead><tr><th>Usuario</th><th>Oficina</th><th>Jefatura</th><th>Estado</th><th>Jornada</th><th>Roles</th><th></th></tr></thead><tbody>${rows.map(u => `<tr class="${u.activo ? "" : "perm-row-disabled"}">
        <td><strong>${escapeHtml(`${u.nombre || ""} ${u.apellido || ""}`.trim())}</strong><br><small>${escapeHtml(u.email)}</small><br><small>Usuario: ${escapeHtml(u.username || "—")} · Legajo ${escapeHtml(u.legajo || "—")}</small></td>
        <td>${escapeHtml(u.oficina || "Sin Oficina")}</td>
        <td>${escapeHtml(u.jefe_nombre || "—")}</td>
        <td>${u.activo ? '<span class="perm-badge green">Activo</span>' : '<span class="perm-badge red">Sin acceso</span>'}</td>
        <td>${escapeHtml(u.jornada_desde || "08:00")} → ${escapeHtml(u.jornada_hasta || "14:00")}</td>
        <td>${escapeHtml((u.roles || []).join(", "))}</td>
        <td class="perm-row-actions"><button data-edit-user="${u.id}">Editar</button>${u.activo ? `<button class="danger-link" data-disable-user="${u.id}">Quitar acceso</button>` : `<button data-enable-user="${u.id}">Reactivar</button>`}</td>
      </tr>`).join("")}</tbody></table></div>`;
      $$('[data-edit-user]', target).forEach(btn => btn.addEventListener('click', () => editAdminUser(btn.dataset.editUser)));
      $$('[data-disable-user]', target).forEach(btn => btn.addEventListener('click', () => changeUserStatus(btn.dataset.disableUser, false)));
      $$('[data-enable-user]', target).forEach(btn => btn.addEventListener('click', () => changeUserStatus(btn.dataset.enableUser, true)));
    } catch (error) { toast(error.message, "error"); }
  }

  function clearOfficeForm() {
    $("#admin_office_form").reset();
    $("#admin_office_id").value = "";
    $("#admin_office_active").checked = true;
  }

  function editOffice(id) {
    const o = officesCache.find(x => Number(x.id) === Number(id));
    if (!o) return;
    $("#admin_office_id").value = o.id;
    $("#admin_office_name").value = o.nombre || "";
    $("#admin_office_boss").value = o.jefe_id || "";
    $("#admin_office_active").checked = !!o.activo;
    $("#admin_office_form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadOffices() {
    try {
      const data = await PermisosAPI.request("/api/admin/oficinas");
      officesCache = data.items || [];
      const target = $("#admin_offices");
      target.innerHTML = officesCache.length ? `<div class="perm-table-wrap"><table class="perm-table"><thead><tr><th>Oficina</th><th>Jefatura</th><th>Agentes</th><th>Estado</th><th></th></tr></thead><tbody>${officesCache.map(o => `<tr class="${o.activo ? "" : "perm-row-disabled"}">
        <td><strong>${escapeHtml(o.nombre)}</strong></td><td>${escapeHtml(o.jefe_nombre || "Sin jefatura")}</td><td>${Number(o.agentes_activos || 0)}</td><td>${o.activo ? '<span class="perm-badge green">Activa</span>' : '<span class="perm-badge red">Inactiva</span>'}</td><td class="perm-row-actions"><button data-edit-office="${o.id}">Editar</button></td>
      </tr>`).join("")}</tbody></table></div>` : '<div class="perm-empty">No hay Oficinas configuradas.</div>';
      $$('[data-edit-office]', target).forEach(btn => btn.addEventListener('click', () => editOffice(btn.dataset.editOffice)));
      const officeSelect = $("#admin_oficina");
      if (officeSelect) {
        const prev = officeSelect.value;
        officeSelect.innerHTML = '<option value="">Sin Oficina</option>' + officesCache.filter(o => o.activo).map(o => `<option value="${o.id}">${escapeHtml(o.nombre)}</option>`).join("");
        officeSelect.value = prev;
      }
    } catch (error) { toast(error.message, "error"); }
  }

  async function loadAdmin() {
    if (!currentUser?.roles?.includes("ADMIN")) return;
    await Promise.all([loadUsers(), loadOffices()]);
  }

  async function loadSheetsStatus() {
    if (!currentUser || !(currentUser.roles.includes("RRHH") || currentUser.roles.includes("ADMIN"))) return;
    try {
      const status = await PermisosAPI.request("/api/sheets/status");
      const link = $("#rrhh_sheet_link");
      const connect = $("#connect_sheets_btn");
      const sync = $("#sync_sheets_btn");
      const disconnect = $("#disconnect_sheets_btn");
      if (!link || !connect || !sync || !disconnect) return;
      if (!status.base_configured) {
        connect.hidden = true; sync.hidden = true; disconnect.hidden = true; link.hidden = true;
        return;
      }
      if (status.authorized && status.enabled) {
        connect.hidden = true; sync.hidden = false; disconnect.hidden = false;
        if (status.sheet_url) { link.href = status.sheet_url; link.hidden = false; }
      } else {
        connect.hidden = false; sync.hidden = true; disconnect.hidden = true; link.hidden = true;
      }
    } catch (_) {}
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

  function debounce(fn, delay = 350) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  }

  function bindEvents() {
    $$("[data-view]").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
    $$("[data-go]").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.go)));
    $$('[data-copy-rrhh]').forEach(btn => btn.addEventListener('click', () => copyRRHHEmail(btn)));
    $("#logout_btn").addEventListener("click", () => PermisosAuth.logout());

    $$('input[name="tipo"]').forEach(el => el.addEventListener("change", updateFormRules));
    $$('input[name="compensacion_modo"]').forEach(el => el.addEventListener("change", updateCompensationRules));
    $("#form_regreso_tipo").addEventListener("change", updateReturnRules);
    $("#form_hora_salida").addEventListener("input", calculateDuration);
    $("#form_hora_regreso").addEventListener("input", calculateDuration);
    $("#form_fecha").addEventListener("change", () => { loadReturnDeadline(); updateExtraDateLimit(); });
    $("#form_fecha_devolucion").addEventListener("change", updateDeadlineWarning);
    $("#form_devolucion_desde").addEventListener("input", calculateReturnDuration);
    $("#form_devolucion_hasta").addEventListener("input", calculateReturnDuration);
    $("#form_horas_extra_desde").addEventListener("input", calculateExtraDuration);
    $("#form_horas_extra_hasta").addEventListener("input", calculateExtraDuration);
    $("#form_tiempo_horas").addEventListener("input", () => { declaredTouched = true; updateTimeDifference(); calculateReturnDuration(); calculateExtraDuration(); });
    $("#form_tiempo_minutos").addEventListener("input", () => { declaredTouched = true; updateTimeDifference(); calculateReturnDuration(); calculateExtraDuration(); });
    $("#use_auto_time").addEventListener("click", () => {
      const auto = autoMinutes();
      if (auto === null) return toast("Primero completá el horario de salida/regreso.", "error");
      declaredTouched = false;
      setDeclaredMinutes(auto);
      $("#form_justificacion_minutos").value = "";
      updateTimeDifference();
      calculateReturnDuration();
      calculateExtraDuration();
    });
    $("#permission_form").addEventListener("submit", e => { e.preventDefault(); createPermission(true); });
    $("#save_draft_btn").addEventListener("click", () => createPermission(false));

    $("#refresh_jefatura").addEventListener("click", loadBossPanel);
    ["boss_filter_estado","boss_filter_tipo","boss_filter_desde","boss_filter_hasta"].forEach(id => $("#" + id).addEventListener("change", loadBossPanel));
    $("#boss_filter_agente").addEventListener("input", debounce(loadBossPanel));

    $("#refresh_rrhh").addEventListener("click", loadRRHH);
    ["rrhh_filter_oficina","rrhh_filter_estado","rrhh_filter_tipo","rrhh_filter_desde","rrhh_filter_hasta"].forEach(id => $("#" + id).addEventListener("change", loadRRHH));
    $("#rrhh_filter_agente").addEventListener("input", debounce(loadRRHH));

    $("#connect_sheets_btn").addEventListener("click", connectSheets);
    $("#sync_sheets_btn").addEventListener("click", syncSheets);
    $("#disconnect_sheets_btn").addEventListener("click", disconnectSheets);

    $("#refresh_users").addEventListener("click", loadUsers);
    $("#refresh_offices").addEventListener("click", loadOffices);
    $("#admin_clear_form").addEventListener("click", clearAdminForm);
    $("#admin_clear_office").addEventListener("click", clearOfficeForm);

    $("#admin_office_form").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        await PermisosAPI.request("/api/admin/oficinas", { method: "POST", body: JSON.stringify({
          id: $("#admin_office_id").value ? Number($("#admin_office_id").value) : null,
          nombre: $("#admin_office_name").value.trim(),
          jefe_id: $("#admin_office_boss").value ? Number($("#admin_office_boss").value) : null,
          activo: $("#admin_office_active").checked
        }) });
        toast("Oficina guardada. La jefatura se aplicará automáticamente a sus agentes.", "success");
        clearOfficeForm();
        await Promise.all([loadOffices(), loadUsers(), loadOfficeCatalog()]);
      } catch (error) { toast(error.message, "error"); }
    });

    $("#admin_user_form").addEventListener("submit", async e => {
      e.preventDefault();
      const roles = $$('input[name="admin_role"]:checked').map(x => x.value);
      try {
        await PermisosAPI.request("/api/admin/usuarios", { method: "POST", body: JSON.stringify({
          username: $("#admin_username").value.trim(),
          password: $("#admin_password").value || null,
          email: $("#admin_email").value.trim(),
          nombre: $("#admin_nombre").value.trim(),
          apellido: $("#admin_apellido").value.trim(),
          legajo: $("#admin_legajo").value.trim(),
          dni: $("#admin_dni").value.trim() || null,
          area: null,
          oficina_id: $("#admin_oficina").value ? Number($("#admin_oficina").value) : null,
          jornada_desde: $("#admin_jornada_desde").value || "08:00",
          jornada_hasta: $("#admin_jornada_hasta").value || "14:00",
          roles,
          jefe_email: null
        }) });
        toast("Usuario guardado y asignado a su Oficina.", "success");
        clearAdminForm();
        await Promise.all([loadUsers(), loadOffices()]);
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
    await Promise.all([loadDashboard(), loadOfficeCatalog(), loadSheetsStatus()]);
  }

  function onLoggedOut() {
    currentUser = null;
    $("#login_screen").hidden = false;
    $("#app_sidebar").hidden = true;
    $("#app_content").hidden = true;
    $("#user_widget").hidden = true;
    PermisosAuth.bindLoginForm();
    const loginUser = $("#login_usuario");
    if (loginUser) setTimeout(() => loginUser.focus(), 50);
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
    PermisosAuth.bindLoginForm();
    updateFormRules();
    updateReturnRules();
    updateCompensationRules();
    window.addEventListener("permisos:error", e => toast(e.detail, "error"));
    window.addEventListener("permisos:auth", e => e.detail ? onAuthenticated(e.detail) : onLoggedOut());

    // El servicio se verifica en segundo plano, sin exponer detalles técnicos en la UI.
    PermisosAPI.wakeBackend((state) => {
      const loginStatus = $("#login_status");
      if (!loginStatus || PermisosAPI.getToken()) return;
      if (state === "online") loginStatus.textContent = "Servicio disponible · listo para ingresar";
      else if (state === "offline") loginStatus.textContent = "El servicio está iniciando. Si no podés ingresar, reintentá en unos segundos.";
    });

    if (PermisosAPI.getToken()) {
      try { await PermisosAuth.loadMe(); return; } catch (_) {}
    }
    onLoggedOut();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
