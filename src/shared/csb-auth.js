/*
 * Authentification et droits partagés — Atelier CSB.
 * Utilisé par le socle (shell) et par chaque module (Axonaut, Casaque, Inventaire, Stock de Fil).
 *
 * Toutes les pages de l'appli sont servies depuis la même origine (file://.../src/...),
 * donc le PocketBase JS SDK partage automatiquement la session (authStore en localStorage)
 * entre le shell et les modules chargés en <iframe> — pas besoin de la retransmettre à la main.
 *
 * Collection PocketBase attendue : "csb_users" (type Auth), avec en plus des champs standards :
 *   - role         (select: "admin" | "user", requis)
 *   - permissions  (JSON) — droits par module, ex:
 *       {
 *         "axonaut":    { "access": true, "devis": true, "commandes": true, "settings": false,
 *                          "addressbook": true, "etiquettes": true, "demande_prix": false },
 *         "casaque":    { "access": true, "coussin_trousse": false, "labels": true },
 *         "inventaire": { "access": true },
 *         "stock_fil":  { "access": true, "export": true, "import": false }
 *       }
 * Un compte "admin" a systématiquement tous les droits, quel que soit le contenu de "permissions".
 */
(function (global) {
  const PB_URL_KEY = 'csb_pb_url';
  const DEFAULT_PB_URL = 'http://192.168.1.142:8090';
  const USERS_COLLECTION = 'csb_users';

  function getPbUrl() {
    return localStorage.getItem(PB_URL_KEY) || DEFAULT_PB_URL;
  }
  function setPbUrl(url) {
    localStorage.setItem(PB_URL_KEY, url.trim().replace(/\/+$/, ''));
  }

  const pb = new PocketBase(getPbUrl());
  // Rafraîchit automatiquement le token tant qu'il reste valide, pour éviter
  // une déconnexion silencieuse en plein milieu d'une session de travail.
  pb.autoCancellation(false);

  function currentUser() {
    return pb.authStore.isValid ? pb.authStore.record : null;
  }

  function isAdmin() {
    const u = currentUser();
    return !!u && u.role === 'admin';
  }

  function can(moduleId, permId) {
    if (isAdmin()) return true;
    const u = currentUser();
    if (!u) return false;
    const modulePerms = (u.permissions && u.permissions[moduleId]) || {};
    return !!modulePerms[permId];
  }

  function hasModuleAccess(moduleId) {
    return can(moduleId, 'access');
  }

  async function login(identity, password) {
    return pb.collection(USERS_COLLECTION).authWithPassword(identity, password);
  }

  function logout() {
    pb.authStore.clear();
  }

  function onChange(callback) {
    // fire immediately with current state, then on every change
    return pb.authStore.onChange(callback, true);
  }

  async function refresh() {
    if (!pb.authStore.isValid) return null;
    try {
      return await pb.collection(USERS_COLLECTION).authRefresh();
    } catch (e) {
      pb.authStore.clear();
      return null;
    }
  }

  global.CSBAuth = {
    pb,
    getPbUrl,
    setPbUrl,
    login,
    logout,
    onChange,
    refresh,
    currentUser,
    isAdmin,
    can,
    hasModuleAccess,
    USERS_COLLECTION
  };
})(window);
