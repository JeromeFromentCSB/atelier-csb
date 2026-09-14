/*
 * Remplacement de window.prompt() — Electron ne l'implémente pas (contrairement à alert/confirm),
 * il retourne silencieusement null sans jamais rien afficher. Ce module injecte une petite
 * fenêtre de saisie autonome (HTML/CSS injectés en JS, sans dépendance aux styles de la page
 * qui l'utilise) et expose window.customPrompt(message, defaultValue) avec la même signature
 * que prompt(), mais async : à utiliser avec `await customPrompt(...)`.
 *
 * Les éléments DOM sont créés à la première utilisation (pas au chargement du script), pour ne
 * pas dépendre de l'endroit où <script src="csb-prompt.js"> est placé dans la page (avant ou
 * après <body>).
 */
(function (global) {
  if (global.customPrompt) return;

  let overlay, msgEl, inputEl, okBtn, cancelBtn;

  function ensureBuilt() {
    if (overlay) return;

    const style = document.createElement('style');
    style.textContent = `
      #csbPromptOverlay{
        position:fixed; inset:0; background:rgba(20,20,20,.5); z-index:9999;
        display:none; align-items:center; justify-content:center; padding:20px;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
      }
      #csbPromptOverlay.show{ display:flex; }
      #csbPromptBox{
        background:#fff; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,.35);
        width:min(380px,100%); padding:20px 22px;
      }
      #csbPromptMsg{ font-size:14px; color:#222; margin:0 0 12px; white-space:pre-line; }
      #csbPromptInput{
        width:100%; font-size:14px; padding:9px 11px; border:1.5px solid #ccc; border-radius:7px;
        box-sizing:border-box; font-family:inherit;
      }
      #csbPromptInput:focus{ outline:2px solid #8a6dd6; outline-offset:1px; }
      #csbPromptActions{ display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
      #csbPromptActions button{
        font-family:inherit; font-size:13px; font-weight:600; padding:8px 16px; border-radius:7px;
        cursor:pointer; border:1px solid #ccc; background:#fff; color:#222;
      }
      #csbPromptOkBtn{ background:#2d2a26; color:#fff; border-color:#2d2a26; }
    `;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'csbPromptOverlay';
    overlay.innerHTML = `
      <div id="csbPromptBox">
        <p id="csbPromptMsg"></p>
        <input type="text" id="csbPromptInput">
        <div id="csbPromptActions">
          <button type="button" id="csbPromptCancelBtn">Annuler</button>
          <button type="button" id="csbPromptOkBtn">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    msgEl = overlay.querySelector('#csbPromptMsg');
    inputEl = overlay.querySelector('#csbPromptInput');
    okBtn = overlay.querySelector('#csbPromptOkBtn');
    cancelBtn = overlay.querySelector('#csbPromptCancelBtn');
  }

  function customPrompt(message, defaultValue) {
    ensureBuilt();
    return new Promise((resolve) => {
      msgEl.textContent = message || '';
      inputEl.value = defaultValue != null ? defaultValue : '';
      inputEl.type = /code|pin|mot de passe/i.test(message || '') ? 'password' : 'text';
      overlay.classList.add('show');
      inputEl.focus();
      inputEl.select();

      function cleanup(result) {
        overlay.classList.remove('show');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        inputEl.removeEventListener('keydown', onKeydown);
        overlay.removeEventListener('mousedown', onOverlayClick);
        resolve(result);
      }
      function onOk() { cleanup(inputEl.value); }
      function onCancel() { cleanup(null); }
      function onKeydown(e) {
        if (e.key === 'Enter') { e.preventDefault(); onOk(); }
        else if (e.key === 'Escape') { onCancel(); }
      }
      function onOverlayClick(e) { if (e.target === overlay) onCancel(); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      inputEl.addEventListener('keydown', onKeydown);
      overlay.addEventListener('mousedown', onOverlayClick);
    });
  }

  global.customPrompt = customPrompt;
})(window);
