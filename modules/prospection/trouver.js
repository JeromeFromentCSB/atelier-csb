/* =========================================================================
   TROUVER DES PROSPECTS — recherche par département
   - Département(s) + types (mairies, associations, commerces, entreprises, autres) + activité.
   - Les communes sont interrogées de la plus proche de l'atelier à la plus éloignée : les
     résultats arrivent au fur et à mesure, déjà dans l'ordre des distances.
   - Une seule liste, filtrable par type, par texte et par distance, triable.
   ========================================================================= */

const LS_ORIGIN = 'csb_prospect_origin_addr';
const LS_DEPS = 'csb_prospect_deps';
const CATS = [
  { k: 'mairie',      l: 'Mairies',          c: '#2D5B9A', input: 'fMairie' },
  { k: 'association', l: 'Associations',     c: '#7C3AED', input: 'fAssoc' },
  { k: 'commerce',    l: 'Commerces',        c: '#B45309', input: 'fCommerce' },
  { k: 'entreprise',  l: 'Entreprises',      c: '#0E7490', input: 'fEntreprise' },
  { k: 'autre',       l: 'Autres organismes', c: '#6B7280', input: 'fAutre' },
];
const COMMERCE_NAF = /^(45\.[1-4]|47|55|56|95\.2|96\.0[1-4])/;
// Familles du monde équestre (résultats de la case « Monde équestre »)
const EQUI_KINDS = [
  { k: 'centre',   l: 'Centres équestres & clubs' },
  { k: 'ecurie',   l: 'Écuries, haras & pensions' },
  { k: 'elevage',  l: 'Éleveurs' },
  { k: 'soins',    l: 'Maréchaux & soins' },
  { k: 'sellerie', l: 'Selleries & équipement' },
  { k: 'autre',    l: 'Autres (équestre)' },
];
function equiKind(o) {
  const n = tNorm(o.nom), naf = o.naf || '';
  if (/sellerie|harnach|equipement equestre/.test(n) || /^(47\.64|15\.12|46\.49|95\.2)/.test(naf)) return 'sellerie';
  if (/marechal|ferrant|dentaire|dentiste|osteo|veterinaire|soins/.test(n) || /^75/.test(naf)) return 'soins';
  if (/centre equestre|club hippique|hippique|poney|equitation|cavalier|attelage/.test(n) || /^(85\.51|93\.1|93\.29|94)/.test(naf)) return 'centre';
  if (/ecurie|haras|pension/.test(n)) return 'ecurie';
  if (naf === '01.43Z') return 'elevage';
  if (naf === '01.62Z') return 'soins';
  return 'autre';
}
function tNorm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
const rv = { hidden: new Set(), hiddenEqui: new Set(), q: '', sort: 'dist', maxKm: null, limit: 300, stop: false, running: false };

function orgCat(o) {
  if (o.type === 'association') return 'association';
  if (o.type === 'autre' || o.type === 'inconnu') return 'autre';
  return COMMERCE_NAF.test(o.naf || '') ? 'commerce' : 'entreprise';
}
function parseDeps(txt) {
  return [...new Set(String(txt || '').toUpperCase().split(/[\s,;]+/).map((d) => d.trim()).filter(Boolean)
    .map((d) => (/^\d$/.test(d) ? '0' + d : d)).filter((d) => /^(\d{2}|2A|2B|97\d)$/.test(d)))];
}
function communeDep(code) { return code.startsWith('97') ? code.slice(0, 3) : code.slice(0, 2); }
function annuaireField(v) {
  // l'annuaire renvoie certains champs sous forme de texte JSON : [{"valeur": "..."}]
  if (v == null || v === 'None') return '';
  if (typeof v === 'string' && v.trim().startsWith('[')) { try { v = JSON.parse(v); } catch (e) { return v; } }
  if (Array.isArray(v)) {
    const x = v[0]; if (!x) return '';
    if (typeof x === 'string') return x;
    if (x.valeur) return x.valeur;
    return [x.numero_voie, x.complement1, x.code_postal, x.nom_commune].filter(Boolean).join(' ');
  }
  return String(v);
}

