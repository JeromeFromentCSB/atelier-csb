/* =========================================================================
   SUIVI DES APPELS — onglet du module Prospection
   - Fiches prospects : statut, prochaine relance, historique des échanges.
   - Enregistrées dans la collection PocketBase "prospects" (partagée entre les postes) ;
     si elle n'existe pas encore ou si le serveur est injoignable, sur ce poste seulement.
   - Alimentées depuis l'onglet « Trouver des prospects », un import Excel/CSV ou à la main.
   ========================================================================= */

const P_STATUTS = [
  { k: 'a_appeler',   l: 'À appeler',      c: '#6B7280', open: true  },
  { k: 'pas_repondu', l: 'Pas de réponse', c: '#B08A2E', open: true  },
  { k: 'rappeler',    l: 'À rappeler',     c: '#2563EB', open: true  },
  { k: 'interesse',   l: 'Intéressé',      c: '#7C3AED', open: true  },
  { k: 'devis',       l: 'Devis envoyé',   c: '#0E7490', open: true  },
  { k: 'gagne',       l: 'Client gagné',   c: '#3E7A52', open: false },
  { k: 'perdu',       l: 'Pas intéressé',  c: '#9CA3AF', open: false },
];
// Résultat d'un échange → nouveau statut et relance proposée (jours ouvrés ; null = plus de relance).
const P_RESULTS = [
  { k: 'pas_repondu', l: '📵 Pas de réponse', statut: 'pas_repondu', days: 2 },
  { k: 'message',     l: '📨 Message laissé', statut: 'pas_repondu', days: 3 },
  { k: 'rappeler',    l: '🔁 À rappeler',     statut: 'rappeler',    days: 1 },
  { k: 'interesse',   l: '👍 Intéressé',      statut: 'interesse',   days: 7 },
  { k: 'devis',       l: '📄 Devis envoyé',   statut: 'devis',       days: 5 },
  { k: 'gagne',       l: '✅ Client gagné',   statut: 'gagne',       days: null },
  { k: 'perdu',       l: '✋ Pas intéressé',  statut: 'perdu',       days: null },
  { k: 'note',        l: '📝 Simple note',    statut: null,          days: undefined },
];
const P_CANAUX = { appel: '📞 Appel', email: '✉️ Email', visite: '🚶 Visite', autre: '💬 Autre' };
const P_TYPES = { mairie: 'Mairie', association: 'Association', societe: 'Société', autre: 'Autre organisme', particulier: 'Particulier' };

const LS_PROSPECTS = 'csb_prospects_v1';
const LS_SCRIPT = 'csb_prospect_script';
const LS_TAB = 'csb_prospect_tab';

const pst = { mode: 'local', pbError: '', items: [], vue: 'todo', q: '', statut: '', openId: null, choice: null };
const $p = (id) => document.getElementById(id);

