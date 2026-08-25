const THEME_KEY = "cyt-theme";
const CONFIG = window.ERSEP_BOLETIN_CONFIG || {};
const API_BASE_URL = String(CONFIG.API_BASE_URL || "").replace(/\/+$/, "");
const TERMINAL_STATES = new Set(["COMPLETED", "STOPPED", "ERROR", "INTERRUPTED"]);
const AGUAS_CORDOBESAS_ALERT = {
  nombre: "Aguas Cordobesas",
  aliases: "Aguas Cordobesas; Aguas Cordobesas S.A.; Aguas Cordobesas SA; Aguas Cordobesas S.A; ACSA; AACC; aguas cordobesas; Aguas Cordobesas Sociedad Anónima; Aguas Cordobesas Sociedad Anonima",
  active: true,
};

let currentRunId = null;
let pollingTimer = null;
let monitorItems = [];
let alerts = [];
let historyPage = 1;
let historyPages = 1;
let selectedPublication = null;
let lastResultSignature = "";
let backendReady = false;
let initialized = false;
let wakeInProgress = false;
let loadingMessageTimer = null;
let retryRevealTimer = null;
let selectedOrganism = "ersep";

function apiUrl(path){
  if (!API_BASE_URL) throw new Error("No se pudo ubicar el servicio del buscador.");
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  const button = document.getElementById("btn_theme");
  if (button) button.textContent = theme === "dark" ? "☀️" : "🌙";
}
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
}
function escapeHtml(value){
  return String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
}
function normalizeText(value){
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}
function formatDate(value){
  if (!value) return "—";
  const text = String(value);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text;
  const date = new Date(text.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString("es-AR");
}
function showAlert(message, type=""){
  const element = document.getElementById("global_alert");
  element.className = `tool-alert ${type}`;
  element.textContent = message;
  element.style.display = "block";
  if (type === "success") setTimeout(() => { element.style.display = "none"; }, 4500);
}
function hideAlert(){ document.getElementById("global_alert").style.display = "none"; }

async function api(path, options={}){
  const response = await fetch(apiUrl(path), {
    ...options,
    cache: options.cache || "no-store",
    headers: {
      "Content-Type":"application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `La solicitud no pudo completarse (HTTP ${response.status}).`);
  return payload;
}

async function fetchDownload(path, fallbackName){
  const response = await fetch(apiUrl(path), {cache:"no-store"});
  if (!response.ok){
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `La descarga no pudo completarse (HTTP ${response.status}).`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return blob;
}

function setTab(name){
  document.querySelectorAll(".boletin-tab").forEach(button => button.classList.toggle("active", button.dataset.tab === name));
  document.querySelectorAll(".boletin-view").forEach(view => view.classList.remove("active"));
  document.getElementById(`view_${name}`).classList.add("active");
  if (name === "alerts") loadAlerts().catch(error => showAlert(error.message, "error"));
  if (name === "history") loadHistory().catch(error => showAlert(error.message, "error"));
}

function initializeYears(){
  const select = document.getElementById("monitor_year");
  const current = new Date().getFullYear();
  const options = [];
  for (let year = current; year >= 2018; year--) options.push(`<option value="${year}">${year}</option>`);
  select.innerHTML = options.join("");
  select.value = String(current);
}

async function loadHealth(){
  const health = await api("/api/boletin/health");
  const status = document.getElementById("status");
  if (!health.pymupdf_available){
    status.textContent = "Funciones de lectura limitadas";
    showAlert("El componente de lectura de PDF no está disponible. Algunas búsquedas pueden no funcionar correctamente.", "error");
  } else {
    status.textContent = `${health.publicaciones} publicaciones · ${health.alertas_activas} alertas activas`;
  }
}

const ORGANISM_UI = {
  ersep: {label:"Resoluciones del ERSeP", kpi:"Resoluciones ERSeP", button:"▶ Iniciar búsqueda ERSeP"},
  capital_humano: {label:"Resoluciones Secretaría de Capital Humano", kpi:"Resoluciones Capital Humano", button:"▶ Buscar resoluciones de Capital Humano"},
  secretaria_general: {label:"Resoluciones de Secretaría General", kpi:"Resoluciones Secretaría General", button:"▶ Buscar resoluciones de Secretaría General"},
};

function selectOrganism(organismo){
  selectedOrganism = ORGANISM_UI[organismo] ? organismo : "ersep";
  document.querySelectorAll("[data-organismo]").forEach(button => button.classList.toggle("active", button.dataset.organismo === selectedOrganism));
  const ui = ORGANISM_UI[selectedOrganism];
  document.getElementById("source_current").textContent = ui.label;
  document.getElementById("kpi_resolution_label").textContent = ui.kpi;
  document.getElementById("btn_start_monitor").textContent = ui.button;
  document.querySelector(".monitor-form-grid")?.classList.toggle("rrhh-mode", selectedOrganism !== "ersep");
  document.getElementById("rrhh_panel_note").hidden = selectedOrganism === "ersep";
  document.getElementById("progress_message").textContent = selectedOrganism === "ersep"
    ? "Configurá el año y presioná Iniciar búsqueda ERSeP."
    : `Elegí el año y buscá todas las resoluciones de ${ui.label.replace(/^Resoluciones (del |de |)/, "")}.`;
}

function monitorPayload(){
  const terms = document.getElementById("monitor_terms").value
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  return {
    anio: Number(document.getElementById("monitor_year").value),
    organismo: selectedOrganism,
    terminos: terms,
    revalidar_pdfs: document.getElementById("monitor_revalidate").checked,
    incluir_todas_ersep: document.getElementById("monitor_all").checked,
    mostrar_sin_cambios: document.getElementById("monitor_unchanged").checked,
  };
}

async function startMonitoring(){
  hideAlert();
  const button = document.getElementById("btn_start_monitor");
  button.disabled = true;
  button.textContent = "Iniciando...";
  try {
    const response = await api("/api/boletin/monitorear", {
      method:"POST",
      body:JSON.stringify(monitorPayload()),
    });
    currentRunId = response.run_id;
    monitorItems = [];
    lastResultSignature = "";
    renderMonitorResults();
    setRunControls(true);
    await pollRun();
  } catch(error){
    showAlert(error.message, "error");
    setRunControls(false);
  } finally {
    button.textContent = ORGANISM_UI[selectedOrganism].button;
    if (!currentRunId) button.disabled = false;
  }
}

function setRunControls(running){
  document.getElementById("btn_start_monitor").disabled = running;
  document.getElementById("btn_stop_monitor").disabled = !running;
  const exportEnabled = Boolean(currentRunId);
  document.getElementById("btn_save_txt").disabled = !exportEnabled;
  document.getElementById("btn_copy_txt").disabled = !exportEnabled;
}

async function stopMonitoring(){
  if (!currentRunId) return;
  const button = document.getElementById("btn_stop_monitor");
  button.disabled = true;
  try {
    await api(`/api/boletin/monitoreo/${currentRunId}/detener`, {method:"POST", body:"{}"});
    document.getElementById("progress_message").textContent = "Solicitando detención segura...";
  } catch(error){ showAlert(error.message, "error"); }
}

async function pollRun(){
  if (!currentRunId) return;
  if (pollingTimer) clearTimeout(pollingTimer);
  try {
    const run = await api(`/api/boletin/monitoreo/${currentRunId}`);
    renderProgress(run);
    const signature = `${run.relevant_count || 0}|${run.new_count || 0}|${run.changed_count || 0}|${run.unchanged_count || 0}`;
    if (signature !== lastResultSignature){
      lastResultSignature = signature;
      await loadRunResults();
    }
    if (TERMINAL_STATES.has(run.status)){
      setRunControls(false);
      document.getElementById("btn_save_txt").disabled = false;
      document.getElementById("btn_copy_txt").disabled = false;
      await loadRunResults();
      await loadHealth();
      if (run.status === "COMPLETED") showAlert("Monitoreo anual finalizado correctamente.", "success");
      else if (run.status === "STOPPED") showAlert("El monitoreo fue detenido. Los resultados ya procesados quedaron guardados.");
      else showAlert(run.mensaje || "La ejecución finalizó con errores.", "error");
      return;
    }
  } catch(error){
    showAlert(error.message, "error");
    setRunControls(false);
    return;
  }
  pollingTimer = setTimeout(pollRun, 1300);
}

function renderProgress(run){
  const percentage = Math.max(0, Math.min(100, Number(run.porcentaje || 0)));
  document.getElementById("progress_state").textContent = statusLabel(run.status);
  document.getElementById("progress_message").textContent = run.mensaje || "Procesando...";
  document.getElementById("progress_percent").textContent = `${Math.round(percentage)}%`;
  document.getElementById("progress_bar").style.width = `${percentage}%`;
  document.getElementById("kpi_months").textContent = `${Number(run.meses_procesados || 0)} / 12`;
  document.getElementById("kpi_pdfs").textContent = Number(run.pdfs_analizados || 0).toLocaleString("es-AR");
  document.getElementById("kpi_resolutions").textContent = Number(run.resoluciones_detectadas || 0).toLocaleString("es-AR");
  document.getElementById("kpi_news").textContent = Number(run.novedades || 0).toLocaleString("es-AR");
  document.getElementById("kpi_errors").textContent = Number(run.error_count || 0).toLocaleString("es-AR");
}
function statusLabel(status){
  return ({PENDING:"En cola",RUNNING:"Monitoreo en ejecución",STOPPING:"Deteniendo",COMPLETED:"Finalizado",STOPPED:"Detenido",ERROR:"Finalizado con error",INTERRUPTED:"Interrumpido"})[status] || status || "Sin ejecución";
}

async function loadRunResults(){
  if (!currentRunId) return;
  const payload = await api(`/api/boletin/monitoreo/${currentRunId}/resultados`);
  monitorItems = payload.items || [];
  renderMonitorResults();
}

function changeClass(value){
  if (value === "NUEVO") return "new";
  if (value === "MODIFICADO") return "changed";
  if (value === "SIN CAMBIOS") return "same";
  return "error";
}

function renderMonitorResults(){
  const container = document.getElementById("monitor_results");
  document.getElementById("result_counter").textContent = `${monitorItems.length} ${monitorItems.length === 1 ? "publicación" : "publicaciones"}`;
  document.getElementById("btn_clear_findings").disabled = monitorItems.length === 0;
  if (!monitorItems.length){
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⌕</div><strong>Todavía no hay hallazgos</strong><p>Las resoluciones nuevas o modificadas aparecerán aquí durante el monitoreo.</p></div>`;
    return;
  }
  container.innerHTML = monitorItems.map(item => {
    const alertsText = (item.alertas || []).join(", ");
    const terms = (item.terminos_encontrados || []).join(", ");
    return `<article class="result-item" data-change="${escapeHtml(item.novedad)}">
      <div class="result-top">
        <span class="result-date">${escapeHtml(item.fecha || "Fecha no detectada")}</span>
        <div class="result-badges">
          <span class="badge ${changeClass(item.novedad)}">${escapeHtml(item.novedad)}</span>
          <span class="badge state">${escapeHtml(item.estado_detectado)}</span>
        </div>
      </div>
      <div>
        <h4>${escapeHtml(item.numero)}</h4>
        <div class="result-provider">${escapeHtml(item.prestadora || "Prestadora no identificada")}</div>
        ${alertsText ? `<div class="result-alerts">Alerta: ${escapeHtml(alertsText)}</div>` : ""}
      </div>
      <p class="result-excerpt">${escapeHtml(item.extracto || "Sin extracto disponible")}</p>
      ${terms ? `<div class="result-alerts">Términos: ${escapeHtml(terms)}</div>` : ""}
      <div class="result-footer">
        <span class="result-file">${escapeHtml(item.archivo)}</span>
        <button class="mini-button" data-detail-id="${Number(item.publication_id)}" type="button">Ver detalle →</button>
      </div>
    </article>`;
  }).join("");
}

function clearMonitorFindings(){
  if (!monitorItems.length) return;
  const message = currentRunId
    ? "¿Limpiar los hallazgos visibles? El historial guardado y la ejecución no se borrarán."
    : "¿Limpiar los hallazgos visibles?";
  if (!confirm(message)) return;
  monitorItems = [];
  renderMonitorResults();
  showAlert("Hallazgos visibles limpiados. El historial quedó intacto.", "success");
}

async function saveRunTxt(){
  if (!currentRunId) return;
  try {
    await fetchDownload(`/api/boletin/exportar?scope=run&run_id=${currentRunId}&formato=txt`, `boletin_run_${currentRunId}.txt`);
  } catch(error){ showAlert(error.message, "error"); }
}
async function copyRunTxt(){
  if (!currentRunId) return;
  try {
    const response = await fetch(apiUrl(`/api/boletin/exportar?scope=run&run_id=${currentRunId}&formato=txt`), {cache:"no-store"});
    if (!response.ok){ const payload = await response.json().catch(() => ({})); throw new Error(payload.detail || `La solicitud no pudo completarse (HTTP ${response.status}).`); }
    await navigator.clipboard.writeText(await response.text());
    showAlert("TXT completo copiado al portapapeles.", "success");
  } catch(error){ showAlert(error.message, "error"); }
}

async function openDetail(publicationId){
  try {
    selectedPublication = await api(`/api/boletin/publicaciones/${publicationId}`);
    document.getElementById("detail_title").textContent = selectedPublication.resolution_number || "Detalle de resolución";
    document.getElementById("detail_badge").textContent = selectedPublication.last_change_type || "Publicación ERSeP";
    const alertNames = (selectedPublication.matched_alerts || []).map(item => typeof item === "string" ? item : item.nombre).filter(Boolean);
    document.getElementById("detail_meta").innerHTML = [
      ["Publicación", selectedPublication.publication_date || "—"],
      ["Prestadora", selectedPublication.provider || "—"],
      ["Estado detectado", selectedPublication.detected_state || "—"],
      ["Alertas", alertNames.join(", ") || "Sin coincidencias"],
      ["Archivo", selectedPublication.source_pdf || "—"],
      ["Primera detección", formatDate(selectedPublication.first_seen_at)],
      ["Última verificación", formatDate(selectedPublication.last_seen_at)],
      ["Verificaciones", selectedPublication.verification_count || 1],
    ].map(([label,value]) => `<div class="detail-meta-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    document.getElementById("detail_resuelve").textContent = selectedPublication.text_resuelve || "(bloque RESUELVE no detectado automáticamente)";
    document.getElementById("detail_full").textContent = selectedPublication.text_full || "(texto completo no disponible)";
    const warning = document.getElementById("detail_warning");
    warning.style.display = selectedPublication.warning ? "block" : "none";
    warning.textContent = selectedPublication.warning || "";
    openModal("detail_modal");
  } catch(error){ showAlert(error.message, "error"); }
}

async function downloadSelectedPdf(){
  if (!selectedPublication) return;
  try {
    await fetchDownload(`/api/boletin/publicaciones/${selectedPublication.id}/pdf`, selectedPublication.source_pdf || "boletin.pdf");
  } catch(error){ showAlert(error.message, "error"); }
}
async function copySelected(field, label){
  if (!selectedPublication) return;
  const text = selectedPublication[field] || "";
  if (!text) return showAlert(`No hay contenido disponible para ${label}.`, "error");
  await navigator.clipboard.writeText(text);
  showAlert(`${label} copiado al portapapeles.`, "success");
}

async function loadAlerts(){
  const payload = await api("/api/boletin/alertas");
  alerts = payload.items || [];
  renderAlerts();
  renderAlertFilter();
}
async function addAguasCordobesasAlert(){
  const exists = alerts.some(item => normalizeText(item.nombre) === normalizeText(AGUAS_CORDOBESAS_ALERT.nombre));
  if (exists){
    showAlert("La alerta de Aguas Cordobesas ya está configurada.", "error");
    return;
  }
  const button = document.getElementById("btn_add_aguas_alert");
  if (button){ button.disabled = true; button.textContent = "Agregando…"; }
  try {
    await api("/api/boletin/alertas", {method:"POST", body:JSON.stringify(AGUAS_CORDOBESAS_ALERT)});
    await loadAlerts();
    await loadHealth();
    showAlert("Alerta de Aguas Cordobesas agregada correctamente.", "success");
  } catch(error){
    showAlert(error.message, "error");
  } finally {
    if (button){ button.disabled = false; button.textContent = "+ Agregar alerta de Aguas Cordobesas"; }
  }
}
function renderAlerts(){
  const body = document.getElementById("alerts_table");
  if (!alerts.length){
    body.innerHTML = `<tr><td colspan="5">No hay alertas configuradas.</td></tr>`;
    return;
  }
  body.innerHTML = alerts.map(item => `<tr>
    <td><strong>${escapeHtml(item.nombre)}</strong></td>
    <td class="alias-cell">${escapeHtml(item.aliases)}</td>
    <td><span class="status-dot ${item.active ? "active" : "paused"}">${item.active ? "Activa" : "Pausada"}</span></td>
    <td>${escapeHtml(formatDate(item.updated_at))}</td>
    <td><div class="table-actions">
      <button class="mini-button" data-alert-edit="${item.id}" type="button">Editar</button>
      <button class="mini-button" data-alert-state="${item.id}" data-active="${item.active ? "1" : "0"}" type="button">${item.active ? "Pausar" : "Reactivar"}</button>
      <button class="mini-button" data-alert-delete="${item.id}" type="button">Eliminar</button>
    </div></td>
  </tr>`).join("");
}
function renderAlertFilter(){
  const select = document.getElementById("history_alert");
  const current = select.value;
  select.innerHTML = `<option value="">Todas</option>` + alerts.map(item => `<option value="${escapeHtml(item.nombre)}">${escapeHtml(item.nombre)}</option>`).join("");
  if ([...select.options].some(option => option.value === current)) select.value = current;
}
function openAlertModal(item=null){
  document.getElementById("alert_modal_title").textContent = item ? "Editar alerta" : "Nueva alerta";
  document.getElementById("alert_id").value = item?.id || "";
  document.getElementById("alert_name").value = item?.nombre || "";
  document.getElementById("alert_aliases").value = item?.aliases || "";
  document.getElementById("alert_active").checked = item ? Boolean(item.active) : true;
  openModal("alert_modal");
  setTimeout(() => document.getElementById("alert_name").focus(), 80);
}
async function saveAlert(event){
  event.preventDefault();
  const id = document.getElementById("alert_id").value;
  const body = {
    nombre: document.getElementById("alert_name").value.trim(),
    aliases: document.getElementById("alert_aliases").value.trim(),
    active: document.getElementById("alert_active").checked,
  };
  try {
    await api(id ? `/api/boletin/alertas/${id}` : "/api/boletin/alertas", {method:id ? "PUT" : "POST", body:JSON.stringify(body)});
    closeModal("alert_modal");
    await loadAlerts();
    await loadHealth();
    showAlert("Alerta guardada correctamente.", "success");
  } catch(error){ showAlert(error.message, "error"); }
}
async function toggleAlert(id, active){
  await api(`/api/boletin/alertas/${id}/estado`, {method:"PATCH", body:JSON.stringify({active:!active})});
  await loadAlerts();
  await loadHealth();
}
async function deleteAlert(id){
  const item = alerts.find(entry => Number(entry.id) === Number(id));
  if (!confirm(`¿Eliminar la alerta “${item?.nombre || id}”?`)) return;
  await api(`/api/boletin/alertas/${id}`, {method:"DELETE"});
  await loadAlerts();
  await loadHealth();
}

function historyParams(page=historyPage){
  const params = new URLSearchParams({page:String(page), page_size:"25"});
  const mapping = {
    texto: document.getElementById("history_text").value.trim(),
    anio: document.getElementById("history_year").value,
    estado: document.getElementById("history_state").value,
    prestadora: document.getElementById("history_provider").value.trim(),
    alerta: document.getElementById("history_alert").value,
  };
  Object.entries(mapping).forEach(([key,value]) => { if (value) params.set(key,value); });
  if (document.getElementById("history_news_only").checked) params.set("solo_novedades","true");
  return params;
}
async function loadHistoryFilterOptions(){
  const payload = await api("/api/boletin/historial/filtros");
  const yearSelect = document.getElementById("history_year");
  const stateSelect = document.getElementById("history_state");
  const currentYear = yearSelect.value;
  const currentState = stateSelect.value;
  yearSelect.innerHTML = `<option value="">Todos</option>` + (payload.years || []).map(year => `<option value="${Number(year)}">${Number(year)}</option>`).join("");
  stateSelect.innerHTML = `<option value="">Todos</option>` + (payload.states || []).map(state => `<option value="${escapeHtml(state)}">${escapeHtml(state)}</option>`).join("");
  yearSelect.value = currentYear;
  stateSelect.value = currentState;
}

async function loadHistory(page=historyPage){
  historyPage = page;
  const payload = await api(`/api/boletin/historial?${historyParams(page)}`);
  historyPages = payload.pages || 1;
  renderHistory(payload.items || [], payload.total || 0);
  populateHistoryOptions(payload.items || []);
}
function populateHistoryOptions(items){
  const yearSelect = document.getElementById("history_year");
  const stateSelect = document.getElementById("history_state");
  const currentYear = yearSelect.value;
  const currentState = stateSelect.value;
  const years = [...new Set(items.map(item => item.year).filter(Boolean))].sort((a,b) => b-a);
  const states = [...new Set(items.map(item => item.detected_state).filter(Boolean))].sort();
  for (const year of years){ if (![...yearSelect.options].some(option => option.value === String(year))) yearSelect.add(new Option(String(year), String(year))); }
  for (const state of states){ if (![...stateSelect.options].some(option => option.value === state)) stateSelect.add(new Option(state, state)); }
  yearSelect.value = currentYear;
  stateSelect.value = currentState;
}
function renderHistory(items, total){
  const body = document.getElementById("history_table");
  if (!items.length){
    body.innerHTML = `<tr><td colspan="10">No hay publicaciones que coincidan con los filtros.</td></tr>`;
  } else {
    body.innerHTML = items.map(item => {
      const alertNames = (item.matched_alerts || []).map(entry => typeof entry === "string" ? entry : entry.nombre).filter(Boolean);
      return `<tr>
        <td>${escapeHtml(item.publication_date || "—")}</td>
        <td><strong>${escapeHtml(item.resolution_number)}</strong></td>
        <td>${escapeHtml(item.provider || "—")}</td>
        <td><span class="badge state">${escapeHtml(item.detected_state || "—")}</span></td>
        <td>${escapeHtml(alertNames.join(", ") || "—")}</td>
        <td>${escapeHtml(formatDate(item.first_seen_at))}</td>
        <td>${escapeHtml(formatDate(item.last_seen_at))}</td>
        <td class="num">${Number(item.verification_count || 1)}</td>
        <td><span class="badge ${changeClass(item.last_change_type)}">${escapeHtml(item.last_change_type)}</span><div class="hash-indicator" title="${escapeHtml(item.content_hash)}">${escapeHtml(item.content_hash || "")}</div></td>
        <td><button class="mini-button" data-detail-id="${item.id}" type="button">Abrir</button></td>
      </tr>`;
    }).join("");
  }
  document.getElementById("history_page_label").textContent = `Página ${historyPage} de ${historyPages} · ${total} registros`;
  document.getElementById("history_prev").disabled = historyPage <= 1;
  document.getElementById("history_next").disabled = historyPage >= historyPages;
}
function clearHistoryFilters(){
  ["history_text","history_provider"].forEach(id => document.getElementById(id).value = "");
  ["history_year","history_state","history_alert"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("history_news_only").checked = false;
  loadHistory(1).catch(error => showAlert(error.message, "error"));
}
async function exportHistory(format){
  const params = historyParams(1);
  params.delete("page");
  params.delete("page_size");
  params.set("scope","historial");
  params.set("formato",format);
  const buttonId = format === "xlsx" ? "btn_export_excel" : "btn_export_json";
  const button = document.getElementById(buttonId);
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Preparando archivo...";
  try {
    await fetchDownload(
      `/api/boletin/exportar?${params.toString()}`,
      `historial_boletin.${format === "xlsx" ? "xlsx" : "json"}`
    );
    showAlert(`Exportación ${format === "xlsx" ? "Excel" : "JSON"} descargada correctamente.`, "success");
  } catch(error){
    showAlert(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function openModal(id){
  const modal = document.getElementById(id);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";
}
function closeModal(id){
  const modal = document.getElementById(id);
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden","true");
  if (!document.querySelector(".modal-shell.open")) document.body.style.overflow = "";
}

function bindEvents(){
  document.querySelectorAll(".boletin-tab").forEach(button => button.addEventListener("click", () => setTab(button.dataset.tab)));
  document.getElementById("btn_start_monitor").onclick = startMonitoring;
  document.getElementById("btn_stop_monitor").onclick = stopMonitoring;
  document.getElementById("btn_save_txt").onclick = saveRunTxt;
  document.getElementById("btn_copy_txt").onclick = copyRunTxt;
  document.getElementById("btn_clear_findings").onclick = clearMonitorFindings;
  document.getElementById("btn_tutorial").onclick = () => openModal("tutorial_modal");
  document.getElementById("btn_new_alert").onclick = () => openAlertModal();
  document.getElementById("btn_add_aguas_alert").onclick = addAguasCordobesasAlert;
  document.getElementById("alert_form").addEventListener("submit", saveAlert);
  document.getElementById("btn_history_filter").onclick = () => loadHistory(1).catch(error => showAlert(error.message, "error"));
  document.getElementById("btn_history_clear").onclick = clearHistoryFilters;
  document.getElementById("history_prev").onclick = () => loadHistory(Math.max(1, historyPage - 1)).catch(error => showAlert(error.message, "error"));
  document.getElementById("history_next").onclick = () => loadHistory(Math.min(historyPages, historyPage + 1)).catch(error => showAlert(error.message, "error"));
  document.getElementById("btn_export_json").onclick = () => exportHistory("json");
  document.getElementById("btn_export_excel").onclick = () => exportHistory("xlsx");
  document.getElementById("history_text").addEventListener("keydown", event => { if (event.key === "Enter") loadHistory(1).catch(error => showAlert(error.message, "error")); });

  document.body.addEventListener("click", async event => {
    const detailButton = event.target.closest("[data-detail-id]");
    if (detailButton) return openDetail(Number(detailButton.dataset.detailId));
    const editButton = event.target.closest("[data-alert-edit]");
    if (editButton) return openAlertModal(alerts.find(item => Number(item.id) === Number(editButton.dataset.alertEdit)));
    const stateButton = event.target.closest("[data-alert-state]");
    if (stateButton){
      try { await toggleAlert(Number(stateButton.dataset.alertState), stateButton.dataset.active === "1"); }
      catch(error){ showAlert(error.message, "error"); }
      return;
    }
    const deleteButton = event.target.closest("[data-alert-delete]");
    if (deleteButton){
      try { await deleteAlert(Number(deleteButton.dataset.alertDelete)); }
      catch(error){ showAlert(error.message, "error"); }
      return;
    }
    const closeButton = event.target.closest("[data-close]");
    if (closeButton){
      const modalByName = {detail:"detail_modal", alert:"alert_modal", tutorial:"tutorial_modal"};
      closeModal(modalByName[closeButton.dataset.close] || "tutorial_modal");
    }
  });

  document.getElementById("detail_open_pdf").onclick = () => {
    if (selectedPublication?.source_url) window.open(selectedPublication.source_url, "_blank", "noopener");
  };
  document.getElementById("detail_download_pdf").onclick = downloadSelectedPdf;
  document.getElementById("detail_copy_full").onclick = () => copySelected("text_full", "Resolución completa");
  document.getElementById("detail_copy_resuelve").onclick = () => copySelected("text_resuelve", "Bloque RESUELVE");
  document.getElementById("btn_theme").onclick = () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  document.addEventListener("keydown", event => {
    if (event.key === "Escape"){
      closeModal("detail_modal");
      closeModal("alert_modal");
      closeModal("tutorial_modal");
    }
  });
}

function updateServerGate(title, message, mode="starting"){
  const gate = document.getElementById("server_gate");
  const status = document.getElementById("server_status");
  const titleElement = document.getElementById("server_gate_title");
  const messageElement = document.getElementById("server_gate_message");
  if (titleElement) titleElement.textContent = title;
  if (messageElement) messageElement.textContent = message;
  if (status) status.className = `server-status ${mode}`;
  const statusText = document.getElementById("status");
  if (statusText) statusText.textContent = mode === "online" ? "Buscador listo" : mode === "error" ? "No se pudo iniciar" : "Cargando buscador…";
  if (gate) gate.dataset.mode = mode;
}

function setBackendReady(ready){
  backendReady = ready;
  const app = document.getElementById("boletin_app");
  const gate = document.getElementById("server_gate");
  if (app) app.inert = !ready;
  if (gate) {
    gate.classList.toggle("ready", ready);
    gate.setAttribute("aria-busy", ready ? "false" : "true");
  }
}

function startLoadingMessages(){
  const messages = [
    "Conectando con el buscador…",
    "Preparando la información…",
    "Verificando que todo esté listo…",
    "El buscador estará disponible en breve.",
  ];
  let index = 0;
  const stage = document.getElementById("server_stage");
  if (stage) stage.textContent = messages[0];
  clearInterval(loadingMessageTimer);
  loadingMessageTimer = setInterval(() => {
    index = (index + 1) % messages.length;
    if (stage) stage.textContent = messages[index];
  }, 4200);
  clearTimeout(retryRevealTimer);
  retryRevealTimer = setTimeout(() => {
    const retry = document.getElementById("server_retry");
    if (retry && !backendReady) retry.hidden = false;
  }, 45000);
}

function stopLoadingMessages(){
  clearInterval(loadingMessageTimer);
  clearTimeout(retryRevealTimer);
}

async function healthRequest(){
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(CONFIG.HEALTH_TIMEOUT_MS || 75000));
  try {
    const response = await fetch(apiUrl(CONFIG.HEALTH_PATH || "/api/health"), {
      method:"GET", mode:"cors", cache:"no-store", signal:controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json().catch(() => ({}));
    if (!payload.ok) throw new Error("Respuesta no disponible");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function wakeBackend(){
  if (wakeInProgress) return;
  wakeInProgress = true;
  setBackendReady(false);
  startLoadingMessages();
  updateServerGate(
    "Estamos preparando el buscador",
    "La aplicación se está cargando. Este proceso puede demorar unos segundos la primera vez que ingresás.",
    "starting"
  );
  const retry = document.getElementById("server_retry");
  if (retry) retry.hidden = true;

  try {
    while (!backendReady){
      try {
        await healthRequest();
        setBackendReady(true);
        stopLoadingMessages();
        updateServerGate("Buscador listo", "La aplicación ya está disponible.", "online");
        return;
      } catch(error){
        console.warn("El buscador todavía no está disponible", error);
        await new Promise(resolve => setTimeout(resolve, Number(CONFIG.RETRY_DELAY_MS || 5000)));
      }
    }
  } finally {
    wakeInProgress = false;
  }
}

async function initialize(){
  if (initialized) return;
  initialized = true;
  initTheme();
  initializeYears();
  bindEvents();
  document.getElementById("server_retry").onclick = async () => {
    const retry = document.getElementById("server_retry");
    retry.hidden = true;
    wakeInProgress = false;
    await wakeBackend();
    if (backendReady){
      await Promise.all([loadHealth(), loadAlerts(), loadHistoryFilterOptions(), loadHistory(1)]);
      setTimeout(() => document.getElementById("server_gate")?.classList.add("hidden"), 350);
    }
  };
  try {
    await wakeBackend();
    await Promise.all([loadHealth(), loadAlerts(), loadHistoryFilterOptions(), loadHistory(1)]);
    setTimeout(() => document.getElementById("server_gate")?.classList.add("hidden"), 350);
  } catch(error){
    stopLoadingMessages();
    updateServerGate("No pudimos iniciar el buscador", "Reintentá la conexión. Si el problema continúa, volvé al menú e ingresá más tarde.", "error");
    const retry = document.getElementById("server_retry");
    if (retry) retry.hidden = false;
    showAlert("No fue posible iniciar el buscador.", "error");
  }
}

document.addEventListener("click", event => {
  const sourceButton = event.target.closest("[data-organismo]");
  if (sourceButton) selectOrganism(sourceButton.dataset.organismo);
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
else initialize();
