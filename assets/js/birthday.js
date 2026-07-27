(() => {
  "use strict";

  let BIRTHDAYS = [];
  const ALL_AREAS = "Todas";
  const DAY_MS = 24 * 60 * 60 * 1000;
  let activeArea = ALL_AREAS;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character]);
  }

  function localDateOnly(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  }

  function getNextBirthdayDate(birthday, today) {
    let nextDate = new Date(today.getFullYear(), birthday.month - 1, birthday.day, 12);
    if (nextDate < today) {
      nextDate = new Date(today.getFullYear() + 1, birthday.month - 1, birthday.day, 12);
    }
    return nextDate;
  }

  function getDaysUntil(date, today) {
    return Math.round((date.getTime() - today.getTime()) / DAY_MS);
  }

  function getTrafficLight(days) {
    if (days <= 7) {
      return {
        className: "danger",
        label: days === 0 ? "¡Es hoy!" : "Cumpleaños inminente",
      };
    }
    if (days <= 30) {
      return {
        className: "warning",
        label: "Falta menos de un mes",
      };
    }
    return {
      className: "safe",
      label: "Todavía hay tiempo",
    };
  }

  function formatBirthdayDate(date) {
    return new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(date);
  }

  function formatShortBirthdayDate(date) {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  function formatDays(days) {
    if (days === 0) return "Hoy";
    if (days === 1) return "Mañana";
    return `${days} días`;
  }

  function formatInitials(name) {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0].toUpperCase())
      .join("");
  }

  function getFilteredBirthdays() {
    if (activeArea === ALL_AREAS) return BIRTHDAYS;
    return BIRTHDAYS.filter(item => item.area === activeArea);
  }

  function getBirthdaySchedule() {
    const today = localDateOnly();
    return getFilteredBirthdays()
      .map(birthday => {
        const nextDate = getNextBirthdayDate(birthday, today);
        const days = getDaysUntil(nextDate, today);
        return {
          ...birthday,
          nextDate,
          days,
          trafficLight: getTrafficLight(days),
        };
      })
      .sort((a, b) => a.days - b.days || a.name.localeCompare(b.name, "es"));
  }

  function getAreaOptions() {
    const counts = new Map();
    BIRTHDAYS.forEach(item => counts.set(item.area, (counts.get(item.area) || 0) + 1));
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "es"))
      .map(([name, count]) => ({ name, count }));
  }

  function updateStatus() {
    const filteredCount = getFilteredBirthdays().length;
    const areaCount = getAreaOptions().length;
    const text = activeArea === ALL_AREAS
      ? `${BIRTHDAYS.length} agentes · ${areaCount} Gerencias/Áreas`
      : `${filteredCount} agentes · ${activeArea}`;
    document.getElementById("status").textContent = text;
  }

  function renderAreaFilters() {
    const filters = document.getElementById("area_filters");
    const options = [{ name: ALL_AREAS, count: BIRTHDAYS.length }, ...getAreaOptions()];

    filters.innerHTML = options.map(item => `
      <button
        class="birthday-filter-btn${item.name === activeArea ? " active" : ""}"
        type="button"
        data-area="${escapeHtml(item.name)}"
        aria-pressed="${item.name === activeArea ? "true" : "false"}"
      >${escapeHtml(item.name)} · ${item.count}</button>
    `).join("");

    filters.querySelectorAll("[data-area]").forEach(button => {
      button.addEventListener("click", () => {
        activeArea = button.dataset.area || ALL_AREAS;
        renderAreaFilters();
        renderBirthdayPanel();
      });
    });

    document.getElementById("area_filter_count").textContent =
      `${options.length - 1} Gerencias/Áreas disponibles`;
  }

  function renderSummary(schedule) {
    const filteredBirthdays = getFilteredBirthdays();
    const nextBirthday = schedule[0];
    const currentMonth = new Date().getMonth() + 1;
    const thisMonth = filteredBirthdays.filter(item => item.month === currentMonth);

    if (!nextBirthday) {
      document.getElementById("next_birthday_name").textContent = "Sin registros";
      document.getElementById("next_birthday_date").textContent = "No hay cumpleaños para mostrar.";
      document.getElementById("next_birthday_countdown").textContent = "—";
      document.getElementById("next_birthday_message").textContent = "Seleccioná otra Gerencia o Área.";
      document.getElementById("birthdays_this_month").textContent = "0";
      document.getElementById("birthdays_this_month_detail").textContent = "Cumpleaños registrados este mes";
      return;
    }

    const trafficLight = nextBirthday.trafficLight;
    document.getElementById("next_birthday_name").textContent = nextBirthday.name;
    document.getElementById("next_birthday_date").textContent = formatBirthdayDate(nextBirthday.nextDate);
    document.getElementById("next_birthday_countdown").textContent = formatDays(nextBirthday.days);
    document.getElementById("next_birthday_message").textContent = trafficLight.label;
    document.getElementById("birthdays_this_month").textContent = String(thisMonth.length);
    document.getElementById("birthdays_this_month_detail").textContent =
      thisMonth.length === 1 ? "Cumpleaños registrado este mes" : "Cumpleaños registrados este mes";

    const countdownCard = document.getElementById("countdown_card");
    const countdownDot = document.getElementById("countdown_dot");
    countdownCard.classList.remove("danger", "warning", "safe");
    countdownDot.classList.remove("danger", "warning", "safe");
    countdownCard.classList.add(trafficLight.className);
    countdownDot.classList.add(trafficLight.className);
  }

  function renderBirthdayList(schedule) {
    const list = document.getElementById("birthday_list");

    if (!schedule.length) {
      list.innerHTML = '<div class="birthday-empty">No hay cumpleaños registrados para el filtro seleccionado.</div>';
      return;
    }

    list.innerHTML = schedule.map((birthday, index) => {
      const isNext = index === 0;
      const nextBadge = isNext ? '<span class="birthday-next-badge">Próximo</span>' : "";

      return `
        <article class="birthday-person ${birthday.trafficLight.className}${isNext ? " is-next" : ""}">
          <div class="birthday-avatar" aria-hidden="true">${escapeHtml(formatInitials(birthday.name))}</div>
          <div>
            <strong class="birthday-person-name">${escapeHtml(birthday.name)}</strong>
            <span class="birthday-person-date">${escapeHtml(formatShortBirthdayDate(birthday.nextDate))}</span>
            <span class="birthday-person-area">${escapeHtml(birthday.area)} · ${escapeHtml(birthday.location)}</span>
            ${nextBadge}
          </div>
          <div class="birthday-days">
            <strong>${escapeHtml(formatDays(birthday.days))}</strong>
            <span>${escapeHtml(birthday.trafficLight.label)}</span>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderBirthdayPanel() {
    const schedule = getBirthdaySchedule();
    renderSummary(schedule);
    renderBirthdayList(schedule);

    const selectedLabel = activeArea === ALL_AREAS ? "todo ERSeP" : activeArea;
    document.getElementById("birthday_list_subtitle").textContent =
      `Mostrando ${schedule.length} cumpleaños de ${selectedLabel}, ordenados desde el más cercano al más lejano.`;

    const now = new Date();
    updateStatus();
    document.getElementById("birthday_updated_at").textContent =
      `Consulta calculada al ${new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(now)}.`;
  }

  function renderBarChart(containerId, entries, formatter = value => value) {
    const container = document.getElementById(containerId);
    const max = Math.max(...entries.map(item => item.value), 1);
    container.innerHTML = entries.map(item => `
      <div class="bar-row"><span class="bar-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
      <div class="bar-track"><span class="bar-fill" style="width:${Math.max(3, item.value / max * 100)}%"></span></div>
      <strong>${escapeHtml(formatter(item.value))}</strong></div>`).join("");
  }

  function renderAnalytics() {
    const schedule = getBirthdaySchedule();
    const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    const months = monthNames.map((label, index) => ({ label, value: BIRTHDAYS.filter(x => x.month === index + 1).length }));
    const peak = months.reduce((a,b) => b.value > a.value ? b : a, months[0]);
    const areas = Array.from(BIRTHDAYS.reduce((map,x) => map.set(x.area,(map.get(x.area)||0)+1),new Map()).entries())
      .map(([label,value]) => ({label,value})).sort((a,b)=>b.value-a.value).slice(0,8);
    document.getElementById("stat_total").textContent = BIRTHDAYS.length;
    document.getElementById("stat_peak_month").textContent = `${peak.label} · ${peak.value}`;
    document.getElementById("stat_next_30").textContent = schedule.filter(x => x.days <= 30).length;
    document.getElementById("stat_locations").textContent = new Set(BIRTHDAYS.map(x => x.location)).size;
    renderBarChart("chart_months", months);
    renderBarChart("chart_areas", areas);
  }

  async function loadEncryptedBirthdays() {
    const password = window.ERSEP_AUTH?.getPassword();
    if (!password) { location.href = "../../"; return false; }
    const response = await fetch("../../assets/data/cumpleanos.enc.json", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar la nómina cifrada.");
    const payload = await response.json();
    BIRTHDAYS = await window.ERSEP_AUTH.decryptPayload(payload, password);
    return Array.isArray(BIRTHDAYS);
  }

  async function init() {
    try { await loadEncryptedBirthdays(); } catch (error) {
      document.getElementById("status").textContent = "Error de acceso a la nómina";
      document.getElementById("birthday_list").innerHTML = `<div class="birthday-empty">${escapeHtml(error.message)}</div>`;
      return;
    }
    if (!BIRTHDAYS.length) {
      document.getElementById("status").textContent = "No se pudo cargar la nómina";
      document.getElementById("birthday_list").innerHTML =
        '<div class="birthday-empty">No se encontraron datos de cumpleaños.</div>';
      return;
    }

    renderAreaFilters();
    renderBirthdayPanel();
    renderAnalytics();

    let renderedDay = localDateOnly().getTime();
    setInterval(() => {
      const currentDay = localDateOnly().getTime();
      if (currentDay !== renderedDay) {
        renderedDay = currentDay;
        renderBirthdayPanel();
      }
    }, 60 * 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
