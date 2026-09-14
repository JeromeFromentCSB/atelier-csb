(function () {
  const MODULES = [
    { id: 'axonaut', label: 'Gestion Commande', icon: '📦', path: '../../modules/axonaut/index.html', perms: [
      { key: 'devis', label: 'Onglet Devis' },
      { key: 'commandes', label: 'Onglet Commande' },
      { key: 'etiquettes', label: 'Gestion des étiquettes' },
      { key: 'devis_pdf', label: 'Voir le PDF du devis' },
      { key: 'settings', label: 'Réglages (⚙︎)' },
      { key: 'addressbook', label: "Carnet d'adresses" }
    ] },
    { id: 'casaque', label: 'Gestion Casaque', icon: '🏇', path: '../../modules/casaque/index.html', perms: [
      { key: 'coussin_trousse', label: 'Modifier Coussin / Trousse' },
      { key: 'labels', label: 'Étiquettes Colissimo' }
    ] },
    { id: 'inventaire', label: 'Inventaire', icon: '🗂️', path: '../../modules/inventaire/index.html', perms: [
      { key: 'catalogue', label: 'Onglet Catalogue fournisseurs' },
      { key: 'recherche', label: 'Onglet Recherche' },
      { key: 'parametres', label: 'Onglet Paramètres' },
      { key: 'export', label: 'Exporter une sauvegarde' },
      { key: 'import', label: 'Importer une sauvegarde' }
    ] },
    { id: 'stock_fil', label: 'Stock de Fil', icon: '🧵', path: '../../modules/stock_fil/index.html', perms: [
      { key: 'mouvements', label: 'Onglet Mouvements' },
      { key: 'recherche', label: 'Onglet Recherche' },
      { key: 'parametres', label: 'Onglet Paramètres' },
      { key: 'export', label: 'Exporter une sauvegarde' },
      { key: 'import', label: 'Importer une sauvegarde' }
    ] },
    { id: 'prospection', label: 'Prospection', icon: '📍', path: '../../modules/prospection/index.html', perms: [] },
    { id: 'pointage', label: 'Pointage', icon: '🕒', path: '../../modules/pointage/index.html', perms: [] },
    { id: 'email', label: 'Email', icon: '✉️', path: '../../modules/email/index.html', perms: [] }
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
      const iframe = document.createElement('iframe');
      iframe.src = mod.path;
      iframe.title = mod.label;
      main.appendChild(iframe);
      moduleFrames[mod.id] = iframe;
    }
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
