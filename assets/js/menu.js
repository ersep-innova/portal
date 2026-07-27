document.addEventListener("DOMContentLoaded", () => {
  const year = document.getElementById("current_year");
  if (year) year.textContent = new Date().getFullYear();
});
