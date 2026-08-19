(() => {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  let currentUser = null;
  let backendReady = false;

  function toast(message, type = "") {
    const el = document.createElement("div");
    el.className = `perm-toast ${type}`;
    el.textContent = message;
    $("#toast_stack").appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#039;",'"':"&quot;"}[c]));
  }

  function prettyState(state) {
    const map = {
      BORRADOR: "Borrador",
      PENDIENTE_JEFE: "Pendiente de jefe",
      PENDIENTE_RRHH: "Pendiente de RR.HH.",
      VERIFICADO_RRHH: "Verificado por RR.HH.",
      RECHAZADO: "Rechazado",
      CANCELADO_AGENTE: "Cancelado"
    };
    return map[state] || state;
  }

  function badgeState(state) {
    let cls = "";
    if (["VERIFICADO_RRHH"].includes(state)) cls = "green";
    else if (["PENDIENTE_JEFE", "PENDIENTE_RRHH", "BORRADOR"].includes(state)) cls = "yellow";
    else if (["RECHAZADO", "CANCELADO_AGENTE"].includes(state)) cls = "red";
    return `<span class="perm-badge ${cls}">${escapeHtml(prettyState(state))}</span>`;
  }

  function fmtDate(value) {
    if (!value) return "—";
    const [y,m,d] = value.slice(0,10).split("-");
    return `${d}/${m}/${y}`;
  }

  function formatMinutes(minutes) {
    if (minutes === null || minutes === undefined) return "Sin regreso";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h && m) return `${h} h ${m} min`;
    if (h) return `${h} h`;
    return `${m} min`;
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
  }

  async function loadDashboard() {
    try {
      const data = await PermisosAPI.request("/api/permisos/mios");
      const rows = data.items || [];
      $("#stat_mis_total").textContent = rows.length;
      $("#stat_mis_pendientes").textContent = rows.filter(x => ["BORRADOR","PENDIENTE_JEFE","PENDIENTE_RRHH"].includes(x.estado)).length;
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
    target.innerHTML = `<div class="perm-table-wrap"><table class="perm-table"><thead><tr>
      <th>Número</th><th>Fecha</th><th>Agente</th><th>Tipo</th><th>Horario</th><th>Estado</th><th></th>
    </tr></thead><tbody>${rows.map(p => {
      const agent = p.agente_nombre || [currentUser?.nombre,currentUser?.apellido].filter(Boolean).join(" ");
      return `<tr>
        <td><strong>${escapeHtml(p.numero_permiso || `#${p.id}`)}</strong></td>
        <td>${fmtDate(p.fecha_salida)}</td>
        <td>${escapeHtml(agent || "—")}</td>
        <td>${escapeHtml(p.tipo)}</td>
        <td>${escapeHtml(p.hora_salida || "—")} → ${p.sin_regreso ? "Sin regreso" : escapeHtml(p.hora_regreso || "—")}</td>
        <td>${badgeState(p.estado)}</td>
        <td><button data-detail="${p.id}">Ver</button>${options.bossActions && p.estado === "PENDIENTE_JEFE" ? ` · <button data-authorize="${p.id}">Autorizar</button> · <button data-reject="${p.id}">Rechazar</button>` : ""}${options.rrhhActions && p.estado === "PENDIENTE_RRHH" ? ` · <button data-verify="${p.id}">Verificar</button>` : ""}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;

    $$('[data-detail]', target).forEach(btn => btn.addEventListener('click', () => openDetail(btn.dataset.detail)));
    $$('[data-authorize]', target).forEach(btn => btn.addEventListener('click', () => authorizePermission(btn.dataset.authorize)));
    $$('[data-reject]', target).forEach(btn => btn.addEventListener('click', () => rejectPermission(btn.dataset.reject)));
    $$('[data-verify]', target).forEach(btn => btn.addEventListener('click', () => verifyPermission(btn.dataset.verify)));
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
      const modal = $("#modal_root");
      modal.innerHTML = `<div class="perm-modal-backdrop" id="detail_backdrop"><div class="perm-modal">
        <div class="perm-modal-header"><div><h3>${escapeHtml(p.numero_permiso)}</h3><small>${badgeState(p.estado)}</small></div><button class="perm-modal-close" id="detail_close">×</button></div>
        <div class="perm-card-body">
          <div class="perm-grid-2">
            <div><strong>Agente</strong><p>${escapeHtml(p.agente_nombre || "—")} · Legajo ${escapeHtml(p.legajo || "—")}</p></div>
            <div><strong>Tipo</strong><p>${escapeHtml(p.tipo)}</p></div>
            <div><strong>Fecha</strong><p>${fmtDate(p.fecha_salida)}</p></div>
            <div><strong>Horario</strong><p>${escapeHtml(p.hora_salida)} → ${p.sin_regreso ? "Sin regreso" : escapeHtml(p.hora_regreso || "—")} (${formatMinutes(p.minutos_autorizados)})</p></div>
            <div><strong>Destino</strong><p>${escapeHtml(p.lugar_destino || "—")}</p></div>
            <div><strong>Devolución</strong><p>${fmtDate(p.fecha_devolucion)}</p></div>
          </div>
          <div><strong>Observaciones</strong><p>${escapeHtml(p.observaciones || "—")}</p></div>
          <hr style="border:0;border-top:1px solid #eee;margin:20px 0">
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
      await PermisosAPI.request(`/api/permisos/${id}/autorizar`, { method:"POST", body:JSON.stringify({ observacion: observation }) });
      toast("Permiso autorizado y enviado a RR.HH.", "success");
      loadBossQueue();
    } catch (error) { toast(error.message, "error"); }
  }

  async function rejectPermission(id) {
    const reason = prompt("Motivo del rechazo:", "");
    if (!reason) return;
    try {
      await PermisosAPI.request(`/api/permisos/${id}/rechazar`, { method:"POST", body:JSON.stringify({ observacion: reason }) });
      toast("Solicitud rechazada.", "success");
      loadBossQueue();
    } catch (error) { toast(error.message, "error"); }
  }

  async function verifyPermission(id) {
    const obs = prompt("Observación de RR.HH. (opcional):", "") ?? null;
    if (obs === null) return;
    try {
      await PermisosAPI.request(`/api/permisos/${id}/verificar-rrhh`, { method:"POST", body:JSON.stringify({ observacion: obs }) });
      toast("Permiso verificado por RR.HH.", "success");
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
    $("#field_devolucion").hidden = !privateOut;
    $("#form_fecha_devolucion").required = privateOut;
  }

  function updateReturnRules() {
    const noReturn = $("#form_regreso_tipo").value === "SIN_REGRESO";
    $("#field_hora_regreso").hidden = noReturn;
    $("#form_hora_regreso").required = !noReturn;
    calculateDuration();
  }

  function calculateDuration() {
    const noReturn = $("#form_regreso_tipo").value === "SIN_REGRESO";
    if (noReturn) { $("#form_duracion").textContent = "Sin regreso"; return; }
    const start = $("#form_hora_salida").value;
    const end = $("#form_hora_regreso").value;
    if (!start || !end) { $("#form_duracion").textContent = "—"; return; }
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    $("#form_duracion").textContent = mins > 0 ? formatMinutes(mins) : "Horario inválido";
  }

  function formPayload() {
    return {
      tipo: selectedType(),
      fecha_salida: $("#form_fecha").value,
      lugar_destino: $("#form_destino").value.trim() || null,
      hora_salida: $("#form_hora_salida").value,
      hora_regreso: $("#form_regreso_tipo").value === "SIN_REGRESO" ? null : $("#form_hora_regreso").value,
      sin_regreso: $("#form_regreso_tipo").value === "SIN_REGRESO",
      fecha_devolucion: selectedType() === "PARTICULAR" ? $("#form_fecha_devolucion").value || null : null,
      observaciones: $("#form_observaciones").value.trim() || null
    };
  }

  async function createPermission(sendNow) {
    const form = $("#permission_form");
    if (!form.reportValidity()) return;
    try {
      const created = await PermisosAPI.request("/api/permisos", { method:"POST", body:JSON.stringify(formPayload()) });
      if (sendNow) {
        await PermisosAPI.request(`/api/permisos/${created.id}/enviar`, { method:"POST" });
        toast(`${created.numero_permiso} enviado a autorización.`, "success");
      } else {
        toast(`${created.numero_permiso} guardado como borrador.`, "success");
      }
      form.reset();
      $("#form_fecha").valueAsDate = new Date();
      updateFormRules();
      updateReturnRules();
      setView("mios");
      loadDashboard();
    } catch (error) { toast(error.message, "error"); }
  }

  async function loadUsers() {
    try {
      const data = await PermisosAPI.request("/api/admin/usuarios");
      const rows = data.items || [];
      const target = $("#admin_users");
      if (!rows.length) { target.innerHTML = '<div class="perm-empty">No hay usuarios.</div>'; return; }
      target.innerHTML = `<div class="perm-table-wrap"><table class="perm-table"><thead><tr><th>Usuario</th><th>Legajo</th><th>Roles</th><th>Jefe</th></tr></thead><tbody>${rows.map(u => `<tr><td><strong>${escapeHtml(`${u.nombre || ""} ${u.apellido || ""}`.trim())}</strong><br><small>${escapeHtml(u.email)}</small></td><td>${escapeHtml(u.legajo || "—")}</td><td>${escapeHtml((u.roles||[]).join(", "))}</td><td>${escapeHtml(u.jefe_nombre || "—")}</td></tr>`).join("")}</tbody></table></div>`;
    } catch (error) { toast(error.message, "error"); }
  }

  async function syncSheets() {
    try {
      const result = await PermisosAPI.request("/api/sheets/sync", { method:"POST" });
      toast(result.message || "Sincronización finalizada.", result.status === "ok" ? "success" : "");
      $("#status_sheets").textContent = result.status === "ok" ? "● Google Sheets: sincronizado" : "○ Google Sheets: no configurado";
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
    $("#permission_form").addEventListener("submit", e => { e.preventDefault(); createPermission(true); });
    $("#save_draft_btn").addEventListener("click", () => createPermission(false));
    $("#refresh_jefatura").addEventListener("click", loadBossQueue);
    $("#refresh_rrhh").addEventListener("click", loadRRHH);
    $("#rrhh_filter_estado").addEventListener("change", loadRRHH);
    $("#rrhh_filter_tipo").addEventListener("change", loadRRHH);
    $("#sync_sheets_btn").addEventListener("click", syncSheets);
    $("#refresh_users").addEventListener("click", loadUsers);
    $("#admin_user_form").addEventListener("submit", async e => {
      e.preventDefault();
      const roles = $$('input[name="admin_role"]:checked').map(x => x.value);
      try {
        await PermisosAPI.request("/api/admin/usuarios", { method:"POST", body:JSON.stringify({
          email: $("#admin_email").value.trim(), nombre: $("#admin_nombre").value.trim(), apellido: $("#admin_apellido").value.trim(),
          legajo: $("#admin_legajo").value.trim(), dni: $("#admin_dni").value.trim() || null, area: $("#admin_area").value.trim() || null,
          roles, jefe_email: $("#admin_jefe_email").value.trim() || null
        })});
        toast("Usuario guardado.", "success"); e.target.reset(); loadUsers();
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
    const sheetUrl = window.ERSEP_PERMISOS_CONFIG.RRHH_SHEET_URL;
    if (sheetUrl && (user.roles.includes("RRHH") || user.roles.includes("ADMIN"))) {
      $("#rrhh_sheet_link").href = sheetUrl;
      $("#rrhh_sheet_link").hidden = false;
    }
    $("#form_fecha").valueAsDate = new Date();
    await loadDashboard();
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
