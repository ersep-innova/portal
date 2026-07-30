document.addEventListener("DOMContentLoaded", () => {
  const year = document.getElementById("current_year");
  if (year) year.textContent = new Date().getFullYear();

  const filterButtons = Array.from(document.querySelectorAll("[data-service-filter]"));
  const toolCards = Array.from(document.querySelectorAll(".tool-card[data-area]"));
  const toolSection = document.querySelector(".tools-section");
  const status = document.getElementById("service_filter_status");
  const clearButton = document.getElementById("clear_service_filter");
  const emptyState = document.getElementById("filter_empty_state");

  if (!filterButtons.length || !toolCards.length) return;

  let activeFilter = null;

  const showAll = ({ focus = false } = {}) => {
    activeFilter = null;
    filterButtons.forEach((button) => button.setAttribute("aria-pressed", "false"));
    toolCards.forEach((card) => { card.hidden = false; });
    if (emptyState) emptyState.hidden = true;
    if (clearButton) clearButton.hidden = true;
    if (status) status.textContent = "Se muestran todas las herramientas.";
    if (focus && toolSection) toolSection.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const applyFilter = (button) => {
    const filter = button.dataset.serviceFilter;
    const label = button.dataset.serviceLabel || button.getAttribute("aria-label") || "el área seleccionada";

    // Volver a pulsar el filtro activo restablece la vista completa.
    if (activeFilter === filter) {
      showAll({ focus: true });
      return;
    }

    activeFilter = filter;
    filterButtons.forEach((item) => {
      item.setAttribute("aria-pressed", String(item === button));
    });

    let visibleCount = 0;
    toolCards.forEach((card) => {
      const matches = card.dataset.area === filter;
      card.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    if (emptyState) emptyState.hidden = visibleCount !== 0;
    if (clearButton) clearButton.hidden = false;
    if (status) {
      const noun = visibleCount === 1 ? "módulo" : "módulos";
      status.textContent = visibleCount
        ? `${label}: ${visibleCount} ${noun}.`
        : `${label}: sin módulos publicados por el momento.`;
    }

    if (toolSection) toolSection.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => applyFilter(button));
  });

  if (clearButton) {
    clearButton.addEventListener("click", () => showAll({ focus: true }));
  }
});