// ---- mairies du département (annuaire de l'administration, par paquets de 100) ----
async function fetchMairiesDep(dep) {
  const where = encodeURIComponent(`pivot like "mairie" and startswith(code_insee_commune, "${dep}")`);
  const base = 'https://api-lannuaire.service-public.gouv.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records?limit=100&select=nom,code_insee_commune,telephone,adresse_courriel,site_internet,adresse&where=' + where;
  const out = [];
  for (let off = 0; off < 2000; off += 100) {
    if (rv.stop) break;
    const r = await fetchWithTimeout(base + '&offset=' + off, 20000);
    if (!r.ok) break;
    const j = await r.json();
    out.push(...(j.results || []));
    if (!j.results || j.results.length < 100) break;
  }
  return out;
}

// ---- recherche -------------------------------------------------------------
async function runSearch() {
  if (rv.running) return;
  const deps = parseDeps(document.getElementById('fDeps').value);
  if (!deps.length) return setStatus('statusCommunes', 'Indique au moins un numéro de département (ex : 59, ou 59, 62).', 'err');
  const cats = new Set(CATS.filter((c) => document.getElementById(c.input).checked).map((c) => c.k));
  const equestre = document.getElementById('fEquestre').checked;
  if (!cats.size) {
    if (equestre) CATS.forEach((c) => c.k !== 'mairie' && cats.add(c.k));
    else return setStatus('statusCommunes', 'Coche au moins un type (mairies, associations, commerces…).', 'err');
  }
  const addr = document.getElementById('originAddr').value.trim();
  try { localStorage.setItem(LS_ORIGIN, addr); localStorage.setItem(LS_DEPS, deps.join(', ')); localStorage.setItem('csb_prospect_maxkm', document.getElementById('fMaxKm').value); } catch (e) {}

  rv.running = true; rv.stop = false;
  const btn = document.getElementById('btnSearch'), stopBtn = document.getElementById('btnStop');
  btn.disabled = true; stopBtn.hidden = false;
  try {
    // point de départ des distances
    state.origin = null;
    if (addr) {
      setStatus('statusCommunes', "Localisation de l'adresse de départ…", '');
      try { state.origin = await geocode(addr); } catch (e) { setStatus('statusCommunes', e.message + ' — les distances ne seront pas calculées.', 'err'); }
    }
    const all = await loadCommunesIndex(false);
    let communes = all.filter((c) => deps.includes(communeDep(c.code)));
    if (!communes.length) throw new Error('Aucune commune trouvée pour ce département.');
    const o = state.origin;
    communes.forEach((c) => { c.dist = o && c.lat != null ? haversine(o.lat, o.lon, c.lat, c.lon) : null; });
    // limite de distance : seules les communes assez proches sont interrogées
    const maxKm = parseFloat(document.getElementById('fMaxKm').value);
    if (!isNaN(maxKm) && maxKm > 0) {
      if (!o) throw new Error("Pour limiter la distance, indique l'adresse de l'atelier.");
      communes = communes.filter((c) => c.dist != null && c.dist <= maxKm);
      if (!communes.length) throw new Error(`Aucune commune du département à moins de ${maxKm} km de l'atelier.`);
    }
    communes.sort((a, b) => (a.dist == null ? 1e9 : a.dist) - (b.dist == null ? 1e9 : b.dist) || a.nom.localeCompare(b.nom));

    // remise à zéro (les ajouts manuels par SIRET sont gardés)
    const manual = state.mairies._manuel;
    state.mairies = {};
    communes.forEach((c) => { state.mairies[c.code] = { code: c.code, nom: c.nom, cp: c.cp, lat: c.lat, lon: c.lon, dist: c.dist, contact: null, orgsLoaded: false }; });
    if (manual) state.mairies._manuel = manual;
    for (const k of Object.keys(state.orgs)) if (state.orgs[k].codeInsee !== '_manuel') delete state.orgs[k];
    rv.hidden.clear(); rv.hiddenEqui.clear();
    document.getElementById('panelResults').style.display = 'block';
    document.getElementById('panelExport').style.display = 'flex';
    renderMairieList();

    // mairies
    if (cats.has('mairie')) {
      for (const dep of deps) {
        setStatus('statusCommunes', `Mairies du département ${dep}…`, '');
        for (const rec of await fetchMairiesDep(dep)) {
          const m = state.mairies[rec.code_insee_commune]; if (!m) continue;
          m.listed = true;
          m.contact = { telephone: annuaireField(rec.telephone), email: annuaireField(rec.adresse_courriel), web: annuaireField(rec.site_internet), adresse: annuaireField(rec.adresse) };
        }
      }
      saveState(); renderMairieList();
    }

    // associations, commerces, entreprises…
    const orgCats = ['association', 'commerce', 'entreprise', 'autre'].filter((k) => cats.has(k));
    if (orgCats.length) {
      const sections = selectedNafSections();
      const naf = equestre ? EQUI_NAF : document.getElementById('fNafFree').value.trim();
      const mot = equestre ? '' : document.getElementById('fMot').value.trim();
      const onlyAssoc = orgCats.length === 1 && orgCats[0] === 'association';
      const maxRaw = parseInt(document.getElementById('fMaxPerCommune').value, 10);
      const maxPages = maxRaw === 0 ? 40 : Math.max(Math.ceil((maxRaw || 75) / 25), equestre ? 12 : 0);
      const url = (code, page) => 'https://recherche-entreprises.api.gouv.fr/search?etat_administratif=A&per_page=25&code_commune=' + code + '&page=' + page
        + (naf ? '&activite_principale=' + encodeURIComponent(naf) : '')
        + (!equestre && sections.length ? '&section_activite_principale=' + sections.join(',') : '')
        + (mot ? '&q=' + encodeURIComponent(mot) : '')
        + (onlyAssoc ? '&est_association=true' : '');
      const ingest = (json, code) => {
        if (!json || json.__error || !json.results) return;
        for (const rec of json.results) addOrg(rec, code, orgCats, equestre);
      };
      const BATCH = 30;
      for (let i = 0; i < communes.length && !rv.stop; i += BATCH) {
        const part = communes.slice(i, i + BATCH);
        const first = await fetchJsonBatched(part.map((c) => url(c.code, 1)), 2, null, 160);
        const more = [];
        first.forEach((j, k) => {
          ingest(j, part[k].code); state.mairies[part[k].code].orgsLoaded = true;
          if (j && !j.__error) for (let p = 2; p <= Math.min(j.total_pages || 1, maxPages); p++) more.push({ code: part[k].code, u: url(part[k].code, p) });
        });
        if (more.length && !rv.stop) (await fetchJsonBatched(more.map((m) => m.u), 2, null, 160)).forEach((j, k) => ingest(j, more[k].code));
        const done = Math.min(i + BATCH, communes.length);
        const last = part[part.length - 1];
        showProg('progOrgs', true, Math.round(done / communes.length * 100));
        setStatus('statusOrgs', `${done} / ${communes.length} communes parcourues${last.dist != null ? ` (jusqu'à ${last.dist.toFixed(0)} km)` : ''} — ${Object.keys(state.orgs).length} résultat(s)`, '');
        saveState(); renderMairieList();
      }
      if (equestre && !rv.stop) {
        setStatus('statusOrgs', 'Recherche par nom (équestre, écurie, haras, poney…)…', '');
        const extra = await equiKeywordResults(new Set(communes.map((c) => c.code)), null);
        for (const x of extra) addOrg(x.rec, x.codeInsee, orgCats, true, true);
      }
    }
    saveState(); renderMairieList();
    const n = Object.keys(state.orgs).length + Object.values(state.mairies).filter((m) => m.listed).length;
    setStatus('statusCommunes', '', '');
    setStatus('statusOrgs', (rv.stop ? 'Recherche arrêtée. ' : 'Recherche terminée. ') + n + ' résultat(s).', 'ok');
  } catch (e) {
    setStatus('statusOrgs', e.message, 'err');
  } finally {
    rv.running = false; btn.disabled = false; stopBtn.hidden = true; showProg('progOrgs', false); showProg('progCommunes', false);
  }
}

/** Ajoute un résultat de l'annuaire des entreprises, rattaché à l'établissement situé dans la commune. */
function addOrg(rec, code, orgCats, equestre, already) {
  if (equestre && !already && !isEquestre(rec)) return;
  const etabs = [...(rec.matching_etablissements || []), rec.siege].filter(Boolean);
  const e = etabs.find((x) => x.commune === code) || rec.siege || {};
  const org = extractOrg({ ...rec, siege: e });
  if (!org.siret || state.orgs[org.siret]) return;
  const cat = orgCat(org);
  if (!orgCats.includes(cat)) return;
  const m = state.mairies[code] || {};
  const lat = e.latitude != null ? parseFloat(e.latitude) : m.lat, lon = e.longitude != null ? parseFloat(e.longitude) : m.lon;
  const o = state.origin;
  state.orgs[org.siret] = {
    siret: org.siret, codeInsee: code, type: org.type, cat, nom: org.nom, adresse: org.adresse, cp: org.cp, ville: org.ville,
    naf: org.naf, nafLabel: org.nafLabel, tel: '', email: '', contact: '', selected: false,
    lat, lon, dist: o && lat != null && !isNaN(lat) ? haversine(o.lat, o.lon, lat, lon) : (m.dist != null ? m.dist : null),
  };
  if (equestre) state.orgs[org.siret].equi = equiKind(state.orgs[org.siret]);
}

// ---- affichage : une seule liste ---------------------------------------------
function resultRows() {
  const rows = [];
  for (const m of Object.values(state.mairies)) {
    if (!m.listed) continue;
    const c = m.contact || {};
    rows.push({ kind: 'mairie', key: m.code, cat: 'mairie', nom: 'Mairie de ' + m.nom, ville: m.nom, cp: m.cp, dist: m.dist, act: '', tel: c.telephone, email: c.email, web: c.web, adresse: c.adresse, sel: !!m.selected, ref: m });
  }
  for (const o of Object.values(state.orgs)) {
    rows.push({ kind: 'org', key: o.siret, cat: o.cat || orgCat(o), nom: o.nom, ville: o.ville, cp: o.cp, dist: o.dist, act: o.equi ? (EQUI_KINDS.find((x) => x.k === o.equi) || {}).l + (o.naf ? ' · NAF ' + o.naf : '') : o.nafLabel, equi: o.equi || '', tel: o.tel, email: o.email, adresse: o.adresse, sel: !!o.selected, ref: o });
  }
  return rows;
}
function filteredRows() {
  const q = tNorm(rv.q);
  let rows = resultRows().filter((r) => !rv.hidden.has(r.cat) && !(r.equi && rv.hiddenEqui.has(r.equi))
    && (rv.maxKm == null || r.dist == null || r.dist <= rv.maxKm)
    && (!q || tNorm([r.nom, r.ville, r.cp, r.act, r.ref.contact].join(' ')).includes(q)));
  const far = 1e9;
  const by = {
    dist: (a, b) => (a.dist == null ? far : a.dist) - (b.dist == null ? far : b.dist) || a.nom.localeCompare(b.nom),
    nom: (a, b) => a.nom.localeCompare(b.nom),
    ville: (a, b) => (a.ville || '').localeCompare(b.ville || '') || a.nom.localeCompare(b.nom),
    type: (a, b) => CATS.findIndex((c) => c.k === a.cat) - CATS.findIndex((c) => c.k === b.cat) || (a.dist || 0) - (b.dist || 0),
  };
  return rows.sort(by[rv.sort] || by.dist);
}
function renderMairieList() {
  const holder = document.getElementById('mairieList');
  const all = resultRows();
  // pastilles de type avec compteurs
  const counts = {}; all.forEach((r) => { counts[r.cat] = (counts[r.cat] || 0) + 1; });
  document.getElementById('rCats').innerHTML = CATS.filter((c) => counts[c.k]).map((c) =>
    `<button type="button" class="pchip${rv.hidden.has(c.k) ? '' : ' on'}" data-cat="${c.k}" style="--c:${c.c}">${c.l} <b>${counts[c.k]}</b></button>`).join('');
  const eq = {}; all.forEach((r) => { if (r.equi) eq[r.equi] = (eq[r.equi] || 0) + 1; });
  if (Object.keys(eq).length) document.getElementById('rCats').innerHTML += '<span style="width:100%;height:0"></span>' + EQUI_KINDS.filter((x) => eq[x.k]).map((x) =>
    `<button type="button" class="pchip small${rv.hiddenEqui.has(x.k) ? '' : ' on'}" data-equi="${x.k}">🐴 ${x.l} <b>${eq[x.k]}</b></button>`).join('');
  const rows = filteredRows();
  if (!all.length) { holder.innerHTML = '<div class="empty">Aucun résultat pour le moment.</div>'; updateSelCount(); return; }
  const shown = rows.slice(0, rv.limit);
  const cat = (k) => CATS.find((c) => c.k === k) || CATS[4];
  holder.innerHTML = `<table class="orgs"><thead><tr>
      <th><input type="checkbox" id="rAll" title="Cocher toutes les lignes affichées"></th><th>Type</th><th>Nom</th><th>Ville</th><th>Distance</th>
      <th>Téléphone</th><th>Email</th><th>Contact</th><th>Recherche</th><th>Suivi</th></tr></thead><tbody>
    ${shown.map((r) => {
      const c = cat(r.cat);
      const q = encodeURIComponent(r.nom + ' ' + (r.ville || ''));
      const inSuivi = r.kind === 'mairie' ? (typeof mairieInSuivi === 'function' && mairieInSuivi(r.ref)) : (typeof orgInSuivi === 'function' && orgInSuivi(r.ref));
      const attrs = r.kind === 'mairie' ? `data-add-suivi="mairie" data-code="${esc(r.key)}"` : `data-add-suivi="org" data-siret="${esc(r.key)}"`;
      const edit = (f, v, ph) => r.kind === 'mairie' ? (v ? esc(v) : '<span style="color:var(--muted)">—</span>') : `<input type="text" class="edit" data-field="${f}" value="${esc(v)}" placeholder="${ph}">`;
      return `<tr data-kind="${r.kind}" data-key="${esc(r.key)}" class="${r.sel ? 'selected' : ''}">
        <td><input type="checkbox" class="rowSel" ${r.sel ? 'checked' : ''}></td>
        <td>${r.equi
          ? `<span class="ppill" style="--c:#8F3423">🐴 ${({ centre: 'Centre équestre', ecurie: 'Écurie / pension', elevage: 'Éleveur', soins: 'Maréchal / soins', sellerie: 'Sellerie', autre: 'Équestre' })[r.equi]}</span>`
          : `<span class="ppill" style="--c:${c.c}">${c.l.replace(/s$/, '').replace('Autres organisme', 'Autre')}</span>`}</td>
        <td><b>${esc(r.nom)}</b>${r.act ? `<div style="color:var(--muted);font-size:11px">${esc(r.act)}</div>` : ''}</td>
        <td>${esc(r.cp || '')} ${esc(r.ville || '')}</td>
        <td style="white-space:nowrap">${r.dist != null ? r.dist.toFixed(1) + ' km' : '—'}</td>
        <td>${edit('tel', r.tel, 'à compléter')}</td>
        <td>${edit('email', r.email, 'à compléter')}</td>
        <td>${r.kind === 'mairie' ? '' : edit('contact', r.ref.contact, 'nom personne')}</td>
        <td class="linkbtns">
          <a href="https://www.google.com/maps/search/${q}" target="_blank">Maps</a>
          <a href="https://www.google.com/search?q=${q}%20t%C3%A9l%C3%A9phone" target="_blank">Google</a>
          ${r.kind === 'mairie' && r.web ? `<a href="${esc(r.web)}" target="_blank">Site</a>` : `<a href="https://www.pagesjaunes.fr/recherche/${encodeURIComponent(r.ville || '')}/${encodeURIComponent(r.nom)}" target="_blank">P.Jaunes</a>`}
          ${r.kind === 'org' ? `<a href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(r.nom)}" target="_blank">LinkedIn</a>` : ''}
        </td>
        <td><button class="ghost addsuivi${inSuivi ? ' done' : ''}" ${attrs}>${inSuivi ? '✓ Suivi' : '＋ Suivi'}</button></td>
      </tr>`;
    }).join('')}</tbody></table>
    <div class="pcount">${rows.length} résultat(s) affiché(s) sur ${all.length}${rows.length > rv.limit ? ` — <button class="ghost" id="rMore">Afficher ${Math.min(300, rows.length - rv.limit)} de plus</button>` : ''}</div>`;
  updateSelCount();
}
function rowRef(tr) { return tr.dataset.kind === 'mairie' ? state.mairies[tr.dataset.key] : state.orgs[tr.dataset.key]; }

// ---- événements ----------------------------------------------------------------
document.getElementById('btnSearch').addEventListener('click', runSearch);
document.getElementById('btnStop').addEventListener('click', () => { rv.stop = true; setStatus('statusOrgs', 'Arrêt en cours…', ''); });
document.getElementById('rCats').addEventListener('click', (e) => {
  const be = e.target.closest('[data-equi]');
  if (be) {
    const k = be.dataset.equi;
    if (e.ctrlKey || e.metaKey) rv.hiddenEqui = new Set(EQUI_KINDS.map((x) => x.k).filter((x) => x !== k));
    else if (rv.hiddenEqui.has(k)) rv.hiddenEqui.delete(k); else rv.hiddenEqui.add(k);
    rv.limit = 300; return renderMairieList();
  }
  const b = e.target.closest('[data-cat]'); if (!b) return;
  const k = b.dataset.cat;
  if (e.ctrlKey || e.metaKey) { rv.hidden = new Set(CATS.map((c) => c.k).filter((x) => x !== k)); } // Ctrl+clic : ce type seul
  else if (rv.hidden.has(k)) rv.hidden.delete(k); else rv.hidden.add(k);
  rv.limit = 300; renderMairieList();
});
document.getElementById('rFilter').addEventListener('input', (e) => { rv.q = e.target.value; rv.limit = 300; renderMairieList(); });
document.getElementById('rSort').addEventListener('change', (e) => { rv.sort = e.target.value; renderMairieList(); });
document.getElementById('rMaxKm').addEventListener('input', (e) => { const v = parseFloat(e.target.value); rv.maxKm = isNaN(v) ? null : v; rv.limit = 300; renderMairieList(); });
document.getElementById('mairieList').addEventListener('click', (e) => {
  if (e.target.id === 'rMore') { rv.limit += 300; renderMairieList(); }
});
document.getElementById('mairieList').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'rAll') {
    filteredRows().slice(0, rv.limit).forEach((r) => { r.ref.selected = t.checked; });
    saveState(); renderMairieList(); return;
  }
  const tr = t.closest('tr[data-key]'); if (!tr) return;
  const ref = rowRef(tr); if (!ref) return;
  if (t.classList.contains('rowSel')) { ref.selected = t.checked; tr.classList.toggle('selected', t.checked); updateSelCount(); }
  else if (t.classList.contains('edit')) ref[t.dataset.field] = t.value;
  saveState();
});
document.getElementById('fEquestre').addEventListener('change', (e) => {
  document.getElementById('activityBox').style.opacity = e.target.checked ? '.45' : '';
});

// valeurs mémorisées
try {
  document.getElementById('originAddr').value = localStorage.getItem(LS_ORIGIN) || '';
  document.getElementById('fDeps').value = localStorage.getItem(LS_DEPS) || '';
  document.getElementById('fMaxKm').value = localStorage.getItem('csb_prospect_maxkm') || '';
} catch (e) {}

// à l'ouverture : résultats de la dernière recherche
if (Object.keys(state.orgs).length || Object.values(state.mairies).some((m) => m.listed)) {
  document.getElementById('panelResults').style.display = 'block';
  document.getElementById('panelExport').style.display = 'flex';
}
renderMairieList();
