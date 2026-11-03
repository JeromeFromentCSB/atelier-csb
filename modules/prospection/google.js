/* =========================================================================
   GOOGLE MAPS (Places API « New ») — téléphone, site web et note Google des prospects
   - Clé saisie par l'utilisateur, gardée dans la configuration locale de l'appli (jamais affichée).
   - Fiche prospect : « Chercher sur Google Maps » → choix parmi 3 résultats.
   - Liste : « Compléter avec Google » → pour les fiches sans téléphone, n'accepte que les résultats
     sûrs (même code postal ou même ville, et nom ressemblant).
   ========================================================================= */

const G_CFG = 'csb_google_places';
const G_URL = 'https://places.googleapis.com/v1/places:searchText';
const G_FIELDS = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,places.businessStatus';

async function gGetKey() {
  try { if (window.csbHost) { const c = await window.csbHost.getConfig(); if (c && c[G_CFG] && c[G_CFG].apiKey) return c[G_CFG].apiKey; } } catch (e) {}
  try { return localStorage.getItem(G_CFG) || ''; } catch (e) { return ''; }
}
async function gSetKey(key) {
  if (window.csbHost) await window.csbHost.setConfig({ [G_CFG]: key ? { apiKey: key } : null });
  else if (key) localStorage.setItem(G_CFG, key); else localStorage.removeItem(G_CFG);
}