// ---- dates -------------------------------------------------------------
function pIso(d) { const z = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
function pToday() { return pIso(new Date()); }
function pAddWorkdays(n) { const d = new Date(); let k = 0; while (k < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) k++; } return pIso(d); }
function pAddDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return pIso(d); }
function pFr(s) { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}`; }
function pFrDT(s) { const d = new Date(s); return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function pRelLabel(s) {
  if (!s) return '';
  const t = pToday();
  if (s < t) { const n = Math.round((new Date(t) - new Date(s)) / 864e5); return `en retard de ${n} j`; }
  if (s === t) return "aujourd'hui";
  if (s === pAddDays(1)) return 'demain';
  return pFr(s);
}

// ---- utilitaires ---------------------------------------------------------
function pUser() { try { const u = window.CSBAuth && CSBAuth.currentUser(); return u ? (u.username || u.name || u.email || '') : ''; } catch (e) { return ''; } }
function pStatut(k) { return P_STATUTS.find((s) => s.k === k) || P_STATUTS[0]; }
function pIsOpen(p) { return pStatut(p.statut).open; }
function pIsDue(p) { return pIsOpen(p) && (!p.relance || p.relance <= pToday()); }
function pIsLate(p) { return pIsOpen(p) && p.relance && p.relance < pToday(); }
function pNorm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function pKey(p) { return p.siret ? 's' + String(p.siret).replace(/\D/g, '') : p.insee ? 'm' + p.insee : 'n' + pNorm(p.nom) + '|' + (p.cp || ''); }
function pFind(key) { return pst.items.find((p) => pKey(p) === key); }
function pLastCall(p) { return (p.appels || []).length ? p.appels[p.appels.length - 1] : null; }
function pTelHref(t) { return 'tel:' + String(t).replace(/[^\d+]/g, ''); }
function pOpenExt(url) { if (window.csbHost && window.csbHost.openExternal) window.csbHost.openExternal(url); else window.open(url, '_blank'); }
function pToast(msg, bad) {
  const t = $p('pToast');
  t.textContent = msg; t.className = 'ptoast show' + (bad ? ' bad' : '');
  clearTimeout(pToast._t); pToast._t = setTimeout(() => { t.className = 'ptoast'; }, 3800);
}

// ---- stockage ------------------------------------------------------------
function pbBase() { return CSBAuth.getPbUrl().replace(/\/+$/, '') + '/api/collections/prospects/records'; }
function pFromRec(r) { return Object.assign({}, r.data || {}, { id: r.id, nom: r.nom || (r.data && r.data.nom) || '', statut: r.statut || 'a_appeler', relance: r.relance || '' }); }
function pBody(p) {
  const data = Object.assign({}, p); delete data.id;
  return JSON.stringify({ nom: p.nom, siret: p.siret || '', statut: p.statut, relance: p.relance || '', modifie_par: pUser(), data });
}
async function pbLoad() {
  const all = []; let page = 1;
  for (;;) {
    const res = await CSBAuth.authedFetch(pbBase() + `?perPage=500&page=${page}&sort=-updated`);
    if (res.status === 404) { const e = new Error('collection absente'); e.missing = true; throw e; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    for (const r of j.items || []) all.push(pFromRec(r));
    if (page >= (j.totalPages || 1)) break;
    page++;
  }
  return all;
}
function pLoadLocal() { try { const a = JSON.parse(localStorage.getItem(LS_PROSPECTS) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function pSaveLocal(list) { localStorage.setItem(LS_PROSPECTS, JSON.stringify(list)); }

async function pSave(p) {
  p.maj = new Date().toISOString(); p.maj_par = pUser();
  if (pst.mode === 'pb') {
    const isNew = !p.id || p.id[0] === 'l';
    if (isNew) delete p.id;
    const res = isNew
      ? await CSBAuth.authedFetch(pbBase(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pBody(p) })
      : await CSBAuth.authedFetch(pbBase() + '/' + p.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: pBody(p) });
    if (!res.ok) throw new Error('le serveur a refusé l\'enregistrement (HTTP ' + res.status + ')');
    const r = await res.json(); p.id = r.id;
    if (!pst.items.includes(p)) pst.items.push(p);
  } else {
    if (!p.id) p.id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    if (!pst.items.includes(p)) pst.items.push(p);
    pSaveLocal(pst.items);
  }
}
async function pDelete(p) {
  if (pst.mode === 'pb') {
    const res = await CSBAuth.authedFetch(pbBase() + '/' + p.id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
  }
  pst.items = pst.items.filter((x) => x !== p);
  if (pst.mode === 'local') pSaveLocal(pst.items);
}
async function pReload(silent) {
  try {
    if (!window.CSBAuth) throw new Error('auth');
    pst.items = await pbLoad(); pst.mode = 'pb'; pst.pbError = '';
  } catch (e) {
    if (pst.mode === 'pb' && silent) return; // coupure passagère : on garde la liste affichée
    pst.mode = 'local'; pst.pbError = e.missing ? 'missing' : 'offline';
    pst.items = pLoadLocal();
  }
  renderSuivi();
  if (typeof renderMairieList === 'function' && Object.keys(state.mairies || {}).length) renderMairieList();
}

// ---- ajout de prospects --------------------------------------------------
function pNew(fields) {
  return Object.assign({ nom: '', type: 'societe', statut: 'a_appeler', relance: '', appels: [], cree: new Date().toISOString(), cree_par: pUser() }, fields);
}
/** Ajoute des fiches en ignorant celles déjà suivies. */
async function pAddMany(list) {
  let added = 0, skipped = 0, failed = 0;
  for (const f of list) {
    if (!f.nom) { skipped++; continue; }
    const p = pNew(f);
    if (pFind(pKey(p))) { skipped++; continue; }
    try { await pSave(p); added++; } catch (e) { failed++; console.error(e); }
  }
  renderSuivi();
  if (typeof renderMairieList === 'function' && Object.keys(state.mairies || {}).length) renderMairieList();
  return { added, skipped, failed };
}
function pReport({ added, skipped, failed }) {
  const parts = [`${added} prospect(s) ajouté(s) au suivi`];
  if (skipped) parts.push(`${skipped} déjà suivi(s)`);
  if (failed) parts.push(`${failed} en échec`);
  pToast(parts.join(' · '), !!failed);
}
function orgToProspect(o) {
  const m = state.mairies[o.codeInsee];
  return {
    nom: o.nom, type: o.type || 'societe', siret: o.siret && !String(o.siret).startsWith('manuel') ? o.siret : '',
    naf: o.naf || '', activite: o.nafLabel || '', adresse: o.adresse || '', cp: o.cp || '', ville: o.ville || '',
    tel: o.tel || '', email: o.email || '', contact: o.contact || '',
    source: 'Recherche ' + (m ? m.nom : o.ville || ''),
  };
}
function mairieToProspect(m) {
  const c = m.contact || {};
  return {
    nom: 'Mairie de ' + m.nom, type: 'mairie', insee: m.code, tel: c.telephone || '', email: c.email || '', site: c.web || '',
    adresse: c.adresse || '', cp: m.cp || '', ville: m.nom, source: 'Recherche mairies',
  };
}
function orgInSuivi(o) { return !!pFind(pKey(pNew(orgToProspect(o)))); }
function mairieInSuivi(m) { return !!pFind('m' + m.code); }

// ---- rendu de la liste ---------------------------------------------------
function pFiltered() {
  const q = pNorm(pst.q);
  let list = pst.items.filter((p) => {
    if (pst.vue === 'todo' && !pIsDue(p)) return false;
    if (pst.vue === 'open' && !pIsOpen(p)) return false;
    if (pst.vue === 'closed' && pIsOpen(p)) return false;
    if (pst.statut && p.statut !== pst.statut) return false;
    if (q && !pNorm([p.nom, p.ville, p.cp, p.contact, p.tel, p.tel2, p.email, p.activite, p.notes].join(' ')).includes(q)) return false;
    return true;
  });
  const far = '9999-99-99';
  list.sort((a, b) => (pIsOpen(b) - pIsOpen(a)) || (a.relance || (pst.vue === 'todo' ? '' : far)).localeCompare(b.relance || (pst.vue === 'todo' ? '' : far)) || (a.nom || '').localeCompare(b.nom || ''));
  return list;
}
function renderSuivi() {
  // bandeau d'état du stockage
  const local = pst.mode === 'pb' ? pLoadLocal() : [];
  let banner = '';
  if (pst.mode === 'local' && pst.pbError === 'missing')
    banner = `<b>Suivi enregistré sur ce poste uniquement.</b> Pour le partager entre tous les postes, un administrateur doit importer le fichier <code>pocketbase/collection-prospects.json</code> dans PocketBase (Paramètres → Import collections). Les fiches déjà saisies pourront ensuite être envoyées au serveur.`;
  else if (pst.mode === 'local')
    banner = `<b>Serveur injoignable.</b> Les fiches sont enregistrées sur ce poste en attendant ; elles pourront être envoyées au serveur plus tard. <button class="ghost" id="pRetry">Réessayer</button>`;
  else if (local.length)
    banner = `<b>${local.length} fiche(s) enregistrée(s) sur ce poste seulement.</b> <button class="ghost" id="pMigrate">Les envoyer au serveur</button>`;
  $p('pBanner').innerHTML = banner;
  $p('pBanner').hidden = !banner;
  if ($p('pRetry')) $p('pRetry').onclick = () => pReload();
  if ($p('pMigrate')) $p('pMigrate').onclick = pMigrate;

  // compteurs
  const t = pToday();
  const due = pst.items.filter(pIsDue).length;
  const late = pst.items.filter(pIsLate).length;
  const calls = pst.items.reduce((n, p) => n + (p.appels || []).filter((a) => a.d && a.d.slice(0, 10) === t).length, 0);
  const hot = pst.items.filter((p) => p.statut === 'interesse' || p.statut === 'devis').length;
  const won = pst.items.filter((p) => p.statut === 'gagne').length;
  $p('pKpis').innerHTML = `
    <button class="pkpi${pst.vue === 'todo' ? ' on' : ''}" data-vue="todo"><b>${due}</b><span>à appeler aujourd'hui</span>${late ? `<em>dont ${late} en retard</em>` : ''}</button>
    <button class="pkpi" data-kpi="calls"><b>${calls}</b><span>échange(s) noté(s) aujourd'hui</span></button>
    <button class="pkpi" data-statut="interesse,devis"><b>${hot}</b><span>intéressé(s) / devis en cours</span></button>
    <button class="pkpi" data-statut="gagne"><b>${won}</b><span>client(s) gagné(s)</span></button>
    <button class="pkpi${pst.vue === 'all' ? ' on' : ''}" data-vue="all"><b>${pst.items.length}</b><span>prospect(s) au total</span></button>`;
  const badge = $p('pDueBadge');
  badge.textContent = due || ''; badge.hidden = !due;

  document.querySelectorAll('#pViews button').forEach((b) => b.classList.toggle('active', b.dataset.vue === pst.vue));

  const list = pFiltered();
  const holder = $p('pList');
  if (!pst.items.length) {
    holder.innerHTML = `<div class="pempty"><b>Aucun prospect pour l'instant.</b><br>Cherchez-en dans l'onglet « 🔎 Trouver des prospects » puis cliquez « ＋ Suivi », importez un fichier Excel, ou ajoutez-en un à la main.</div>`;
    return;
  }
  if (!list.length) {
    holder.innerHTML = `<div class="pempty">${pst.vue === 'todo' ? "Rien à appeler pour aujourd'hui 🎉 — voir l'onglet « En cours » pour les prochaines relances." : 'Aucun prospect ne correspond.'}</div>`;
    return;
  }
  holder.innerHTML = `<table class="ptable"><thead><tr>
      <th>Prospect</th><th>Contact</th><th>Statut</th><th>Prochaine relance</th><th>Dernier échange</th>
    </tr></thead><tbody>${list.map(pRow).join('')}</tbody></table>
    <div class="pcount">${list.length} fiche(s)</div>`;
}
function pRow(p) {
  const s = pStatut(p.statut);
  const last = pLastCall(p);
  const res = last && P_RESULTS.find((r) => r.k === last.res);
  const tel = p.tel || p.tel2;
  return `<tr data-pid="${esc(p.id)}" class="${pIsLate(p) ? 'late' : ''}">
    <td><b>${esc(p.nom)}</b><div class="psub">${esc(P_TYPES[p.type] || '')}${p.ville ? ' · ' + esc(p.ville) : ''}${p.activite ? ' · ' + esc(p.activite) : ''}</div></td>
    <td>${p.contact ? esc(p.contact) + '<br>' : ''}${tel ? `<a class="ptel" href="${esc(pTelHref(tel))}" data-ext>📞 ${esc(tel)}</a>` : '<span class="pmuted">pas de téléphone</span>'}</td>
    <td><span class="ppill" style="--c:${s.c}">${s.l}</span></td>
    <td>${s.open ? (p.relance ? `<span class="${pIsLate(p) ? 'plate' : ''}">${esc(pRelLabel(p.relance))}</span>` : '<span class="pmuted">à faire</span>') : '<span class="pmuted">—</span>'}</td>
    <td>${last ? `<span class="pmuted">${esc(pFrDT(last.d))}</span><br>${res ? esc(res.l) : ''}${last.note ? ' — ' + esc(last.note.slice(0, 70)) + (last.note.length > 70 ? '…' : '') : ''}` : '<span class="pmuted">jamais contacté</span>'}</td>
  </tr>`;
}

// ---- fiche (panneau latéral) --------------------------------------------
function pOpen(id) {
  pst.openId = id; pst.choice = null;
  renderDrawer();
  $p('pDrawerBg').hidden = false;
}
function pClose() { pst.openId = null; $p('pDrawerBg').hidden = true; }
function pCur() { return pst.items.find((p) => p.id === pst.openId); }

function renderDrawer() {
  const p = pCur();
  if (!p) return pClose();
  const s = pStatut(p.statut);
  const q = encodeURIComponent((p.nom || '') + ' ' + (p.ville || ''));
  const field = (k, label, type = 'text', wide) =>
    `<label class="pf${wide ? ' wide' : ''}"><span>${label}</span><input type="${type}" data-pk="${k}" value="${esc(p[k] || '')}"></label>`;
  const hist = (p.appels || []).slice().reverse();
  $p('pDrawer').innerHTML = `
    <div class="pd-head">
      <div style="flex:1;min-width:0">
        <h3>${esc(p.nom)}</h3>
        <div class="psub">${esc(P_TYPES[p.type] || '')}${p.ville ? ' · ' + esc(p.cp || '') + ' ' + esc(p.ville) : ''}${p.activite ? ' · ' + esc(p.activite) : ''}</div>
      </div>
      <button class="secondary" id="pdClose" title="Fermer (Échap)">✕</button>
    </div>

    <div class="pd-call">
      ${p.tel ? `<a class="pbig" href="${esc(pTelHref(p.tel))}" data-ext>📞 ${esc(p.tel)}</a>` : ''}
      ${p.tel2 ? `<a class="pbig" href="${esc(pTelHref(p.tel2))}" data-ext>📱 ${esc(p.tel2)}</a>` : ''}
      ${p.email ? `<a class="pbig light" href="mailto:${esc(p.email)}" data-ext>✉️ ${esc(p.email)}</a>` : ''}
      ${!p.tel && !p.tel2 ? '<span class="pmuted">Pas encore de téléphone : cherchez-le avec les liens ci-dessous puis complétez la fiche.</span>' : ''}
      <div class="linkbtns" style="width:100%;margin-top:6px">
        <a href="https://www.google.com/search?q=${q}%20t%C3%A9l%C3%A9phone" data-ext>Google</a>
        <a href="https://www.google.com/maps/search/${q}" data-ext>Maps</a>
        <a href="https://www.pagesjaunes.fr/recherche/${encodeURIComponent(p.ville || '')}/${encodeURIComponent(p.nom || '')}" data-ext>P.Jaunes</a>
        ${p.siret ? `<a href="https://annuaire-entreprises.data.gouv.fr/etablissement/${encodeURIComponent(String(p.siret).replace(/\D/g, ''))}" data-ext>Annuaire entreprises</a>` : ''}
        ${p.site ? `<a href="${esc(/^https?:/i.test(p.site) ? p.site : 'https://' + p.site)}" data-ext>Site web</a>` : ''}
      </div>
      <div class="linkbtns plinkedin" style="width:100%">
        <span class="pmuted">LinkedIn :</span>
        <a href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(p.nom || '')}" data-ext title="Personnes qui mentionnent cette structure (dirigeant, président, responsable…)">👤 Personnes</a>
        <a href="https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(p.nom || '')}" data-ext title="Page entreprise LinkedIn">🏢 Page de la structure</a>
        ${p.contact ? `<a href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(p.contact + ' ' + (p.nom || ''))}" data-ext title="Rechercher l'interlocuteur">🔎 ${esc(p.contact)}</a>` : ''}
        ${p.linkedin ? `<a href="${esc(/^https?:/i.test(p.linkedin) ? p.linkedin : 'https://' + p.linkedin)}" data-ext>⭐ Profil enregistré</a>` : ''}
      </div>
    </div>

    <section class="pd-sec">
      <h4>Noter un échange</h4>
      <div class="pd-row">
        <select id="pdCanal">${Object.entries(P_CANAUX).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      </div>
      <div class="pchips" id="pdResults">${P_RESULTS.map((r) => `<button type="button" class="pchip${pst.choice === r.k ? ' on' : ''}" data-res="${r.k}">${r.l}</button>`).join('')}</div>
      <textarea id="pdNote" placeholder="Ce qui a été dit : interlocuteur, besoin, quantités, date de l'évènement, budget…"></textarea>
      <div class="pd-row">
        <label class="pf"><span>Prochaine relance</span><input type="date" id="pdNext" value="${esc(p.relance || '')}"></label>
        <div class="pchips small">
          <button type="button" class="pchip" data-next="1">Demain</button>
          <button type="button" class="pchip" data-next="2">+2 j</button>
          <button type="button" class="pchip" data-next="5">+1 sem.</button>
          <button type="button" class="pchip" data-next="21">+1 mois</button>
          <button type="button" class="pchip" data-next="0">Aucune</button>
        </div>
      </div>
      <button id="pdSaveCall" style="margin-top:8px">Enregistrer l'échange</button>
    </section>

    <section class="pd-sec">
      <h4>Historique <span class="pmuted">(${hist.length})</span></h4>
      ${hist.length ? `<ul class="phist">${hist.map((a) => {
        const r = P_RESULTS.find((x) => x.k === a.res);
        return `<li><div class="pmuted">${esc(pFrDT(a.d))} · ${esc(P_CANAUX[a.canal] || '')}${a.par ? ' · ' + esc(a.par) : ''}</div><b>${r ? esc(r.l) : ''}</b>${a.note ? `<div class="pnote">${esc(a.note)}</div>` : ''}</li>`;
      }).join('')}</ul>` : '<div class="pmuted">Aucun échange noté.</div>'}
    </section>

    <section class="pd-sec">
      <h4>Fiche</h4>
      <div class="pgrid">
        <label class="pf"><span>Statut</span><select data-pk="statut">${P_STATUTS.map((x) => `<option value="${x.k}"${x.k === p.statut ? ' selected' : ''}>${x.l}</option>`).join('')}</select></label>
        <label class="pf"><span>Type</span><select data-pk="type">${Object.entries(P_TYPES).map(([k, l]) => `<option value="${k}"${k === p.type ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        ${field('nom', 'Nom', 'text', true)}
        ${field('contact', 'Interlocuteur')}
        ${field('fonction', 'Fonction')}
        ${field('tel', 'Téléphone', 'tel')}
        ${field('tel2', 'Portable', 'tel')}
        ${field('email', 'Email', 'email', true)}
        ${field('site', 'Site web', 'text', true)}
        ${field('linkedin', "Profil LinkedIn de l'interlocuteur (adresse copiée depuis LinkedIn)", 'text', true)}
        ${field('adresse', 'Adresse', 'text', true)}
        ${field('cp', 'Code postal')}
        ${field('ville', 'Ville')}
        ${field('siret', 'SIRET')}
        ${field('activite', 'Activité')}
        <label class="pf wide"><span>Infos utiles (besoins, saison, évènements, fournisseur actuel…)</span><textarea data-pk="notes">${esc(p.notes || '')}</textarea></label>
      </div>
      <div class="pmuted" style="font-size:11px;margin-top:6px">${p.source ? 'Origine : ' + esc(p.source) + ' · ' : ''}Créée le ${esc(pFr((p.cree || '').slice(0, 10)))}${p.cree_par ? ' par ' + esc(p.cree_par) : ''}${p.maj_par ? ' · modifiée par ' + esc(p.maj_par) : ''}</div>
    </section>

    <div class="pd-foot">
      ${window.CSBClients ? `<button id="pdAxonaut">${p.axonaut_id ? '✓ Client créé dans Axonaut' : '➜ Créer le client dans Axonaut'}</button>` : ''}
      <button class="secondary" id="pdDelete" style="margin-left:auto">🗑 Supprimer</button>
    </div>`;

  $p('pdClose').onclick = pClose;
  $p('pdResults').onclick = (e) => {
    const b = e.target.closest('[data-res]'); if (!b) return;
    pst.choice = b.dataset.res;
    $p('pdResults').querySelectorAll('.pchip').forEach((x) => x.classList.toggle('on', x === b));
    const r = P_RESULTS.find((x) => x.k === pst.choice);
    if (r.days === null) $p('pdNext').value = '';
    else if (r.days) $p('pdNext').value = pAddWorkdays(r.days);
  };
  $p('pDrawer').querySelectorAll('[data-next]').forEach((b) => b.onclick = () => {
    const n = Number(b.dataset.next);
    $p('pdNext').value = n ? (n >= 5 ? pAddDays(n === 5 ? 7 : 30) : pAddWorkdays(n)) : '';
  });
  $p('pdSaveCall').onclick = pSaveCall;
  $p('pDrawer').querySelectorAll('[data-pk]').forEach((inp) => inp.addEventListener('change', () => pEditField(inp)));
  $p('pdDelete').onclick = async () => {
    if (!confirm(`Supprimer définitivement la fiche « ${p.nom} » et son historique ?`)) return;
    try { await pDelete(p); pClose(); renderSuivi(); pToast('Fiche supprimée.'); } catch (e) { pToast('Suppression impossible : ' + e.message, true); }
  };
  if ($p('pdAxonaut')) $p('pdAxonaut').onclick = () => pToAxonaut(p);
}
async function pEditField(inp) {
  const p = pCur(); if (!p) return;
  p[inp.dataset.pk] = inp.value.trim();
  try {
    await pSave(p);
    renderSuivi();
    if (['statut', 'type', 'nom', 'ville', 'cp', 'tel', 'tel2', 'email', 'site', 'activite', 'linkedin', 'contact'].includes(inp.dataset.pk)) renderDrawer();
  } catch (e) { pToast('Enregistrement impossible : ' + e.message, true); }
}
async function pSaveCall() {
  const p = pCur(); if (!p) return;
  const note = $p('pdNote').value.trim();
  if (!pst.choice && !note) return pToast("Choisissez le résultat de l'échange (ou écrivez une note).", true);
  const r = P_RESULTS.find((x) => x.k === (pst.choice || 'note'));
  (p.appels = p.appels || []).push({ d: new Date().toISOString(), par: pUser(), canal: $p('pdCanal').value, res: r.k, note });
  if (r.statut) p.statut = r.statut;
  p.relance = pStatut(p.statut).open ? $p('pdNext').value : '';
  $p('pdSaveCall').disabled = true;
  try {
    await pSave(p);
    pst.choice = null;
    renderSuivi(); renderDrawer();
    pToast('Échange enregistré' + (p.relance ? ' · relance ' + pRelLabel(p.relance) : '') + '.');
    if (r.k === 'gagne' && window.CSBClients && !p.axonaut_id && confirm('Bravo ! Créer ce client dans Axonaut maintenant ?')) pToAxonaut(p);
  } catch (e) {
    p.appels.pop();
    $p('pdSaveCall').disabled = false;
    pToast('Enregistrement impossible : ' + e.message, true);
  }
}
function pToAxonaut(p) {
  const parts = String(p.contact || '').trim().split(/\s+/);
  CSBClients.open({
    prefillName: p.nom,
    prefill: {
      siret: String(p.siret || '').replace(/\D/g, ''), address_street: p.adresse, address_zip_code: p.cp, address_city: p.ville,
      address_contact_name: p.contact, type: p.statut === 'gagne' ? 'customer' : 'prospect',
      comments: 'Prospection CSB' + (p.activite ? ' — ' + p.activite : '') + (p.notes ? '\n' + p.notes : ''),
    },
    prefillContact: (p.contact || p.email || p.tel) ? {
      firstname: parts.length > 1 ? parts.slice(0, -1).join(' ') : '', lastname: parts.length > 1 ? parts[parts.length - 1] : (parts[0] || ''),
      email: p.email || '', phone_number: p.tel || '', cellphone_number: p.tel2 || '',
    } : null,
    onSaved: async (company) => {
      if (company && company.id) {
        p.axonaut_id = company.id;
        try { await pSave(p); } catch (e) {}
        if (pst.openId === p.id) renderDrawer();
      }
    },
  });
}

// ---- envoi des fiches locales vers le serveur ----------------------------
async function pMigrate() {
  const local = pLoadLocal();
  if (!local.length || pst.mode !== 'pb') return;
  let sent = 0, merged = 0, failed = 0;
  const left = [];
  for (const l of local) {
    const dup = pFind(pKey(l));
    try {
      if (dup) {
        const seen = new Set((dup.appels || []).map((a) => a.d));
        dup.appels = (dup.appels || []).concat((l.appels || []).filter((a) => !seen.has(a.d))).sort((a, b) => a.d.localeCompare(b.d));
        await pSave(dup); merged++;
      } else {
        const p = Object.assign({}, l); delete p.id;
        await pSave(p); sent++;
      }
    } catch (e) { failed++; left.push(l); }
  }
  pSaveLocal(left);
  renderSuivi();
  pToast(`${sent} fiche(s) envoyée(s)${merged ? `, ${merged} fusionnée(s) avec une fiche existante` : ''}${failed ? `, ${failed} en échec` : ''}.`, !!failed);
}

// ---- import / export -----------------------------------------------------
const P_IMPORT_MAP = [
  ['nom', /^(nom|raison sociale|societe|soci[eé]t[eé]|entreprise|organisme|structure|name|company)$/],
  ['tel', /^(t[eé]l[eé]?phone|tel|t[eé]l|phone|fixe|telephone fixe)$/],
  ['tel2', /^(portable|mobile|gsm|tel portable|telephone portable)$/],
  ['email', /^(e ?mail|mail|courriel|adresse mail|adresse email)$/],
  ['contact', /^(contact|interlocuteur|nom contact|responsable|dirigeant|contact evenement)$/],
  ['fonction', /^(fonction|poste|role)$/],
  ['adresse', /^(adresse|address|rue)$/],
  ['cp', /^(cp|code postal|zip|postal)$/],
  ['ville', /^(ville|commune|city|localite)$/],
  ['siret', /^(siret|n siret)$/],
  ['site', /^(site|site web|web|website|url)$/],
  ['linkedin', /^(linkedin|profil linkedin|url linkedin)$/],
  ['activite', /^(activite|libelle activite|secteur|naf|code naf|categorie)$/],
  ['notes', /^(note|notes|commentaire|commentaires|remarque|remarques|infos)$/],
];
async function pImportFile(file) {
  try {
    const buf = await file.arrayBuffer();
    let wb;
    if (/\.csv$/i.test(file.name)) {
      // CSV : UTF-8, sinon l'encodage Windows d'Excel en français
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('windows-1252').decode(buf); }
      wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string' });
    } else wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!rows.length) return pToast('Le fichier est vide.', true);
    const cols = {};
    for (const h of Object.keys(rows[0])) {
      const n = pNorm(h);
      const m = P_IMPORT_MAP.find(([, re]) => re.test(n));
      if (m && !cols[m[0]]) cols[m[0]] = h;
    }
    if (!cols.nom) return pToast("Colonne « Nom » introuvable dans le fichier (ex. Nom, Société, Raison sociale).", true);
    const list = rows.map((r) => {
      const f = { source: 'Import ' + file.name };
      for (const [k, h] of Object.entries(cols)) { const v = String(r[h] == null ? '' : r[h]).trim(); if (v) f[k] = v; }
      return f;
    });
    pToast(`Import de ${list.length} ligne(s)…`);
    pReport(await pAddMany(list));
  } catch (e) { pToast('Import impossible : ' + e.message, true); }
}
function pExport() {
  const list = pFiltered();
  if (!list.length) return pToast('Aucune fiche à exporter dans cette vue.', true);
  const data = list.map((p) => {
    const last = pLastCall(p);
    const r = last && P_RESULTS.find((x) => x.k === last.res);
    return {
      Nom: p.nom, Type: P_TYPES[p.type] || '', Statut: pStatut(p.statut).l, 'Prochaine relance': pFr(p.relance),
      Interlocuteur: p.contact || '', Fonction: p.fonction || '', Téléphone: p.tel || '', Portable: p.tel2 || '', Email: p.email || '',
      LinkedIn: p.linkedin || '', Adresse: p.adresse || '', CP: p.cp || '', Ville: p.ville || '', SIRET: p.siret || '', Activité: p.activite || '',
      'Nb échanges': (p.appels || []).length, 'Dernier échange': last ? pFrDT(last.d) : '', 'Dernier résultat': r ? r.l.replace(/^\S+\s/, '') : '',
      'Dernière note': last ? last.note || '' : '', Infos: p.notes || '', Origine: p.source || '',
    };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Suivi');
  XLSX.writeFile(wb, `suivi_prospection_${pToday()}.xlsx`);
}

// ---- onglets et événements ----------------------------------------------
function pSetTab(tab) {
  tab = tab === 'find' ? 'find' : 'suivi';
  try { localStorage.setItem(LS_TAB, tab); } catch (e) {}
  $p('tabFind').hidden = tab !== 'find';
  $p('tabSuivi').hidden = tab !== 'suivi';
  document.querySelectorAll('#mainTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'suivi' && pst.mode === 'pb' && !pst.openId) pReload(true);
}
$p('mainTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) pSetTab(b.dataset.tab); });
$p('pViews').addEventListener('click', (e) => { const b = e.target.closest('[data-vue]'); if (!b) return; pst.vue = b.dataset.vue; renderSuivi(); });
$p('pKpis').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.vue) { pst.vue = b.dataset.vue; pst.statut = ''; }
  else if (b.dataset.statut) { pst.vue = 'all'; pst.statut = b.dataset.statut.split(',')[0]; }
  else if (b.dataset.kpi === 'calls') { pst.vue = 'all'; pst.statut = ''; }
  $p('pStatut').value = pst.statut;
  renderSuivi();
});
$p('pSearch').addEventListener('input', (e) => { pst.q = e.target.value; renderSuivi(); });
$p('pStatut').innerHTML = '<option value="">Tous les statuts</option>' + P_STATUTS.map((s) => `<option value="${s.k}">${s.l}</option>`).join('');
$p('pStatut').addEventListener('change', (e) => { pst.statut = e.target.value; if (pst.statut && pst.vue === 'todo') pst.vue = 'all'; renderSuivi(); });
$p('pList').addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const tr = e.target.closest('tr[data-pid]'); if (tr) pOpen(tr.dataset.pid);
});
$p('pNew').addEventListener('click', async () => {
  const nom = prompt('Nom du prospect (société, association, mairie…) :');
  if (!nom || !nom.trim()) return;
  const p = pNew({ nom: nom.trim(), source: 'Saisie manuelle' });
  if (pFind(pKey(p)) && !confirm('Une fiche porte déjà ce nom. En créer une autre quand même ?')) return pOpen(pFind(pKey(p)).id);
  try { await pSave(p); renderSuivi(); pOpen(p.id); } catch (e) { pToast('Création impossible : ' + e.message, true); }
});
$p('pImport').addEventListener('click', () => $p('pImportFile').click());
$p('pImportFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) pImportFile(f); });
$p('pExport').addEventListener('click', pExport);
$p('pScriptBtn').addEventListener('click', () => { const b = $p('pScriptBox'); b.hidden = !b.hidden; $p('pScriptBtn').classList.toggle('on', !b.hidden); });
$p('pScript').value = localStorage.getItem(LS_SCRIPT) || '';
$p('pScript').addEventListener('input', (e) => { try { localStorage.setItem(LS_SCRIPT, e.target.value); } catch (er) {} });
$p('pDrawerBg').addEventListener('mousedown', (e) => { if (e.target === $p('pDrawerBg')) pClose(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pst.openId && !document.querySelector('.csbc-bg')) pClose(); });
// liens tel:/mailto:/web ouverts par Windows (Lien avec le téléphone, messagerie, navigateur)
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-ext]'); if (!a) return;
  e.preventDefault(); pOpenExt(a.href);
});

