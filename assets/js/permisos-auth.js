(() => {
  "use strict";

  const cfg = window.ERSEP_PERMISOS_CONFIG;
  let currentUser = null;

  function emitAuthChanged() {
    window.dispatchEvent(new CustomEvent("permisos:auth", { detail: currentUser }));
  }

  async function loadMe() {
    if (!window.PermisosAPI.getToken()) return null;
    try {
      currentUser = await window.PermisosAPI.request("/api/auth/me");
      emitAuthChanged();
      return currentUser;
    } catch (error) {
      if (error.status === 401 || error.status === 403) logout(false);
      throw error;
    }
  }

  async function handleCredentialResponse(response) {
    if (!response?.credential) return;
    window.PermisosAPI.setToken(response.credential);
    try {
      await loadMe();
    } catch (error) {
      window.PermisosAPI.clearToken();
      currentUser = null;
      emitAuthChanged();
      window.dispatchEvent(new CustomEvent("permisos:error", {
        detail: error.message || "No fue posible validar tu cuenta."
      }));
    }
  }

  function renderGoogleButton() {
    const target = document.getElementById("google_signin_button");
    if (!target) return;

    if (!cfg.GOOGLE_CLIENT_ID || cfg.GOOGLE_CLIENT_ID.startsWith("REEMPLAZAR_")) {
      target.innerHTML = '<div class="auth-setup-warning">Configurá <code>GOOGLE_CLIENT_ID</code> en <code>permisos-config.js</code> para habilitar el acceso.</div>';
      return;
    }

    if (!window.google?.accounts?.id) {
      setTimeout(renderGoogleButton, 250);
      return;
    }

    google.accounts.id.initialize({
      client_id: cfg.GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true
    });

    target.innerHTML = "";
    google.accounts.id.renderButton(target, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "signin_with",
      locale: "es",
      width: 280
    });
  }

  function logout(revoke = false) {
    const token = window.PermisosAPI.getToken();
    if (revoke && token && window.google?.accounts?.id) {
      google.accounts.id.disableAutoSelect();
    }
    window.PermisosAPI.clearToken();
    currentUser = null;
    emitAuthChanged();
  }

  window.PermisosAuth = {
    renderGoogleButton,
    loadMe,
    logout,
    getUser: () => currentUser,
    hasRole(role) {
      return !!currentUser?.roles?.includes(role);
    }
  };
})();
