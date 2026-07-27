(() => {
  "use strict";
  const SESSION_KEY = "ersep-observatorio-session-password";
  const config = window.ERSEP_AUTH_CONFIG;

  const b64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const textDecoder = new TextDecoder();

  async function deriveKey(password) {
    const material = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64(config.salt), iterations: config.iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function decryptPayload(payload, password) {
    const key = await deriveKey(password);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64(payload.iv) },
      key,
      b64(payload.ciphertext)
    );
    return JSON.parse(textDecoder.decode(plain));
  }

  async function validatePassword(password) {
    try {
      const result = await decryptPayload({
        iv: config.verifierIv,
        ciphertext: config.verifierCiphertext
      }, password);
      return result?.ok === true;
    } catch (_) {
      return false;
    }
  }

  function revealPortal() {
    document.documentElement.classList.add("authenticated");
    document.querySelectorAll("[data-protected]").forEach(el => el.hidden = false);
    const gate = document.getElementById("auth_gate");
    if (gate) gate.hidden = true;
  }

  function lockPortal() {
    sessionStorage.removeItem(SESSION_KEY);
    location.href = document.body.dataset.loginPath || "./";
  }

  async function init() {
    const gate = document.getElementById("auth_gate");
    const form = document.getElementById("auth_form");
    const input = document.getElementById("auth_password");
    const error = document.getElementById("auth_error");
    const saved = sessionStorage.getItem(SESSION_KEY);

    if (saved && await validatePassword(saved)) {
      revealPortal();
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      if (!gate) {
        location.href = document.body.dataset.loginPath || "../../";
        return;
      }
      gate.hidden = false;
      setTimeout(() => input?.focus(), 50);
    }

    form?.addEventListener("submit", async event => {
      event.preventDefault();
      const password = input.value;
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      button.textContent = "Verificando…";
      error.textContent = "";
      if (await validatePassword(password)) {
        sessionStorage.setItem(SESSION_KEY, password);
        input.value = "";
        revealPortal();
        document.dispatchEvent(new CustomEvent("ersep-authenticated"));
      } else {
        error.textContent = "Contraseña incorrecta.";
        input.select();
      }
      button.disabled = false;
      button.textContent = "Ingresar";
    });

    document.querySelectorAll("[data-logout]").forEach(btn => btn.addEventListener("click", lockPortal));
  }

  window.ERSEP_AUTH = {
    getPassword: () => sessionStorage.getItem(SESSION_KEY),
    decryptPayload,
    validatePassword,
    logout: lockPortal
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