// Pont depuis l'onglet « Trouver des prospects »
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-add-suivi]'); if (!b) return;
  e.stopPropagation();
  const kind = b.dataset.addSuivi;
  if (kind === 'org') {
    const o = state.orgs[b.dataset.siret]; if (!o) return;
    if (orgInSuivi(o)) { pSetTab('suivi'); return pOpen(pFind(pKey(pNew(orgToProspect(o)))).id); }
    b.disabled = true; pReport(await pAddMany([orgToProspect(o)]));
  } else if (kind === 'mairie') {
    const m = state.mairies[b.dataset.code]; if (!m) return;
    if (mairieInSuivi(m)) { pSetTab('suivi'); return pOpen(pFind('m' + m.code).id); }
    b.disabled = true; pReport(await pAddMany([mairieToProspect(m)]));
  } else if (kind === 'selection') {
    const sel = Object.values(state.orgs).filter((o) => o.selected);
    if (!sel.length) return pToast('Cochez d\'abord des lignes dans les résultats.', true);
    b.disabled = true; pReport(await pAddMany(sel.map(orgToProspect))); b.disabled = false;
  }
}, true);

// rafraîchissement régulier (fiches modifiées depuis un autre poste)
setInterval(() => { if (pst.mode === 'pb' && !pst.openId && !$p('tabSuivi').hidden && document.visibilityState === 'visible') pReload(true); }, 120000);

pSetTab(localStorage.getItem(LS_TAB) || 'suivi');
pReload();
