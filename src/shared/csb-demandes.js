// Demandes de prix et commandes reçues par mail — logique commune au module Email (gestion des
// demandes) et au socle (compteur de la colonne de gauche).
// Une demande = une conversation Gmail. Son type et son état sont des libellés Gmail, posés depuis
// l'appli ou depuis Spark (même boîte) ; « lu » = le drapeau lu de Gmail.
(function () {
  const L = {
    root: 'Demandes', prix: 'Demandes/Prix', commande: 'Demandes/Commande', encours: 'Demandes/En-cours',
    traite: 'Demandes/Traite', sanssuite: 'Demandes/Sans-suite', ignore: 'Demandes/Ignore'
  };
  const STATE_LABELS = [L.encours, L.traite, L.sanssuite];
  // Un mail est soit sans classement (par défaut), soit « À traiter », soit « Traité ». Les anciens
  // libellés (Prix, Commande, En cours, Sans suite) restent reconnus : à traiter / traité.
  const ETATS = {
    atraiter: { label: 'À traiter', icon: '📥', c: '#B5452F', light: '#FBE7E4' },
    traite:   { label: 'Traité',    icon: '✅', c: '#2E7D32', light: '#E3F2E4' }
  };
  const TYPES = { prix: '💶 Demande de prix', commande: '📦 Commande', aclasser: '❔ À classer' };
  // Recherches Gmail (syntaxe de la barre de recherche ; « Demandes/Prix » s'écrit demandes-prix)
  // les demandes traitées ou sans suite depuis plus de 3 mois ne sont plus relues (liste plus rapide)
  const Q_TAGGED = '{label:demandes label:demandes-prix label:demandes-commande} -label:demandes-ignore -(label:demandes-traite older_than:90d) -(label:demandes-sans-suite older_than:90d)';
  const DETECT = '{devis tarif tarifs prix cotation chiffrage commande commander "bon de commande" "demande de prix"}';
  const Q_SUGGEST = 'in:inbox newer_than:30d -from:me -{label:demandes label:demandes-prix label:demandes-commande label:demandes-ignore label:demandes-traite label:demandes-sans-suite} ' + DETECT;
  const NOREPLY_KEY = 'csb_demandes_noreply_days';
  function noReplyDays() {
    try { const v = parseInt(localStorage.getItem(NOREPLY_KEY), 10); return v > 0 ? v : 2; } catch (e) { return 2; }
  }
  function setNoReplyDays(n) { try { localStorage.setItem(NOREPLY_KEY, String(n)); } catch (e) {} }
  const cleanSubject = (s) => String(s || '').replace(/^\s*((re|tr|fw|fwd|réf|ref)\s*:\s*)+/i, '').trim() || '(sans objet)';

  function buildThreads(items, myEmail) {
    const isMine = (m) => !!myEmail && m.from.email === myEmail;
    const by = {};
    items.forEach((m) => { const k = m.threadId || ('u' + m.uid); (by[k] = by[k] || []).push(m); });
    const limit = noReplyDays();
    return Object.entries(by).map(([id, msgs]) => {
      msgs.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const labels = new Set(msgs.flatMap((m) => m.labels));
      const ext = msgs.filter((m) => !isMine(m));
      const first = ext[0] || msgs[0];
      const last = msgs[msgs.length - 1];
      const t = {
        id, msgs, labels,
        subject: cleanSubject(first.subject),
        contactEmail: isMine(first) ? (first.to[0] || '') : first.from.email,
        contactName: isMine(first) ? (first.to[0] || '') : (first.from.name || first.from.email),
        firstDate: first.date, lastDate: last.date,
        hasAttachment: msgs.some((m) => m.hasAttachment),
        lastIsMine: isMine(last)
      };
      refresh(t, myEmail, limit);
      return t;
    }).sort((a, b) => String(b.lastDate).localeCompare(String(a.lastDate)));
  }
  // Recalcule type, état, non lu et attente de réponse d'une demande
  function refresh(t, myEmail, limit) {
    const isMine = (m) => !!myEmail && m.from.email === myEmail;
    t.type = t.labels.has(L.commande) ? 'commande' : t.labels.has(L.prix) ? 'prix' : 'aclasser';
    t.unread = t.msgs.some((m) => !isMine(m) && m.unread);
    t.etat = (t.labels.has(L.traite) || t.labels.has(L.sanssuite)) ? 'traite' : 'atraiter';
    // Sans réponse : le dernier message vient du client et date de plus de N jours
    const open = t.etat === 'atraiter';
    const last = t.msgs[t.msgs.length - 1];
    t.waitDays = open && last && !isMine(last) && last.date ? Math.floor((Date.now() - new Date(last.date)) / 86400000) : 0;
    t.noReply = t.waitDays >= (limit || noReplyDays());
    return t;
  }
  function counts(threads) {
    const open = threads.filter((t) => t.etat === 'atraiter');
    return { atraiter: open.length, unread: open.filter((t) => t.unread).length, noReply: open.filter((t) => t.noReply).length };
  }
  // Charge les demandes (et, au besoin, les mails proposés « À trier »)
  async function load(host, opts) {
    opts = opts || {};
    const st = await host.emailStatus();
    if (!st || !st.connected) throw new Error("Aucune boîte mail connectée sur ce poste : connecte-la dans les réglages ⚙︎ du module Email.");
    const myEmail = (st.email || '').toLowerCase();
    const tagged = await host.demandesSearch(Q_TAGGED, 400);
    const tids = [...new Set(tagged.items.map((m) => m.threadId).filter(Boolean))];
    const full = tids.length ? await host.demandesThreads(tids) : { items: [] };
    const seen = new Set();
    const threads = buildThreads(full.items.concat(tagged.items).filter((m) => !seen.has(m.uid) && seen.add(m.uid)), myEmail);
    let suggestions = [];
    if (opts.suggestions) {
      const sug = await host.demandesSearch(Q_SUGGEST, 150);
      const known = new Set(threads.map((t) => t.id));
      suggestions = buildThreads(sug.items, myEmail).filter((t) => !known.has(t.id));
    }
    return { myEmail, mailbox: tagged.mailbox, threads, suggestions };
  }
  window.CSBDemandes = { L, STATE_LABELS, ETATS, TYPES, cleanSubject, buildThreads, refresh, counts, load, noReplyDays, setNoReplyDays };
})();