async function gSearch(text, max) {
  const key = await gGetKey();
  if (!key) { const e = new Error('Clé Google non renseignée (bouton « ⚙ Google »).'); e.noKey = true; throw e; }
  const res = await fetch(G_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': G_FIELDS },
    body: JSON.stringify({ textQuery: text, languageCode: 'fr', regionCode: 'FR', maxResultCount: max || 3 }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (j.error && j.error.message) || ('HTTP ' + res.status);
    throw new Error(res.status === 403 || res.status === 400 ? 'Google refuse la clé : ' + msg : msg);
  }
  return (j.places || []).map((pl) => ({
    nom: (pl.displayName && pl.displayName.text) || '', adresse: pl.formattedAddress || '',
    tel: pl.nationalPhoneNumber || pl.internationalPhoneNumber || '', site: pl.websiteUri || '',
    maps: pl.googleMapsUri || '', note: pl.rating || null, avis: pl.userRatingCount || 0,
    ferme: pl.businessStatus === 'CLOSED_PERMANENTLY',
  }));
}
function gQuery(p) { return [p.nom, p.adresse, p.cp, p.ville].filter(Boolean).join(' '); }

// Résultat sûr : même code postal (ou même ville) et au moins un mot significatif du nom en commun.
const G_STOP = new Set('sarl sas sasu eurl earl scea gaec sci ste soc societe ass association asso club de du des la le les l d et en au aux sur sous saint st ste'.split(' '));
function gWords(s) { return pNorm(s).split(' ').filter((w) => w.length > 2 && !G_STOP.has(w)); }
function gSure(p, r) {
  if (r.ferme) return false;
  const addr = pNorm(r.adresse);
  const placeOk = (p.cp && addr.includes(pNorm(p.cp))) || (p.ville && addr.includes(pNorm(p.ville)));
  if (!placeOk) return false;
  const a = gWords(p.nom), b = new Set(gWords(r.nom));
  return a.some((w) => b.has(w));
}
function gApply(p, r) {
  const changed = [];
  if (r.tel && r.tel !== p.tel && r.tel !== p.tel2) {
    if (!p.tel) { p.tel = r.tel; changed.push('téléphone'); }
    else if (!p.tel2) { p.tel2 = r.tel; changed.push('2e téléphone'); }
  }
  if (r.site && !p.site) { p.site = r.site; changed.push('site web'); }
  if (r.note) { p.google = { note: r.note, avis: r.avis, maps: r.maps }; }
  return changed;
}

// ---- dans la fiche prospect ------------------------------------------------
function pGoogleWire(p) {
  const box = document.getElementById('pdGoogle'); if (!box) return;
  const g = p.google;
  box.innerHTML = `<button type="button" class="secondary" id="pdGBtn">🔎 Chercher sur Google Maps</button>
    ${g && g.note ? `<span class="pmuted" style="margin-left:8px">★ ${String(g.note).replace('.', ',')} · ${g.avis} avis Google</span>` : ''}
    <div id="pdGRes"></div>`;
  document.getElementById('pdGBtn').onclick = async () => {
    const out = document.getElementById('pdGRes');
    out.innerHTML = '<div class="pmuted" style="margin-top:8px">Recherche sur Google Maps…</div>';
    try {
      const list = await gSearch(gQuery(p), 3);
      if (!list.length) { out.innerHTML = '<div class="pmuted" style="margin-top:8px">Rien trouvé sur Google Maps.</div>'; return; }
      out.innerHTML = list.map((r, i) => `<div class="gres${gSure(p, r) ? ' sure' : ''}">
          <div><b>${esc(r.nom)}</b>${r.ferme ? ' <span class="plate">fermé définitivement</span>' : ''}<div class="pmuted">${esc(r.adresse)}</div>
          <div>${r.tel ? '📞 ' + esc(r.tel) : '<span class="pmuted">pas de téléphone</span>'}${r.site ? ' · 🌐 ' + esc(r.site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) : ''}${r.note ? ` · ★ ${String(r.note).replace('.', ',')} (${r.avis})` : ''}</div></div>
          <button type="button" data-gi="${i}">Utiliser</button></div>`).join('');
      out.querySelectorAll('[data-gi]').forEach((b) => b.onclick = async () => {
        const changed = gApply(p, list[Number(b.dataset.gi)]);
        try { await pSave(p); renderSuivi(); renderDrawer(); pToast(changed.length ? 'Ajouté : ' + changed.join(', ') + '.' : 'Rien de nouveau à ajouter.'); }
        catch (e) { pToast('Enregistrement impossible : ' + e.message, true); }
      });
    } catch (e) {
      out.innerHTML = `<div class="plate" style="margin-top:8px">${esc(e.message)}</div>`;
      if (e.noKey) gOpenSettings();
    }
  };
}

// ---- compléter toute la liste ---------------------------------------------
async function gFillList() {
  if (!(await gGetKey())) return gOpenSettings();
  const todo = pFiltered().filter((p) => !p.tel && !p.tel2 && !p.gTried);
  if (!todo.length) return pToast('Toutes les fiches affichées ont déjà un téléphone (ou ont déjà été cherchées).');
  if (!confirm(`Chercher le téléphone et le site de ${todo.length} fiche(s) sur Google Maps ?\n(${todo.length} recherche(s) Google, décomptées de ton quota)`)) return;
  const btn = document.getElementById('pGFill'); btn.disabled = true;
  let found = 0, unsure = 0, none = 0;
  try {
    for (let i = 0; i < todo.length; i++) {
      const p = todo[i];
      btn.textContent = `Google… ${i + 1}/${todo.length}`;
      const list = await gSearch(gQuery(p), 1);
      p.gTried = new Date().toISOString().slice(0, 10);
      const r = list[0];
      if (r && gSure(p, r) && (r.tel || r.site)) { gApply(p, r); found++; }
      else if (r) unsure++; else none++;
      await pSave(p);
    }
  } catch (e) {
    pToast('Arrêté : ' + e.message, true);
  }
  btn.disabled = false; btn.textContent = '📞 Compléter avec Google';
  renderSuivi();
  pToast(`${found} fiche(s) complétée(s)` + (unsure ? ` · ${unsure} à vérifier dans la fiche (🔎 Chercher sur Google Maps)` : '') + (none ? ` · ${none} introuvable(s)` : '') + '.');
}

// ---- réglage de la clé ------------------------------------------------------
async function gOpenSettings() {
  pst.openId = null;
  const has = !!(await gGetKey());
  document.getElementById('pDrawer').innerHTML = `
    <div class="pd-head"><div style="flex:1"><h3>Google Maps</h3><div class="psub">Pour récupérer téléphones, sites web et notes Google.</div></div>
      <button class="secondary" id="gClose">✕</button></div>
    <section class="pd-sec">
      <div style="margin-bottom:10px">${has ? '✅ Une clé est enregistrée sur ce poste.' : 'Aucune clé enregistrée.'}</div>
      <label class="pf"><span>${has ? 'Remplacer la clé' : 'Clé API Google'}</span><input type="password" id="gKey" autocomplete="off" placeholder="AIza…"></label>
      <div class="status err" id="gErr" style="min-height:0"></div>
      <div class="pd-foot" style="margin-top:12px">
        <button id="gSave">Enregistrer et tester</button>
        ${has ? '<button class="secondary" id="gDel">Supprimer la clé</button>' : ''}
      </div>
    </section>`;
  document.getElementById('pDrawerBg').hidden = false;
  document.getElementById('gClose').onclick = pClose;
  document.getElementById('gSave').onclick = async () => {
    const k = document.getElementById('gKey').value.trim();
    const err = document.getElementById('gErr');
    if (!k) { err.textContent = 'Colle la clé dans la case.'; return; }
    err.textContent = '';
    await gSetKey(k);
    try { await gSearch('Mairie de Valenciennes', 1); pToast('Clé Google enregistrée et vérifiée.'); pClose(); }
    catch (e) { err.textContent = e.message; }
  };
  const del = document.getElementById('gDel');
  if (del) del.onclick = async () => { await gSetKey(''); pToast('Clé Google supprimée.'); pClose(); };
}

document.getElementById('pGFill').addEventListener('click', gFillList);
document.getElementById('pGSet').addEventListener('click', gOpenSettings);
