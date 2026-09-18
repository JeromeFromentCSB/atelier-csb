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
  // Adresse Tailscale du NAS : jointe même hors du réseau de l'atelier (4G, autre wifi…), sans
  // ouvrir aucun port. N'est utilisée que si l'adresse locale ci-dessus ne répond pas.
  const FALLBACK_PB_URL = 'http://100.126.231.122:8090';
  const USERS_COLLECTION = 'csb_users';

  function getConfiguredPbUrl() {
    return localStorage.getItem(PB_URL_KEY) || DEFAULT_PB_URL;
  }
  // Adresse effectivement utilisée par toute l'appli (shell + modules) : démarre sur l'adresse
  // configurée (locale par défaut), puis bascule automatiquement sur l'adresse Tailscale si la
  // première ne répond pas — pour ne pas avoir à changer manuellement de réglage entre le
  // bureau et l'extérieur. Désactivé si l'utilisateur a lui-même saisi une URL personnalisée.
  let effectivePbUrl = getConfiguredPbUrl();
  function getPbUrl() {
    return effectivePbUrl;
  }
  function setPbUrl(url) {
    const clean = url.trim().replace(/\/+$/, '');
    localStorage.setItem(PB_URL_KEY, clean);
    effectivePbUrl = clean;
    pb.baseUrl = clean;
  }

  const pb = new PocketBase(effectivePbUrl);
  // Rafraîchit automatiquement le token tant qu'il reste valide, pour éviter
  // une déconnexion silencieuse en plein milieu d'une session de travail.
  pb.autoCancellation(false);

  (async function ensureReachablePbUrl(){
    if (localStorage.getItem(PB_URL_KEY)) return; // URL personnalisée : on ne touche à rien
    try{
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1200);
      const res = await fetch(effectivePbUrl.replace(/\/+$/, '') + '/api/health', { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return;
    }catch(e){}
    effectivePbUrl = FALLBACK_PB_URL;
    pb.baseUrl = FALLBACK_PB_URL;
  })();

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

  // Remplacement direct de fetch() pour les appels REST manuels vers PocketBase (les modules
  // qui n'utilisent pas le SDK pb.collection(...) construisent leurs URLs eux-mêmes) : ajoute
  // l'en-tête d'authentification de la session en cours, indispensable dès qu'une collection
  // PocketBase exige un compte connecté au lieu d'un accès public.
  //
  // Les URLs sont construites par chaque module à partir de getPbUrl() — si cet appel a lieu
  // avant que le test de jonabilité au démarrage (ci-dessus) ait fini de trancher, l'URL peut
  // encore pointer sur l'adresse locale même quand elle est injoignable (poste à distance). Pour
  // ne pas dépendre de ce minutage, on retente automatiquement une fois sur l'adresse Tailscale
  // dès qu'une requête échoue au niveau réseau, et on retient l'adresse qui a marché pour la
  // suite de la session (tous les prochains getPbUrl() en profitent aussitôt).
  async function authedFetch(url, options) {
    const opts = Object.assign({}, options);
    const headers = Object.assign({}, opts.headers);
    if (pb.authStore.isValid && pb.authStore.token) {
      headers['Authorization'] = pb.authStore.token;
    }
    opts.headers = headers;
    try {
      return await fetch(url, opts);
    } catch (networkErr) {
      const customUrl = localStorage.getItem(PB_URL_KEY);
      if (!customUrl && effectivePbUrl !== FALLBACK_PB_URL && url.indexOf(effectivePbUrl) === 0) {
        const fallbackUrl = FALLBACK_PB_URL + url.slice(effectivePbUrl.length);
        const res = await fetch(fallbackUrl, opts);
        effectivePbUrl = FALLBACK_PB_URL;
        pb.baseUrl = FALLBACK_PB_URL;
        return res;
      }
      throw networkErr;
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
    authedFetch,
    USERS_COLLECTION
  };
})(window);
