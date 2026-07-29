(() => {
  "use strict";

  const config = window.ERSEP_AUTH_CONFIG;
  let activeKey = null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const fromBase64 = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));

  async function deriveKey(password) {
    if (!config) throw new Error("No se encontró la configuración de acceso.");
    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: fromBase64(config.salt),
        iterations: config.iterations,
        hash: "SHA-256",
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function decryptWithKey(payload, key) {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(payload.iv) },
      key,
      fromBase64(payload.ciphertext)
    );
    return JSON.parse(decoder.decode(plain));
  }

  async function unlock(password) {
    try {
      const candidateKey = await deriveKey(password);
      const verifier = await decryptWithKey(
        { iv: config.verifierIv, ciphertext: config.verifierCiphertext },
        candidateKey
      );
      if (verifier?.ok !== true) return false;
      activeKey = candidateKey;
      return true;
    } catch (_) {
      activeKey = null;
      return false;
    }
  }

  async function decryptPayload(payload) {
    if (!activeKey) throw new Error("Primero debés validar el acceso a cumpleaños.");
    return decryptWithKey(payload, activeKey);
  }

  function revealProtectedContent() {
    document.documentElement.classList.add("authenticated");
    document.querySelectorAll("[data-protected]").forEach(element => {
      element.hidden = false;
    });
    const gate = document.getElementById("auth_gate");
    if (gate) gate.hidden = true;
  }

  function lock() {
    activeKey = null;
    document.documentElement.classList.remove("authenticated");
    window.location.reload();
  }

  function init() {
    if (document.body.dataset.authRequired !== "birthdays") return;

    const gate = document.getElementById("auth_gate");
    const form = document.getElementById("auth_form");
    const input = document.getElementById("auth_password");
    const error = document.getElementById("auth_error");
    const button = form?.querySelector("button[type=submit]");

    if (gate) gate.hidden = false;
    setTimeout(() => input?.focus(), 80);

    form?.addEventListener("submit", async event => {
      event.preventDefault();
      if (!input || !button) return;

      button.disabled = true;
      button.textContent = "Verificando…";
      if (error) error.textContent = "";

      const valid = await unlock(input.value);
      if (valid) {
        input.value = "";
        revealProtectedContent();
        document.dispatchEvent(new CustomEvent("ersep-authenticated"));
      } else {
        if (error) error.textContent = "Contraseña incorrecta.";
        input.select();
      }

      button.disabled = false;
      button.textContent = "Ingresar a cumpleaños";
    });

    document.querySelectorAll("[data-lock]").forEach(element => {
      element.addEventListener("click", lock);
    });
  }

  window.ERSEP_AUTH = {
    decryptPayload,
    isUnlocked: () => Boolean(activeKey),
    lock,
    unlock,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
