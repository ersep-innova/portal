(() => {
  "use strict";

  const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const DAY_MS = 24 * 60 * 60 * 1000;
  let birthdays = [];
  let areaFilter = "";
  let locationFilter = "";
  let searchFilter = "";
  let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let detailMonth = new Date().getMonth();
  let initialized = false;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es")
      .trim();
  }

  function localDateOnly(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  }

  function getNextBirthdayDate(birthday, today = localDateOnly()) {
    let nextDate = new Date(today.getFullYear(), birthday.month - 1, birthday.day, 12);
    if (nextDate < today) nextDate = new Date(today.getFullYear() + 1, birthday.month - 1, birthday.day, 12);
    return nextDate;
  }

  function getDaysUntil(date, today = localDateOnly()) {
    return Math.round((date.getTime() - today.getTime()) / DAY_MS);
  }

  function getTrafficLight(days) {
    if (days <= 7) return { className: "danger", label: days === 0 ? "¡Es hoy!" : "Muy próximo" };
    if (days <= 30) return { className: "warning", label: "Se acerca" };
    return { className: "safe", label: "Más adelante" };
  }

  function formatDays(days) {
    if (days === 0) return "Hoy";
    if (days === 1) return "Mañana";
    return `${days} días`;
  }

  function formatBirthdayDate(date) {
    return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(date);
  }

  function formatShortBirthdayDate(date) {
    return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "long", year: "numeric" }).format(date);
  }

  function formatInitials(name) {
    return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("");
  }

  function filteredBirthdays() {
    const needle = normalize(searchFilter);
    return birthdays.filter(item => {
      if (areaFilter && item.area !== areaFilter) return false;
      if (locationFilter && item.location !== locationFilter) return false;
      if (needle && !normalize(item.name).includes(needle)) return false;
      return true;
    });
  }

  function birthdaySchedule(items = filteredBirthdays()) {
    const today = localDateOnly();
    return items.map(item => {
      const nextDate = getNextBirthdayDate(item, today);
      const days = getDaysUntil(nextDate, today);
      return { ...item, nextDate, days, trafficLight: getTrafficLight(days) };
    }).sort((a, b) => a.days - b.days || a.name.localeCompare(b.name, "es"));
  }

  function uniqueSorted(field) {
    return [...new Set(birthdays.map(item => item[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  }

  function populateFilters() {
    const area = document.getElementById("area_filter");
    const location = document.getElementById("location_filter");
    area.innerHTML = '<option value="">Todas las dependencias</option>' + uniqueSorted("area").map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    location.innerHTML = '<option value="">Todas las sedes</option>' + uniqueSorted("location").map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  }

  function updateFilterStatus(items) {
    document.getElementById("filter_count").textContent = `${items.length} de ${birthdays.length} personas`;
    document.getElementById("status").textContent = `${items.length} personas visibles`;
    document.getElementById("filter_message").hidden = items.length > 0;
  }

  function renderSummary(items, schedule) {
    const next = schedule[0];
    const currentMonth = new Date().getMonth() + 1;
    const thisMonth = items.filter(item => item.month === currentMonth);
    const countdownCard = document.getElementById("countdown_card");
    const countdownDot = document.getElementById("countdown_dot");

    countdownCard.classList.remove("danger", "warning", "safe");
    countdownDot.classList.remove("danger", "warning", "safe");

    if (!next) {
      document.getElementById("next_birthday_name").textContent = "Sin coincidencias";
      document.getElementById("next_birthday_date").textContent = "Probá con otros filtros.";
      document.getElementById("next_birthday_countdown").textContent = "—";
      document.getElementById("next_birthday_message").textContent = "No hay cumpleaños visibles";
      document.getElementById("birthdays_this_month").textContent = "0";
      document.getElementById("birthdays_this_month_detail").textContent = "Cumpleaños visibles este mes";
      return;
    }

    document.getElementById("next_birthday_name").textContent = next.name;
    document.getElementById("next_birthday_date").textContent = formatBirthdayDate(next.nextDate);
    document.getElementById("next_birthday_countdown").textContent = formatDays(next.days);
    document.getElementById("next_birthday_message").textContent = next.trafficLight.label;
    document.getElementById("birthdays_this_month").textContent = String(thisMonth.length);
    document.getElementById("birthdays_this_month_detail").textContent = thisMonth.length === 1 ? "Cumpleaños visible este mes" : "Cumpleaños visibles este mes";
    countdownCard.classList.add(next.trafficLight.className);
    countdownDot.classList.add(next.trafficLight.className);
  }

  function renderBirthdayList(schedule) {
    const list = document.getElementById("birthday_list");
    if (!schedule.length) {
      list.innerHTML = '<div class="birthday-empty">No se encontraron cumpleaños con la búsqueda y los filtros seleccionados.</div>';
      return;
    }

    list.innerHTML = schedule.map((birthday, index) => `
      <article class="birthday-person ${birthday.trafficLight.className}${index === 0 ? " is-next" : ""}">
        <div class="birthday-avatar" aria-hidden="true">${escapeHtml(formatInitials(birthday.name))}</div>
        <div>
          <strong class="birthday-person-name">${escapeHtml(birthday.name)}</strong>
          <span class="birthday-person-date">${escapeHtml(formatShortBirthdayDate(birthday.nextDate))}</span>
          <span class="birthday-person-area">${escapeHtml(birthday.area)} · ${escapeHtml(birthday.location)}</span>
          ${index === 0 ? '<span class="birthday-next-badge">Próximo</span>' : ""}
        </div>
        <div class="birthday-days"><strong>${escapeHtml(formatDays(birthday.days))}</strong><span>${escapeHtml(birthday.trafficLight.label)}</span></div>
      </article>
    `).join("");
  }

  function renderBarChart(containerId, entries) {
    const container = document.getElementById(containerId);
    const max = Math.max(...entries.map(item => item.value), 1);
    if (!entries.length) {
      container.innerHTML = '<div class="birthday-empty compact">Sin datos para mostrar.</div>';
      return;
    }
    container.innerHTML = entries.map(item => `
      <div class="bar-row">
        <span class="bar-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
        <div class="bar-track"><span class="bar-fill" style="width:${item.value ? Math.max(4, item.value / max * 100) : 0}%"></span></div>
        <strong>${item.value}</strong>
      </div>
    `).join("");
  }

  function renderMonthDetail(items, monthIndex = detailMonth) {
    detailMonth = monthIndex;
    const monthItems = items.filter(item => item.month === monthIndex + 1).sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, "es"));
    document.querySelectorAll("[data-month-index]").forEach(button => button.classList.toggle("active", Number(button.dataset.monthIndex) === monthIndex));
    const detail = document.getElementById("month_detail");
    detail.innerHTML = `
      <div class="month-detail-heading"><strong>${MONTH_NAMES[monthIndex]}</strong><span>${monthItems.length} ${monthItems.length === 1 ? "cumpleaños" : "cumpleaños"}</span></div>
      ${monthItems.length ? `<ul>${monthItems.map(item => `<li><b>${item.day}</b><span>${escapeHtml(item.name)}</span><small>${escapeHtml(item.area)}</small></li>`).join("")}</ul>` : '<p>No hay cumpleaños visibles en este mes.</p>'}
    `;
  }

  function renderMonthChart(items) {
    const counts = MONTH_NAMES.map((label, index) => {
      const people = items.filter(item => item.month === index + 1);
      return { label, index, value: people.length, people };
    });
    const max = Math.max(...counts.map(item => item.value), 1);
    const container = document.getElementById("chart_months");
    container.innerHTML = counts.map(item => {
      const title = item.people.length ? item.people.map(person => `${person.day}: ${person.name}`).join(" · ") : "Sin cumpleaños";
      return `<button class="month-bar" type="button" data-month-index="${item.index}" style="--bar-size:${item.value / max * 100}%" title="${escapeHtml(title)}" aria-label="${item.label}: ${item.value} cumpleaños">
        <span class="month-bar-value">${item.value}</span><span class="month-bar-track"><span></span></span><span class="month-bar-label">${item.label.slice(0, 3)}</span>
      </button>`;
    }).join("");
    container.querySelectorAll("[data-month-index]").forEach(button => {
      const show = () => renderMonthDetail(items, Number(button.dataset.monthIndex));
      button.addEventListener("mouseenter", show);
      button.addEventListener("focus", show);
      button.addEventListener("click", show);
    });
    renderMonthDetail(items, detailMonth);
    return counts;
  }

  function renderAnalytics(items, schedule) {
    const months = renderMonthChart(items);
    const peak = months.reduce((best, item) => item.value > best.value ? item : best, months[0]);
    const areas = [...items.reduce((map, item) => map.set(item.area, (map.get(item.area) || 0) + 1), new Map()).entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"))
      .slice(0, 10);

    document.getElementById("stat_total").textContent = String(items.length);
    document.getElementById("stat_peak_month").textContent = items.length ? `${peak.label} · ${peak.value}` : "—";
    document.getElementById("stat_next_30").textContent = String(schedule.filter(item => item.days <= 30).length);
    document.getElementById("stat_locations").textContent = String(new Set(items.map(item => item.location)).size);
    renderBarChart("chart_areas", areas);
  }

  function renderCalendar(items) {
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = localDateOnly();
    const byDay = new Map();
    items.filter(item => item.month === month + 1).forEach(item => {
      if (!byDay.has(item.day)) byDay.set(item.day, []);
      byDay.get(item.day).push(item);
    });

    document.getElementById("calendar_title").textContent = `${MONTH_NAMES[month]} ${year}`;
    const cells = [];
    for (let index = 0; index < firstWeekday; index += 1) cells.push('<span class="calendar-empty" aria-hidden="true"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const people = (byDay.get(day) || []).sort((a, b) => a.name.localeCompare(b.name, "es"));
      const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
      const tooltip = people.length ? `<span class="calendar-tooltip"><strong>${day} de ${MONTH_NAMES[month]}</strong>${people.map(person => `<span>${escapeHtml(person.name)}<small>${escapeHtml(person.area)}</small></span>`).join("")}</span>` : "";
      cells.push(`<button type="button" class="calendar-day${people.length ? " has-birthday" : ""}${isToday ? " is-today" : ""}" data-calendar-day="${day}" ${people.length ? `aria-label="${day} de ${MONTH_NAMES[month]}: ${escapeHtml(people.map(person => person.name).join(", "))}"` : `aria-label="${day} de ${MONTH_NAMES[month]}, sin cumpleaños"`}>
        <span class="calendar-day-number">${day}</span>${people.length ? `<span class="calendar-marker">${people.length}</span>` : ""}${tooltip}
      </button>`);
    }
    document.getElementById("calendar_grid").innerHTML = cells.join("");

    document.querySelectorAll(".calendar-day.has-birthday").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        const open = button.classList.contains("tooltip-open");
        document.querySelectorAll(".calendar-day.tooltip-open").forEach(item => item.classList.remove("tooltip-open"));
        if (!open) button.classList.add("tooltip-open");
      });
    });
  }

  function renderAll() {
    const items = filteredBirthdays();
    const schedule = birthdaySchedule(items);
    updateFilterStatus(items);
    renderSummary(items, schedule);
    renderCalendar(items);
    renderAnalytics(items, schedule);
    renderBirthdayList(schedule);

    const description = [];
    if (searchFilter) description.push(`nombre “${searchFilter}”`);
    if (areaFilter) description.push(areaFilter);
    if (locationFilter) description.push(locationFilter);
    document.getElementById("birthday_list_subtitle").textContent = `Mostrando ${schedule.length} cumpleaños${description.length ? ` para ${description.join(" · ")}` : " de todo ERSeP"}, ordenados por cercanía.`;
    document.getElementById("birthday_updated_at").textContent = `Consulta calculada al ${new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date())}.`;
  }

  function bindControls() {
    document.getElementById("birthday_search").addEventListener("input", event => {
      searchFilter = event.target.value;
      renderAll();
    });
    document.getElementById("area_filter").addEventListener("change", event => {
      areaFilter = event.target.value;
      renderAll();
    });
    document.getElementById("location_filter").addEventListener("change", event => {
      locationFilter = event.target.value;
      renderAll();
    });
    document.getElementById("reset_filters").addEventListener("click", () => {
      areaFilter = "";
      locationFilter = "";
      searchFilter = "";
      document.getElementById("birthday_search").value = "";
      document.getElementById("area_filter").value = "";
      document.getElementById("location_filter").value = "";
      renderAll();
    });
    document.getElementById("calendar_prev").addEventListener("click", () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
      renderCalendar(filteredBirthdays());
    });
    document.getElementById("calendar_next").addEventListener("click", () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
      renderCalendar(filteredBirthdays());
    });
    document.getElementById("calendar_today").addEventListener("click", () => {
      calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      renderCalendar(filteredBirthdays());
    });
    document.addEventListener("click", () => {
      document.querySelectorAll(".calendar-day.tooltip-open").forEach(item => item.classList.remove("tooltip-open"));
    });
  }

  async function loadEncryptedBirthdays() {
    const response = await fetch("../../assets/data/cumpleanos.enc.json", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar la nómina cifrada.");
    const payload = await response.json();
    const result = await window.ERSEP_AUTH.decryptPayload(payload);
    if (!Array.isArray(result)) throw new Error("La nómina cifrada no tiene un formato válido.");
    return result;
  }

  async function initializeBirthdayPanel() {
    if (initialized) return;
    initialized = true;
    try {
      birthdays = await loadEncryptedBirthdays();
      populateFilters();
      bindControls();
      renderAll();
    } catch (error) {
      initialized = false;
      document.getElementById("status").textContent = "No se pudo abrir la agenda";
      document.getElementById("birthday_list").innerHTML = `<div class="birthday-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  document.addEventListener("ersep-authenticated", initializeBirthdayPanel);
  if (window.ERSEP_AUTH?.isUnlocked?.()) initializeBirthdayPanel();
})();
