/* ============================================================================
   Fiche client Axonaut partagée (module Clients, module Devis…).
   - Création (POST /companies) et modification (PATCH /companies/{id}) d'un client Axonaut,
     avec ses contacts (GET/POST /employees, PATCH /employees/{id}).
   - Recherche des infos de la société dans l'annuaire officiel des entreprises
     (recherche-entreprises.api.gouv.fr, gratuit, sans clé) pendant la saisie du nom, complet ou
     partiel, en tenant compte du code postal et de la ville déjà saisis.
   Utilisation : CSBClients.open({ companyId, prefillName, onSaved(company) }).
   Nécessite csb-auth.js (clé API et adresse du relais partagées avec Gestion Commande).
============================================================================ */
(function(){
  const KEY_CFG = 'csb_envoi_axonaut_api_config';
  const DEFAULT_PROXY = 'https://axonaut-proxy.atelier-csb.workers.dev';
  const ANNUAIRE = 'https://recherche-entreprises.api.gouv.fr/search';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const asArray = d => Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : []);
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ---------- Axonaut (même clé et même relais que Gestion Commande / Devis) ----------
  async function sharedSetting(key){
    const base = CSBAuth.getPbUrl().replace(/\/+$/, '') + '/api/collections/axonaut_settings/records';
    const res = await CSBAuth.authedFetch(base + '?filter=' + encodeURIComponent(`(settings_key='${key}')`));
    if(!res.ok) return null;
    const json = await res.json();
    const rec = (json.items && json.items[0]) || null;
    return rec ? JSON.parse(rec.settings_value) : null;
  }
  let proxyPromise = null;
  function proxyUrl(){
    if(!proxyPromise) proxyPromise = sharedSetting('colissimo')
      .then(c => (c && c.workerUrl) ? c.workerUrl.replace(/\/+$/, '') : DEFAULT_PROXY)
      .catch(() => DEFAULT_PROXY);
    return proxyPromise;
  }
  async function apiKey(){
    if(window.csbHost){
      try{ const cfg = await window.csbHost.getConfig(); if(cfg && cfg[KEY_CFG] && cfg[KEY_CFG].apiKey) return cfg[KEY_CFG].apiKey; }catch(e){}
    }
    return null;
  }
  async function axonaut(path, method, body){
    const key = await apiKey();
    if(!key) throw new Error("Clé API Axonaut non configurée sur ce poste (Gestion Commande → Réglages ⚙︎).");
    const init = { method: method || 'GET', headers: { 'Content-Type': 'application/json', 'x-axonaut-key': key } };
    if(body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch((await proxyUrl()) + '?path=' + encodeURIComponent(path), init);
    const text = await res.text();
    let data = null; try{ data = JSON.parse(text); }catch(e){}
    if(!res.ok) throw new Error('Axonaut HTTP ' + res.status + (text ? ' — ' + text.slice(0, 200) : ''));
    return data;
  }

  // ---------- Annuaire des entreprises ----------
  // N° de TVA intracommunautaire français calculé à partir du SIREN.
  function tvaFromSiren(siren){
    if(!/^\d{9}$/.test(String(siren || ''))) return '';
    const key = (12 + 3 * (Number(siren) % 97)) % 97;
    return 'FR' + String(key).padStart(2, '0') + siren;
  }
  // « 72 RUE DU DESSOUS » -> « 72 Rue du Dessous » (petits mots en minuscules, sauf en tête).
  const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'sur', 'sous', 'lès', 'l', 'd']);
  const titleCase = s => String(s || '').toLowerCase()
    .replace(/(^|[\s'’\-])([a-zà-ÿ]+)/g, (m, a, w, i) => a + (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));
  function annuaireToCompany(r){
    const s = r.siege || {};
    const voie = [s.numero_voie, s.indice_repetition, s.type_voie, s.libelle_voie].filter(Boolean).join(' ');
    const street = titleCase([voie, s.complement_adresse].filter(Boolean).join(', ')) || titleCase((s.adresse || '').replace(s.code_postal || '', '').replace(s.libelle_commune || '', '').trim());
    return {
      name: r.nom_complet || r.nom_raison_sociale || '',
      siren: r.siren || '', siret: s.siret || '', tva: tvaFromSiren(r.siren),
      street, zip: s.code_postal || '', city: titleCase(s.libelle_commune || ''),
      naf: r.activite_principale || s.activite_principale || '',
      closed: r.etat_administratif === 'F' || s.etat_administratif === 'F',
      dirigeant: ((r.dirigeants || [])[0] || {}),
    };
  }
  async function searchAnnuaire(name, zip, city){
    const q = [name, /^\d{5}$/.test(zip) ? '' : city].filter(Boolean).join(' ').trim();
    if(q.length < 3) return [];
    let url = ANNUAIRE + '?per_page=8&q=' + encodeURIComponent(q);
    if(/^\d{5}$/.test(zip)) url += '&code_postal=' + zip;
    const res = await fetch(url);
    if(res.status === 429) throw new Error("trop de recherches d'affilée, réessaie dans une seconde");
    if(!res.ok) throw new Error('annuaire HTTP ' + res.status);
    const json = await res.json();
    // sociétés en activité d'abord, les fermées à la fin
    return (json.results || []).map(annuaireToCompany).sort((x, y) => (x.closed ? 1 : 0) - (y.closed ? 1 : 0));
  }

  // ---------- Fenêtre ----------
  const CSS = `
  .csbc-bg{position:fixed; inset:0; background:rgba(33,28,22,.45); z-index:1000; display:flex; align-items:flex-start; justify-content:center; padding:30px 16px; overflow-y:auto; font-family:inherit;}
  .csbc{background:#fff; border-radius:14px; width:720px; max-width:100%; padding:20px 22px; box-shadow:0 20px 60px rgba(0,0,0,.25); color:#211C16; font-size:13px;}
  .csbc h3{margin:0 0 4px; font-size:18px;}
  .csbc .hint{color:#8A8074; font-size:12px; margin:0 0 12px;}
  .csbc .row{display:flex; gap:10px; flex-wrap:wrap; margin-top:8px;}
  .csbc .f{display:flex; flex-direction:column; gap:3px; flex:1; min-width:150px;}
  .csbc .f label{font-size:11.5px; font-weight:600; color:#5F574D;}
  .csbc input, .csbc textarea, .csbc select{font:inherit; border:1px solid #E7E0D3; border-radius:8px; padding:7px 9px; background:#fff; color:inherit; width:100%; box-sizing:border-box;}
  .csbc textarea{min-height:56px; resize:vertical;}
  .csbc .sec{margin-top:16px; padding-top:12px; border-top:1px solid #EFE9DE;}
  .csbc .sec h4{margin:0 0 6px; font-size:13.5px;}
  .csbc .btn{font:inherit; border:1px solid #E7E0D3; background:#fff; border-radius:9px; padding:7px 13px; cursor:pointer;}
  .csbc .btn.primary{background:linear-gradient(135deg,#211C16,#B5452F); color:#fff; border-color:transparent;}
  .csbc .btn.small{padding:4px 9px; font-size:12px;}
  .csbc .btn:disabled{opacity:.5; cursor:default;}
  .csbc .actions{display:flex; justify-content:flex-end; gap:8px; margin-top:16px;}
  .csbc .status{font-size:12.5px; margin-top:8px; color:#5F574D;}
  .csbc .status.err{color:#B5452F;} .csbc .status.ok{color:#3E7A52;}
  .csbc .name-wrap{position:relative;}
  .csbc .sugg{position:absolute; left:0; right:0; top:100%; margin-top:3px; background:#fff; border:1px solid #E7E0D3; border-radius:10px; box-shadow:0 10px 28px rgba(0,0,0,.12); max-height:330px; overflow-y:auto; z-index:5; display:none;}
  .csbc .sugg.show{display:block;}
  .csbc .sg{padding:8px 11px; cursor:pointer; border-bottom:1px solid #F3EEE5;}
  .csbc .sg:hover{background:#FBF7F0;}
  .csbc .sg .a{font-weight:600;} .csbc .sg .b{color:#8A8074; font-size:11.5px;}
  .csbc .sg .x{color:#B5452F; font-weight:600; font-size:11px;}
  .csbc .dup{background:#FFF4E5; border:1px solid #F1D3A6; border-radius:8px; padding:8px 10px; margin-top:8px; font-size:12.5px;}
  .csbc table{width:100%; border-collapse:collapse; margin-top:4px;}
  .csbc td{padding:3px 3px; vertical-align:middle;}
  .csbc td input{padding:5px 7px;}
  `;
  function ensureCss(){
    if(document.getElementById('csbc-css')) return;
    const st = document.createElement('style'); st.id = 'csbc-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  async function open(opts){
    opts = opts || {};
    ensureCss();
    const editing = !!opts.companyId;
    const bg = document.createElement('div');
    bg.className = 'csbc-bg';
    bg.innerHTML = `<div class="csbc">
      <h3>${editing ? 'Modifier le client' : 'Nouveau client dans Axonaut'}</h3>
      <div class="hint">En tapant le nom (complet ou partiel), la société est recherchée dans l'annuaire officiel des entreprises — en tenant compte du code postal et de la ville s'ils sont remplis. Choisis-la pour remplir SIRET, TVA et adresse.</div>
      <div class="f name-wrap"><label>Nom de la société (ou du client) *</label><input type="text" data-k="name" autocomplete="off"><div class="sugg"></div></div>
      <div class="row">
        <div class="f"><label>SIRET</label><input type="text" data-k="siret"></div>
        <div class="f"><label>N° TVA intracommunautaire</label><input type="text" data-k="intracommunity_number"></div>
        <div class="f"><label>Code tiers</label><input type="text" data-k="thirdparty_code"></div>
      </div>
      <div class="row"><div class="f" style="min-width:100%;"><label>Adresse</label><input type="text" data-k="address_street"></div></div>
      <div class="row">
        <div class="f" style="max-width:130px;"><label>Code postal</label><input type="text" data-k="address_zip_code"></div>
        <div class="f"><label>Ville</label><input type="text" data-k="address_city"></div>
        <div class="f" style="max-width:170px;"><label>Pays</label><input type="text" data-k="address_country"></div>
      </div>
      <div class="row">
        <div class="f"><label>Nom du contact sur l'adresse</label><input type="text" data-k="address_contact_name"></div>
        ${editing ? '' : `<div class="f" style="max-width:200px;"><label>Type</label><select data-k="type"><option value="prospect">Prospect</option><option value="customer">Client</option></select></div>`}
      </div>
      ${editing ? '' : `<label style="display:flex; gap:8px; align-items:center; margin-top:8px;"><input type="checkbox" data-k="isB2C" style="width:auto;"> Particulier (B2C)</label>`}
      <div class="row"><div class="f" style="min-width:100%;"><label>Commentaires</label><textarea data-k="comments"></textarea></div></div>
      <div class="dupbox"></div>
      <div class="sec">
        <h4>${editing ? 'Contacts' : 'Premier contact (facultatif)'}</h4>
        <div class="contacts"></div>
      </div>
      <div class="status"></div>
      <div class="actions">
        <button class="btn" data-act="cancel">Fermer</button>
        <button class="btn primary" data-act="save">${editing ? 'Enregistrer dans Axonaut' : 'Créer le client dans Axonaut'}</button>
      </div>
    </div>`;
    document.body.appendChild(bg);
    const $ = sel => bg.querySelector(sel);
    const field = k => bg.querySelector(`[data-k="${k}"]`);
    const status = (msg, cls) => { const s = $('.status'); s.textContent = msg || ''; s.className = 'status' + (cls ? ' ' + cls : ''); };
    const close = () => bg.remove();
    $('[data-act="cancel"]').addEventListener('click', close);
    bg.addEventListener('mousedown', e => { if(e.target === bg) close(); });

    let company = null;
    let contacts = [];
    field('address_country').value = 'France';
    if(editing){
      status('Chargement de la fiche…');
      try{
        company = await axonaut('/companies/' + opts.companyId);
        ['name','siret','intracommunity_number','thirdparty_code','address_street','address_zip_code','address_city','address_country','address_contact_name','comments']
          .forEach(k => { if(field(k) && company[k] != null) field(k).value = company[k]; });
        contacts = asArray(await axonaut('/companies/' + opts.companyId + '/employees').catch(() => []));
        status('');
      }catch(e){ status('Impossible de charger la fiche : ' + e.message, 'err'); }
    }else{
      field('name').value = opts.prefillName || '';
    }
    renderContacts();
    field('name').focus();

    // --- Recherche dans l'annuaire pendant la saisie ---
    const sugg = $('.sugg');
    let reqId = 0, lastResults = [];
    const runSearch = debounce(async () => {
      const name = field('name').value.trim();
      if(name.length < 3){ sugg.classList.remove('show'); return; }
      const my = ++reqId;
      sugg.innerHTML = '<div class="sg"><span class="b">Recherche dans l\'annuaire des entreprises…</span></div>'; sugg.classList.add('show');
      try{
        const list = await searchAnnuaire(name, field('address_zip_code').value.trim(), field('address_city').value.trim());
        if(my !== reqId) return;
        lastResults = list;
        sugg.innerHTML = list.length ? list.map((c, i) => `<div class="sg" data-i="${i}">
            <div class="a">${esc(c.name)} ${c.closed ? '<span class="x">· fermée</span>' : ''}</div>
            <div class="b">${esc([c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(' — '))}</div>
            <div class="b">SIRET ${esc(c.siret || '—')}${c.naf ? ' · NAF ' + esc(c.naf) : ''}</div>
          </div>`).join('') + '<div class="sg" data-i="-1"><span class="b">Ne rien reprendre de l\'annuaire</span></div>'
          : '<div class="sg" data-i="-1"><span class="b">Aucune société trouvée dans l\'annuaire (complète le code postal ou la ville pour affiner).</span></div>';
        sugg.querySelectorAll('.sg[data-i]').forEach(el => el.addEventListener('mousedown', e => {
          e.preventDefault();
          const i = Number(el.dataset.i);
          sugg.classList.remove('show');
          if(i >= 0) applyAnnuaire(lastResults[i]);
        }));
      }catch(e){
        if(my === reqId) sugg.innerHTML = `<div class="sg"><span class="b">Annuaire indisponible : ${esc(e.message)}</span></div>`;
      }
    }, 450);
    field('name').addEventListener('input', runSearch);
    field('name').addEventListener('focus', () => { if(sugg.innerHTML) sugg.classList.add('show'); });
    field('name').addEventListener('blur', () => setTimeout(() => sugg.classList.remove('show'), 150));
    // Code postal ou ville modifiés après coup : on relance la recherche avec ces infos.
    ['address_zip_code', 'address_city'].forEach(k => field(k).addEventListener('change', () => { if(document.activeElement !== field('name') && field('name').value.trim().length >= 3 && !field('siret').value) { field('name').focus(); runSearch(); } }));

    function applyAnnuaire(c){
      if(!c) return;
      field('name').value = c.name;
      if(c.siret) field('siret').value = c.siret;
      if(c.tva) field('intracommunity_number').value = c.tva;
      if(c.street) field('address_street').value = c.street;
      if(c.zip) field('address_zip_code').value = c.zip;
      if(c.city) field('address_city').value = c.city;
      field('address_country').value = 'France';
      status(c.closed ? '⚠ Cette société est indiquée comme fermée dans l\'annuaire.' : 'Infos reprises de l\'annuaire — vérifie avant d\'enregistrer.', c.closed ? 'err' : 'ok');
      checkDuplicate();
    }

    // --- Doublon : un client Axonaut avec le même SIRET existe déjà ? ---
    async function checkDuplicate(){
      const box = $('.dupbox');
      box.innerHTML = '';
      const siret = field('siret').value.replace(/\s/g, '');
      if(!/^\d{14}$/.test(siret)) return;
      try{
        const found = asArray(await axonaut('/companies?siret=' + siret)).filter(c => !company || String(c.id) !== String(company.id));
        if(found.length){
          box.innerHTML = `<div class="dup">⚠ Ce SIRET existe déjà dans Axonaut : <strong>${esc(found[0].name)}</strong>${found[0].address_city ? ' (' + esc(found[0].address_city) + ')' : ''}.
            <button class="btn small" data-dup="${found[0].id}">Ouvrir cette fiche</button></div>`;
          box.querySelector('[data-dup]').addEventListener('click', () => { close(); open(Object.assign({}, opts, { companyId: found[0].id })); });
        }
      }catch(e){ /* vérification facultative */ }
    }
    field('siret').addEventListener('change', checkDuplicate);

    // --- Contacts ---
    function contactRow(c, i){
      return `<tr data-ci="${i}">
        <td><input data-c="firstname" placeholder="Prénom" value="${esc(c.firstname)}"></td>
        <td><input data-c="lastname" placeholder="Nom" value="${esc(c.lastname)}"></td>
        <td><input data-c="email" placeholder="Email" value="${esc(c.email)}"></td>
        <td><input data-c="phone_number" placeholder="Téléphone" value="${esc(c.phone_number)}"></td>
        <td><input data-c="cellphone_number" placeholder="Portable" value="${esc(c.cellphone_number)}"></td>
        ${editing ? `<td style="white-space:nowrap;"><button class="btn small" data-csave="${i}">${c.id ? 'Enregistrer' : 'Ajouter'}</button></td>` : ''}
      </tr>`;
    }
    function renderContacts(){
      const rows = editing ? contacts.concat([{}]) : [contacts[0] || {}];
      $('.contacts').innerHTML = `<table>${rows.map(contactRow).join('')}</table>
        ${editing ? '<div class="hint" style="margin:6px 0 0;">La dernière ligne sert à ajouter un contact.</div>' : ''}`;
      bg.querySelectorAll('[data-csave]').forEach(b => b.addEventListener('click', () => saveContact(Number(b.dataset.csave), b)));
    }
    const readContact = i => {
      const tr = bg.querySelector(`tr[data-ci="${i}"]`); const o = {};
      tr.querySelectorAll('[data-c]').forEach(inp => { o[inp.dataset.c] = inp.value.trim(); });
      return o;
    };
    async function saveContact(i, btn){
      const c = readContact(i);
      if(!c.lastname && !c.firstname && !c.email){ status('Indique au moins un nom ou un email pour le contact.', 'err'); return; }
      btn.disabled = true;
      try{
        const existing = contacts[i];
        if(existing && existing.id) contacts[i] = Object.assign({}, existing, await axonaut('/employees/' + existing.id, 'PATCH', c));
        else contacts.push(await axonaut('/employees', 'POST', Object.assign({ company_id: Number(opts.companyId) }, c)));
        status('✔ Contact enregistré dans Axonaut.', 'ok');
        renderContacts();
      }catch(e){ btn.disabled = false; status('Échec du contact : ' + e.message, 'err'); }
    }

    // --- Enregistrement de la fiche ---
    $('[data-act="save"]').addEventListener('click', async () => {
      const v = k => (field(k) ? field(k).value.trim() : '');
      if(!v('name')){ status('Le nom est obligatoire.', 'err'); field('name').focus(); return; }
      const body = {};
      ['name','siret','intracommunity_number','thirdparty_code','address_street','address_zip_code','address_city','address_country','address_contact_name','comments']
        .forEach(k => { body[k] = k === 'siret' ? v(k).replace(/\s/g, '') : v(k); });
      const btn = $('[data-act="save"]');
      btn.disabled = true;
      try{
        let saved;
        if(editing){
          status('Enregistrement dans Axonaut…');
          saved = await axonaut('/companies/' + opts.companyId, 'PATCH', body);
        }else{
          Object.assign(body, { is_prospect: v('type') !== 'customer', is_customer: v('type') === 'customer', isB2C: field('isB2C').checked, currency: 'EUR', language: 'fr' });
          const c0 = readContact(0);
          if(c0.firstname || c0.lastname || c0.email || c0.phone_number || c0.cellphone_number){
            body.employees = [{ firstname: c0.firstname, lastname: c0.lastname || v('name'), email: c0.email, phoneNumber: c0.phone_number, cellphoneNumber: c0.cellphone_number, is_billing_contact: true }];
          }
          status('Création dans Axonaut…');
          saved = await axonaut('/companies', 'POST', body);
          if(!saved || !saved.id) throw new Error("réponse d'Axonaut inattendue");
        }
        const result = Object.assign({}, company || {}, body, saved || {});
        close();
        if(opts.onSaved) opts.onSaved(result);
      }catch(e){
        btn.disabled = false;
        status('Échec : ' + e.message, 'err');
      }
    });
  }

  window.CSBClients = { open, axonaut, searchAnnuaire, tvaFromSiren };
})();
