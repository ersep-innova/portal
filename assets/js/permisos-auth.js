(() => {
  "use strict";

  let currentUser = null;

  function emitAuthChanged() {
    window.dispatchEvent(new CustomEvent("permisos:auth", { detail: currentUser }));
  }

  function setLoginStatus(message = "", type = "") {
    const el = document.getElementById("login_status");
    if (!el) return;
    el.textContent = message;
    el.className = `perm-login-status ${type}`.trim();
  }

  async function loadMe() {
    if (!window.PermisosAPI.getToken()) return null;
    try {
      currentUser = await window.PermisosAPI.request("/api/auth/me");
      emitAuthChanged();
      return currentUser;
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.PermisosAPI.clearToken();
        currentUser = null;
        emitAuthChanged();
      }
      throw error;
    }
  }

  async function login(usuario, clave) {
    const result = await window.PermisosAPI.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ usuario, clave }),
    });
    if (!result?.token || !result?.user) {
      throw new Error("El backend no devolvió una sesión válida.");
    }
    window.PermisosAPI.setToken(result.token);
    currentUser = result.user;
    setLoginStatus("");
    emitAuthChanged();
    return currentUser;
  }

  async function logout() {
    try {
      if (window.PermisosAPI.getToken()) {
        await window.PermisosAPI.request("/api/auth/logout", { method: "POST" });
      }
    } catch (_) {
      // El cierre local debe funcionar aunque Render esté dormido o sin conexión.
    } finally {
      window.PermisosAPI.clearToken();
      currentUser = null;
      emitAuthChanged();
    }
  }

  function bindLoginForm() {
    const form = document.getElementById("local_login_form");
    if (!form || form.dataset.bound === "1") return;
    form.dataset.bound = "1";

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const userInput = document.getElementById("login_usuario");
      const passInput = document.getElementById("login_clave");
      const submit = document.getElementById("login_submit");
      const usuario = userInput?.value.trim() || "";
      const clave = passInput?.value || "";
      if (!usuario || !clave) {
        setLoginStatus("Ingresá usuario y clave.", "error");
        return;
      }

      submit.disabled = true;
      submit.textContent = "Ingresando…";
      setLoginStatus("Conectando con el sistema…");
      try {
        await login(usuario, clave);
        passInput.value = "";
      } catch (error) {
        setLoginStatus(error.message || "No fue posible iniciar sesión.", "error");
      } finally {
        submit.disabled = false;
        submit.textContent = "Ingresar";
      }
    });
  }

  window.PermisosAuth = {
    bindLoginForm,
    loadMe,
    login,
    logout,
    getUser: () => currentUser,
    hasRole(role) {
      return !!currentUser?.roles?.includes(role);
    },
  };
})();
