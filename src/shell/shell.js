(function () {
  const MODULES = [
    { id: 'axonaut', label: 'Gestion Commande', icon: '📦', path: '../../modules/axonaut/index.html', perms: [
      { key: 'devis', label: 'Onglet Devis' },
      { key: 'commandes', label: 'Onglet Commande' },
      { key: 'facture', label: 'Onglet Facture' },
      { key: 'etiquettes', label: 'Gestion des étiquettes' },
      { key: 'devis_pdf', label: 'Voir le PDF du devis' },
      { key: 'settings', label: 'Réglages (⚙︎)' },
      { key: 'addressbook', label: "Carnet d'adresses" },
      { key: 'photos_supprimer', label: 'Supprimer une photo de commande' }
    ] },
    { id: 'casaque', label: 'Gestion Casaque', icon: '🏇', path: '../../modules/casaque/index.html', perms: [
      { key: 'coussin_trousse', label: 'Modifier Coussin / Trousse' },
      { key: 'labels', label: 'Étiquettes Colissimo' },
      { key: 'export', label: 'Bouton Exporter (.xlsx)' },
      { key: 'export_alertes', label: 'Bouton Exporter les alertes' },
      { key: 'doublons', label: 'Bouton Doublons probables' }
    ] },
    { id: 'inventaire', label: 'Inventaire', icon: '🗂️', path: '../../modules/inventaire/index.html', perms: [
      { key: 'catalogue', label: 'Onglet Catalogue fournisseurs' },
      { key: 'recherche', label: 'Onglet Recherche' },
      { key: 'parametres', label: 'Onglet Paramètres' },
      { key: 'export', label: 'Exporter une sauvegarde' },
      { key: 'import', label: 'Importer une sauvegarde' }
    ] },
    { id: 'stock_fil', label: 'Stock de Fil', icon: '🧵', path: '../../modules/stock_fil/index.html', perms: [
      { key: 'stock', label: 'Onglet État du stock' },
      { key: 'mouvements', label: 'Onglet Mouvements' },
      { key: 'recherche', label: 'Onglet Recherche' },
      { key: 'nuancier', label: 'Onglet Nuancier' },
      { key: 'trouver_couleur', label: 'Onglet Trouver couleur' },
      { key: 'parametres', label: 'Onglet Paramètres' },
      { key: 'export', label: 'Exporter une sauvegarde' },
      { key: 'import', label: 'Importer une sauvegarde' }
    ] },
    { id: 'simulateur', label: 'Simulateur marquage', icon: '👕', path: '../../modules/simulateur/index.html', perms: [] },
    { id: 'prospection', label: 'Prospection', icon: '📍', path: '../../modules/prospection/index.html', perms: [] },
    { id: 'pointage', label: 'Pointage', icon: '🕒', path: '../../modules/pointage/index.html', perms: [] },
    { id: 'email', label: 'Email', icon: '✉️', path: '../../modules/email/index.html', perms: [] },
    // Axonaut lui-même (le vrai site, via une webview) — pour les écrans que notre intégration
    // API ne couvre pas encore. Session de connexion propre à cet onglet, indépendante de
    // notre appli (comme un onglet de navigateur classique).
    { id: 'axonaut_web', label: 'Axonaut', icon: '🌐', type: 'webview', url: 'https://axonaut.com/dashboard/index', perms: [] },
    { id: 'fournisseurs', label: 'Fournisseurs', icon: '🏭', type: 'webview', browser: true, perms: [],
      sites: [
        { label: 'TopTex', url: 'https://www.toptex.fr' },
        { label: 'Valento', url: 'https://www.valento.fr' },
        { label: 'Imbretex', url: 'https://www.imbretex.fr' },
        { label: 'Falk & Ross', url: 'https://www.falkross.com' },
        { label: 'Safety Jogger', url: 'https://www.safetyjogger.com' }
      ] }
  ];

  const loginOverlay = document.getElementById('loginOverlay');
  const loginForm = document.getElementById('loginForm');
  const loginIdentity = document.getElementById('loginIdentity');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const loginSubmitBtn = document.getElementById('loginSubmitBtn');
  const loginSettingsToggle = document.getElementById('loginSettingsToggle');
  const loginSettings = document.getElementById('loginSettings');
  const loginPbUrl = document.getElementById('loginPbUrl');
  const loginPbSaveBtn = document.getElementById('loginPbSaveBtn');

  const moduleNav = document.getElementById('moduleNav');
  const main = document.getElementById('main');
  const userMenuWrap = document.getElementById('userMenuWrap');
  const userMenuBtn = document.getElementById('userMenuBtn');
  const userMenuDropdown = document.getElementById('userMenuDropdown');
  const userMenuName = document.getElementById('userMenuName');
  const userMenuRole = document.getElementById('userMenuRole');
  const logoutBtn = document.getElementById('logoutBtn');

  let activeModuleId = null;

  loginPbUrl.value = CSBAuth.getPbUrl();

  async function populateLoginUsernames() {
    const current = loginIdentity.value;
    loginIdentity.innerHTML = '<option value="" disabled selected>Chargement…</option>';
    try {
      const users = await CSBAuth.pb.collection(CSBAuth.USERS_COLLECTION).getFullList({ sort: 'username', fields: 'username' });
      if (!users.length) {
        loginIdentity.innerHTML = '<option value="" disabled selected>Aucun compte trouvé</option>';
        return;
      }
      loginIdentity.innerHTML = '<option value="" disabled selected>— Choisir un identifiant —</option>' +
        users.map((u) => `<option value="${u.username}">${u.username}</option>`).join('');
      if (current && users.some((u) => u.username === current)) loginIdentity.value = current;
    } catch (e) {
      loginIdentity.innerHTML = '<option value="" disabled selected>Serveur injoignable</option>';
    }
  }
  populateLoginUsernames();

  loginSettingsToggle.addEventListener('click', () => {
    loginSettings.classList.toggle('show');
  });
  loginPbSaveBtn.addEventListener('click', () => {
    if (!loginPbUrl.value.trim()) return;
    CSBAuth.setPbUrl(loginPbUrl.value);
    location.reload();
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'Connexion…';
    try {
      await CSBAuth.login(loginIdentity.value.trim(), loginPassword.value);
    } catch (err) {
      loginError.textContent = "Identifiant ou mot de passe incorrect, ou serveur injoignable.";
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = 'Se connecter';
    }
  });

  logoutBtn.addEventListener('click', () => {
    userMenuDropdown.classList.remove('show');
    CSBAuth.logout();
  });

  userMenuBtn.addEventListener('click', () => {
    userMenuDropdown.classList.toggle('show');
  });
  document.addEventListener('click', (e) => {
    if (!userMenuWrap.contains(e.target)) userMenuDropdown.classList.remove('show');
  });

  function renderModuleNav() {
    moduleNav.innerHTML = '';
    MODULES.forEach((mod) => {
      const allowed = CSBAuth.hasModuleAccess(mod.id);
      const item = document.createElement('div');
      item.className = 'nav-item' + (mod.id === activeModuleId ? ' active' : '') + (allowed ? '' : ' locked');
      item.innerHTML = `<span class="icon">${mod.icon}</span><span>${mod.label}</span>` +
        (allowed ? '' : '<span class="soon">🔒</span>');
      if (allowed) {
        item.addEventListener('click', () => openModule(mod));
      } else {
        item.title = "Tu n'as pas accès à ce module — demande à un administrateur.";
      }
      moduleNav.appendChild(item);
    });
  }

  // Une iframe par module, créée une seule fois puis simplement montrée/masquée ensuite —
  // avant, changer d'onglet recréait l'iframe à chaque clic (main.innerHTML = ...), ce qui
  // rechargeait le module de zéro et perdait tout son état (sélection en cours, connexion
  // IMAP/PocketBase, formulaire à moitié rempli...).
  const moduleFrames = {};

  function openModule(mod) {
    activeModuleId = mod.id;
    renderModuleNav();

    const placeholder = main.querySelector('.main-placeholder');
    if (placeholder) placeholder.remove();

    Object.keys(moduleFrames).forEach((id) => {
      moduleFrames[id].style.display = id === mod.id ? 'block' : 'none';
    });

    if (!moduleFrames[mod.id]) {
      let el;
      if (mod.type === 'webview') {
        el = createWebviewShell(mod);
      } else {
        el = document.createElement('iframe');
        el.src = mod.path;
        el.title = mod.label;
      }
      main.appendChild(el);
      moduleFrames[mod.id] = el;
    }
  }

  // ---------- Onglets internes pour les modules webview (ex: Axonaut) ----------
  // Une webview seule ne propose ni onglets ni "ouvrir dans un nouvel onglet" (comportement de
  // navigateur classique) : on le reconstruit ici. webviewTabsState[mod.id] garde la liste des
  // onglets ouverts pour ce module et lequel est actif.
  const webviewTabsState = {};
  const FOURNISSEURS_SITES_KEY = 'csb_fournisseurs_sites';
  function loadCustomSites(mod) {
    try {
      const saved = JSON.parse(localStorage.getItem(FOURNISSEURS_SITES_KEY));
      if (Array.isArray(saved) && saved.length) return saved;
    } catch (e) {}
    return mod.sites;
  }
  function normalizeUrl(raw) {
    const v = (raw || '').trim();
    if (!v) return '';
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : 'https://' + v;
  }
  function createWebviewShell(mod) {
    const wrap = document.createElement('div');
    wrap.className = 'webview-shell';
    wrap.title = mod.label;
    const tabbar = document.createElement('div');
    tabbar.className = 'webview-tabbar';
    const pages = document.createElement('div');
    pages.className = 'webview-pages';
    const state = { tabs: [], activeId: null, tabbar, pages, nextId: 1, urlInput: null, mod };
    webviewTabsState[mod.id] = state;

    if (mod.browser) {
      // Barre d'outils façon navigateur : précédent / suivant / actualiser / adresse, plus
      // « + » (nouvel onglet vide) et « ✎ » (modifier la liste des sites proposés).
      const toolbar = document.createElement('div');
      toolbar.className = 'webview-toolbar';
      const mk = (txt, title, fn) => {
        const b = document.createElement('button');
        b.textContent = txt; b.title = title; b.className = 'webview-nav-btn';
        b.addEventListener('click', fn);
        toolbar.appendChild(b);
        return b;
      };
      const activeWv = () => {
        const t = state.tabs.find((x) => x.id === state.activeId);
        return t && t.webview ? t.webview : null;
      };
      mk('◀', 'Page précédente', () => { const w = activeWv(); if (w && w.canGoBack()) w.goBack(); });
      mk('▶', 'Page suivante', () => { const w = activeWv(); if (w && w.canGoForward()) w.goForward(); });
      mk('⟳', 'Actualiser', () => { const w = activeWv(); if (w) w.reload(); });
      const urlInput = document.createElement('input');
      urlInput.type = 'text';
      urlInput.className = 'webview-url';
      urlInput.placeholder = 'Adresse du site…';
      urlInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const url = normalizeUrl(urlInput.value);
        if (!url) return;
        const t = state.tabs.find((x) => x.id === state.activeId);
        if (!t) { createWebviewTab(mod.id, url, url); return; }
        t.url = url;
        if (t.webview) t.webview.loadURL(url); else activateWebviewTab(mod.id, t.id);
      });
      toolbar.appendChild(urlInput);
      state.urlInput = urlInput;
      mk('+', 'Nouvel onglet', () => { createWebviewTab(mod.id, 'about:blank', 'Nouvel onglet'); urlInput.value = ''; urlInput.focus(); });
      mk('🔑', 'Mémoriser les identifiants de ce site', () => openCredsDialog(state));
      mk('✎', 'Modifier la liste des fournisseurs', () => openSitesEditor(mod));
      wrap.appendChild(toolbar);
    }
    wrap.appendChild(tabbar);
    wrap.appendChild(pages);

    if (mod.sites) {
      // Un onglet par site, chargé seulement à la première ouverture (évite de lancer cinq
      // sites d'un coup au démarrage).
      loadCustomSites(mod).forEach((s, i) => createWebviewTab(mod.id, s.url, s.label, { lazy: true, activate: i === 0 }));
    } else {
      createWebviewTab(mod.id, mod.url, mod.label);
    }
    return wrap;
  }
  function ensureWebview(modId, tab) {
    if (tab.webview) return;
    const state = webviewTabsState[modId];
    const webview = document.createElement('webview');
    // Le partitionnement doit être posé AVANT src et avant l'attache au DOM : une fois la
    // navigation démarrée, Electron ne peut plus changer la session de la webview (sinon elle
    // repart sur une session en mémoire non persistée, perdue à chaque redémarrage de l'appli).
    webview.setAttribute('partition', 'persist:' + modId);
    webview.setAttribute('src', tab.url);
    webview.addEventListener('page-title-updated', (e) => {
      tab.labelEl.textContent = e.title || tab.label;
      tab.labelEl.title = e.title || tab.label;
    });
    const syncUrl = (e) => {
      if (state.urlInput && state.activeId === tab.id && e.url && e.url !== 'about:blank') state.urlInput.value = e.url;
    };
    webview.addEventListener('did-navigate', syncUrl);
    webview.addEventListener('did-navigate-in-page', syncUrl);
    if (state.mod.browser) webview.addEventListener('did-finish-load', () => autofillWebview(webview));
    state.pages.appendChild(webview);
    tab.webview = webview;
  }
  function createWebviewTab(modId, url, label, opts) {
    const state = webviewTabsState[modId];
    if (!state) return;
    const tabId = state.nextId++;

    const tabBtn = document.createElement('div');
    tabBtn.className = 'webview-tab';
    const tabBtnLabel = document.createElement('span');
    tabBtnLabel.className = 'webview-tab-label';
    tabBtnLabel.textContent = label;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'webview-tab-close';
    closeBtn.textContent = '✕';
    closeBtn.title = "Fermer l'onglet";
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeWebviewTab(modId, tabId); });
    tabBtn.appendChild(tabBtnLabel);
    tabBtn.appendChild(closeBtn);
    tabBtn.addEventListener('click', () => activateWebviewTab(modId, tabId));
    state.tabbar.appendChild(tabBtn);

    const tab = { id: tabId, webview: null, tabBtn, url, label, labelEl: tabBtnLabel };
    state.tabs.push(tab);
    if (!opts || !opts.lazy) ensureWebview(modId, tab);
    if (!opts || opts.activate !== false) activateWebviewTab(modId, tabId);
  }
  function activateWebviewTab(modId, tabId) {
    const state = webviewTabsState[modId];
    if (!state) return;
    state.activeId = tabId;
    state.tabs.forEach((t) => {
      const active = t.id === tabId;
      if (active) ensureWebview(modId, t);
      if (t.webview) t.webview.style.display = active ? 'flex' : 'none';
      t.tabBtn.classList.toggle('active', active);
      if (active && state.urlInput) state.urlInput.value = t.url && t.url !== 'about:blank' ? t.url : '';
    });
  }
  // ---------- Identifiants mémorisés par site (chiffrés côté principal, propres à ce poste) ----------
  function originOf(url) {
    try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch (e) { return null; }
  }
  // Pré-remplit (sans valider) le formulaire de connexion si des identifiants sont enregistrés
  // pour l'adresse exacte de la page. Les pages modernes affichent leur formulaire après coup :
  // on réessaie quelques secondes.
  const autoSubmitLast = {};
  async function autofillWebview(webview) {
    if (!window.csbHost || !window.csbHost.credGet) return;
    const origin = originOf(webview.getURL());
    if (!origin) return;
    let cred = null;
    try { cred = await window.csbHost.credGet(origin); } catch (e) {}
    if (!cred) return;
    // Garde-fou anti-boucle : si les identifiants sont refusés, la page de connexion se
    // recharge — on ne revalide donc pas plus d'une fois par minute et par site (sinon
    // risque de blocage du compte par trop d'essais).
    const now = Date.now();
    const doSubmit = !(autoSubmitLast[origin] && now - autoSubmitLast[origin] < 60000);
    if (doSubmit) autoSubmitLast[origin] = now;
    const script = `(function(u, p, doSubmit){
      var tries = 0;
      function setVal(el, v){
        var proto = Object.getPrototypeOf(el);
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      function visible(el){ var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
      function attempt(){
        var pw = Array.prototype.slice.call(document.querySelectorAll('input[type=password]')).filter(visible)[0];
        if (!pw) { if (++tries < 16) setTimeout(attempt, 500); return; }
        var scope = pw.form || document;
        var cands = Array.prototype.slice.call(scope.querySelectorAll('input')).filter(function(i){
          var t = (i.type || 'text').toLowerCase();
          return visible(i) && (t === 'text' || t === 'email' || t === 'tel') ;
        });
        var user = null;
        for (var i = 0; i < cands.length; i++) {
          if (cands[i].compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) user = cands[i];
        }
        if (user && !user.value) setVal(user, u);
        if (!pw.value) setVal(pw, p);
        if (!doSubmit) return;
        setTimeout(function(){
          var form = pw.form;
          if (form && typeof form.requestSubmit === 'function') { form.requestSubmit(); return; }
          var btn = (form || document).querySelector('button[type=submit], input[type=submit]');
          if (btn) btn.click();
          else pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }, 700);
      }
      attempt();
    })(${JSON.stringify(cred.username)}, ${JSON.stringify(cred.password)}, ${doSubmit});`;
    try { await webview.executeJavaScript(script); } catch (e) {}
  }
  function openCredsDialog(state) {
    const tab = state.tabs.find((x) => x.id === state.activeId);
    const url = tab && tab.webview ? tab.webview.getURL() : '';
    const origin = originOf(url);
    if (!origin) { alert("Ouvrez d'abord un site (adresse http/https) dans l'onglet actif."); return; }
    const overlay = document.createElement('div');
    overlay.className = 'sites-editor-overlay';
    const box = document.createElement('div');
    box.className = 'sites-editor';
    const h = document.createElement('h3');
    h.textContent = 'Identifiants pour ' + origin.replace(/^https?:\/\//, '');
    const hint = document.createElement('div');
    hint.className = 'sites-editor-hint';
    hint.textContent = 'Enregistrés chiffrés sur ce poste uniquement (jamais envoyés ailleurs) , pré-remplis et validés automatiquement à l\'ouverture de la page de connexion (une seule tentative par minute, pour éviter de bloquer le compte si le mot de passe est refusé).';
    const user = document.createElement('input');
    user.type = 'text'; user.placeholder = 'Identifiant / email'; user.className = 'webview-url';
    const pass = document.createElement('input');
    pass.type = 'password'; pass.placeholder = 'Mot de passe'; pass.className = 'webview-url';
    const row = document.createElement('div');
    row.className = 'sites-editor-actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Annuler';
    cancel.addEventListener('click', () => overlay.remove());
    const del = document.createElement('button');
    del.textContent = 'Supprimer';
    del.addEventListener('click', async () => { await window.csbHost.credDelete(origin); overlay.remove(); });
    const save = document.createElement('button');
    save.className = 'primary';
    save.textContent = 'Enregistrer';
    save.addEventListener('click', async () => {
      if (!user.value.trim() || !pass.value) return;
      try {
        await window.csbHost.credSet(origin, user.value.trim(), pass.value);
        overlay.remove();
        autofillWebview(tab.webview);
      } catch (e) { alert('Impossible d\'enregistrer : ' + e.message); }
    });
    row.append(cancel, del, save);
    box.append(h, hint, user, pass, row);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    window.csbHost.credGet(origin).then((c) => { if (c) user.value = c.username; }).catch(() => {});
    user.focus();
  }
  // Petit éditeur de la liste des fournisseurs : une ligne par site, « Nom | adresse ».
  function openSitesEditor(mod) {
    const overlay = document.createElement('div');
    overlay.className = 'sites-editor-overlay';
    const box = document.createElement('div');
    box.className = 'sites-editor';
    const h = document.createElement('h3');
    h.textContent = 'Liste des fournisseurs';
    const hint = document.createElement('div');
    hint.className = 'sites-editor-hint';
    hint.textContent = 'Une ligne par site : Nom | adresse. Les changements s\'appliquent à la prochaine ouverture de l\'onglet (ou après redémarrage de l\'appli).';
    const ta = document.createElement('textarea');
    ta.value = loadCustomSites(mod).map((s) => s.label + ' | ' + s.url).join('\n');
    const row = document.createElement('div');
    row.className = 'sites-editor-actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Annuler';
    cancel.addEventListener('click', () => overlay.remove());
    const reset = document.createElement('button');
    reset.textContent = 'Valeurs d\'origine';
    reset.addEventListener('click', () => { ta.value = mod.sites.map((s) => s.label + ' | ' + s.url).join('\n'); });
    const save = document.createElement('button');
    save.className = 'primary';
    save.textContent = 'Enregistrer';
    save.addEventListener('click', () => {
      const sites = ta.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const i = l.indexOf('|');
        const label = (i === -1 ? l : l.slice(0, i)).trim();
        const url = normalizeUrl(i === -1 ? l : l.slice(i + 1));
        return { label: label || url, url };
      }).filter((s) => s.url);
      try { localStorage.setItem(FOURNISSEURS_SITES_KEY, JSON.stringify(sites)); } catch (e) {}
      overlay.remove();
    });
    row.append(cancel, reset, save);
    box.append(h, hint, ta, row);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }
  function closeWebviewTab(modId, tabId) {
    const state = webviewTabsState[modId];
    if (!state) return;
    if (state.tabs.length <= 1) return; // toujours garder au moins un onglet ouvert
    const idx = state.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const [closed] = state.tabs.splice(idx, 1);
    if (closed.webview) closed.webview.remove();
    closed.tabBtn.remove();
    if (state.activeId === tabId) {
      const next = state.tabs[idx] || state.tabs[idx - 1] || state.tabs[0];
      activateWebviewTab(modId, next.id);
    }
  }
  // Un lien ouvert "dans un nouvel onglet" depuis n'importe quelle webview (menu clic-droit,
  // target="_blank") arrive ici — toujours ajouté au module actuellement actif s'il gère des
  // onglets (aujourd'hui, uniquement Axonaut), sinon ignoré silencieusement.
  if (window.csbHost && window.csbHost.onWebviewOpenTab) {
    window.csbHost.onWebviewOpenTab((url) => {
      const modId = Object.keys(webviewTabsState).find((id) => moduleFrames[id] && moduleFrames[id].style.display !== 'none') || Object.keys(webviewTabsState)[0];
      if (modId) createWebviewTab(modId, url, url);
    });
  }

  function renderUserMenu() {
    const user = CSBAuth.currentUser();
    if (!user) {
      userMenuWrap.style.display = 'none';
      return;
    }
    userMenuWrap.style.display = 'flex';
    userMenuName.textContent = user.username || user.email || '';
    userMenuRole.textContent = user.role === 'admin' ? 'Admin' : 'Utilisateur';
    userMenuRole.className = 'role' + (user.role === 'admin' ? ' admin' : '');
  }

  const manageUsersBtn = document.getElementById('manageUsersBtn');

  CSBAuth.onChange(() => {
    const user = CSBAuth.currentUser();
    loginOverlay.style.display = user ? 'none' : 'flex';
    renderUserMenu();
    renderModuleNav();
    manageUsersBtn.style.display = CSBAuth.isAdmin() ? 'block' : 'none';
    if (user) {
      loginIdentity.value = '';
      loginPassword.value = '';
    } else {
      activeModuleId = null;
      userMenuDropdown.classList.remove('show');
      Object.keys(moduleFrames).forEach((id) => delete moduleFrames[id]);
      main.innerHTML = `
        <div class="main-placeholder">
          <h2>Choisis un module</h2>
          <p>Sélectionne un module dans la barre du haut pour commencer.</p>
        </div>`;
      document.getElementById('usersOverlay').classList.remove('show');
      populateLoginUsernames();
    }
  });

  // ================== Gestion des utilisateurs (admin) ==================
  const usersOverlay = document.getElementById('usersOverlay');
  const usersTbody = document.getElementById('usersTbody');
  const usersMsg = document.getElementById('usersMsg');
  const userFormBox = document.getElementById('userFormBox');
  const userFUsername = document.getElementById('userFUsername');
  const userFPassword = document.getElementById('userFPassword');
  const userFPasswordHint = document.getElementById('userFPasswordHint');
  const userFRole = document.getElementById('userFRole');
  const userFPermsWrap = document.getElementById('userFPermsWrap');

  let usersCache = [];
  let editingUserId = null;

  manageUsersBtn.addEventListener('click', () => {
    userMenuDropdown.classList.remove('show');
    usersOverlay.classList.add('show');
    userFormBox.style.display = 'none';
    loadUsers();
  });
  document.getElementById('usersModalClose').addEventListener('click', () => usersOverlay.classList.remove('show'));
  usersOverlay.addEventListener('click', (e) => { if (e.target === usersOverlay) usersOverlay.classList.remove('show'); });

  async function loadUsers() {
    usersTbody.innerHTML = '<tr><td colspan="4" class="hint">Chargement…</td></tr>';
    try {
      usersCache = await CSBAuth.pb.collection(CSBAuth.USERS_COLLECTION).getFullList({ sort: 'username' });
      renderUsersTable();
    } catch (e) {
      usersTbody.innerHTML = `<tr><td colspan="4" class="hint">Erreur : ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  function moduleAccessSummary(u) {
    if (u.role === 'admin') return 'Tous les modules';
    const perms = u.permissions || {};
    const list = MODULES.filter((m) => perms[m.id] && perms[m.id].access).map((m) => m.label);
    return list.length ? list.join(', ') : '—';
  }

  function renderUsersTable() {
    usersTbody.innerHTML = usersCache.length ? usersCache.map((u) => `
      <tr>
        <td>${escapeHtml(u.username)}</td>
        <td><span class="role-tag${u.role === 'admin' ? ' admin' : ''}">${u.role === 'admin' ? 'Admin' : 'Utilisateur'}</span></td>
        <td class="mods">${escapeHtml(moduleAccessSummary(u))}</td>
        <td style="white-space:nowrap;">
          <button class="ghost small" data-edit="${u.id}">Modifier</button>
          <button class="ghost small" data-del="${u.id}">Supprimer</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="4" class="hint">Aucun utilisateur.</td></tr>';
    usersTbody.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => openUserForm(usersCache.find((u) => u.id === btn.dataset.edit)));
    });
    usersTbody.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const target = usersCache.find((u) => u.id === btn.dataset.del);
        if (target && CSBAuth.currentUser() && target.id === CSBAuth.currentUser().id) {
          alert('Tu ne peux pas supprimer ton propre compte.');
          return;
        }
        if (!confirm('Supprimer cet utilisateur ?')) return;
        try {
          await CSBAuth.pb.collection(CSBAuth.USERS_COLLECTION).delete(btn.dataset.del);
          await loadUsers();
        } catch (e) {
          alert('Erreur : ' + e.message);
        }
      });
    });
  }

  function renderPermsForm(existingPerms) {
    const perms = existingPerms || {};
    userFPermsWrap.innerHTML = MODULES.map((mod) => {
      const modPerms = perms[mod.id] || {};
      const fineChecks = mod.perms.map((p) => `
        <label class="perm-check"><input type="checkbox" data-mod="${mod.id}" data-perm="${p.key}" ${modPerms[p.key] ? 'checked' : ''}> ${p.label}</label>
      `).join('');
      return `
        <div class="perm-module">
          <div class="perm-module-title">
            <label class="perm-check"><input type="checkbox" data-mod="${mod.id}" data-perm="access" ${modPerms.access ? 'checked' : ''}> ${mod.icon} ${mod.label} — accès au module</label>
          </div>
          ${fineChecks ? `<div>${fineChecks}</div>` : ''}
        </div>`;
    }).join('');
  }

  function openUserForm(user) {
    editingUserId = user ? user.id : null;
    userFormBox.style.display = 'block';
    usersMsg.textContent = '';
    userFUsername.value = user ? user.username : '';
    userFUsername.disabled = !!user;
    userFPassword.value = '';
    userFPasswordHint.textContent = user ? '(laisser vide pour ne pas changer)' : '';
    userFRole.value = user ? (user.role || 'user') : 'user';
    renderPermsForm(user ? user.permissions : null);
  }

  document.getElementById('userAddBtn').addEventListener('click', () => openUserForm(null));
  document.getElementById('userFCancelBtn').addEventListener('click', () => { userFormBox.style.display = 'none'; });

  document.getElementById('userFSaveBtn').addEventListener('click', async () => {
    const username = userFUsername.value.trim();
    if (!username) { usersMsg.textContent = "L'identifiant est obligatoire."; return; }
    const password = userFPassword.value;
    if (!editingUserId && !password) { usersMsg.textContent = 'Choisis un mot de passe pour ce nouveau compte.'; return; }

    const permissions = {};
    userFPermsWrap.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      if (!cb.checked) return;
      permissions[cb.dataset.mod] = permissions[cb.dataset.mod] || {};
      permissions[cb.dataset.mod][cb.dataset.perm] = true;
    });

    const body = { username, role: userFRole.value, permissions };
    if (password) {
      body.password = password;
      body.passwordConfirm = password;
    }

    usersMsg.textContent = 'Enregistrement…';
    try {
      const selfEdit = editingUserId && CSBAuth.currentUser() && editingUserId === CSBAuth.currentUser().id;
      if (editingUserId) {
        await CSBAuth.pb.collection(CSBAuth.USERS_COLLECTION).update(editingUserId, body);
      } else {
        await CSBAuth.pb.collection(CSBAuth.USERS_COLLECTION).create(body);
      }
      // Changer son propre mot de passe (ou role/permissions) invalide le jeton de session
      // en cours côté PocketBase (mesure de sécurité) — on le rafraîchit tout de suite pour
      // ne pas se retrouver avec des requêtes qui échouent silencieusement juste après.
      if (selfEdit) await CSBAuth.refresh();
      usersMsg.textContent = '✔ Enregistré.';
      userFormBox.style.display = 'none';
      await loadUsers();
    } catch (e) {
      usersMsg.textContent = 'Erreur : ' + (e.data ? JSON.stringify(e.data.data || e.data) : e.message);
    }
  });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ================== Mises à jour automatiques ==================
  const updateBanner = document.getElementById('updateBanner');
  const updateBannerText = document.getElementById('updateBannerText');
  const updateRestartBtn = document.getElementById('updateRestartBtn');
  document.getElementById('updateBannerClose').addEventListener('click', () => { updateBanner.style.display = 'none'; });
  updateRestartBtn.addEventListener('click', () => window.csbHost.installUpdate());

  if (window.csbHost && window.csbHost.onUpdateStatus) {
    window.csbHost.onUpdateStatus((payload) => {
      if (payload.status === 'checking' || payload.status === 'none') {
        updateBanner.style.display = 'none';
        return;
      }
      updateRestartBtn.style.display = 'none';
      if (payload.status === 'available') {
        updateBannerText.textContent = `Mise à jour ${payload.version} trouvée — téléchargement…`;
      } else if (payload.status === 'downloading') {
        updateBannerText.textContent = `Téléchargement de la mise à jour… ${payload.percent}%`;
      } else if (payload.status === 'downloaded') {
        updateBannerText.textContent = `Mise à jour ${payload.version} prête.`;
        updateRestartBtn.style.display = 'inline-flex';
      } else if (payload.status === 'error') {
        updateBannerText.textContent = 'Mise à jour indisponible pour le moment.';
      }
      updateBanner.style.display = 'flex';
    });
  }

  // ================== Numéro de version + historique ==================
  const appVersionBadge = document.getElementById('appVersionBadge');
  if (window.csbHost && window.csbHost.getAppVersion) {
    window.csbHost.getAppVersion().then((v) => { appVersionBadge.textContent = 'v' + v; });
  }
  appVersionBadge.addEventListener('click', () => {
    const body = document.getElementById('versionHistoryBody');
    const history = (typeof APP_VERSION_HISTORY !== 'undefined') ? APP_VERSION_HISTORY : [];
    body.innerHTML = history.map((entry) => `
      <div class="version-entry">
        <div class="version-entry-title">v${entry.v}</div>
        <ul>${entry.items.map((it) => `<li>${escapeHtml(it)}</li>`).join('')}</ul>
      </div>
    `).join('') || '<p class="hint">Historique indisponible.</p>';
    document.getElementById('versionHistoryOverlay').classList.add('show');
  });
  document.getElementById('versionHistoryClose').addEventListener('click', () => {
    document.getElementById('versionHistoryOverlay').classList.remove('show');
  });
  document.getElementById('versionHistoryOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'versionHistoryOverlay') e.target.classList.remove('show');
  });

  // ================== Relais vectorisation (VTracer, moteur Node côté principal) ==================
  // Le module Vectorisation tourne dans un iframe sandboxé sans accès à Node ; le moteur VTracer,
  // lui, ne peut tourner que côté processus principal. Le socle sert donc de pont via postMessage.
  window.addEventListener('message', async (event) => {
    if (!event.data || event.data.type !== 'csb:vectorize-request') return;
    if (!window.csbHost || !window.csbHost.vectorize) {
      event.source.postMessage({ type: 'csb:vectorize-response', id: event.data.id, error: "Moteur de vectorisation indisponible." }, '*');
      return;
    }
    try {
      const svg = await window.csbHost.vectorize(event.data.rgba, event.data.width, event.data.height, event.data.options);
      event.source.postMessage({ type: 'csb:vectorize-response', id: event.data.id, svg }, '*');
    } catch (e) {
      event.source.postMessage({ type: 'csb:vectorize-response', id: event.data.id, error: e.message }, '*');
    }
  });
})();
