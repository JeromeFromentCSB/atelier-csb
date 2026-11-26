// Besoins matière par article : éléments (rouleaux, sachets…) en stock, nomenclature d'un article
// (éléments consommés pour 1 unité), réservation à la validation d'une commande, déduction quand
// la ligne est validée sur le bon de fabrication, alerte de stock limite (mail + message dans l'appli).
//
// Collections PocketBase (à créer, voir le module « Besoins matière ») :
//   mat_elements      nom, unite, stock_min (nombre), alerte (booléen), notes
//   mat_lots          element (id de l'élément), label, initial, restant (nombres)
//   mat_nomenclature  ref, titre, lignes_json  ([{element, qte}] pour 1 unité de l'article)
//   mat_reservations  order_key, contract_id, numero, line_idx, ref, titre, qte_article,
//                     lignes_json ([{element, qte}] total de la ligne), etat (reserve|consomme), alloc_json
(function(){
  const C = { el: 'mat_elements', lot: 'mat_lots', nom: 'mat_nomenclature', res: 'mat_reservations' };
  const ALERT_KEY = 'mat_alert_emails';
  const base = c => CSBAuth.getPbUrl().replace(/\/+$/, '') + '/api/collections/' + c + '/records';
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const r3 = n => Math.round(n * 1000) / 1000;
  const norm = s => String(s || '').trim().toLowerCase();

  async function req(url, opts){
    const res = await CSBAuth.authedFetch(url, opts);
    if(!res.ok){
      const e = new Error('PocketBase HTTP ' + res.status);
      e.status = res.status; e.missing = res.status === 404;
      throw e;
    }
    return res.status === 204 ? null : res.json();
  }
  async function listAll(c, filter){
    let page = 1, all = [];
    while(page <= 50){
      const url = base(c) + `?perPage=200&page=${page}&sort=created` + (filter ? `&filter=(${encodeURIComponent(filter)})` : '');
      const j = await req(url);
      all = all.concat(j.items || []);
      if(page >= (j.totalPages || 1)) break;
      page++;
    }
    return all;
  }
  const json = (v, d) => { if(v == null || v === '') return d; if(typeof v === 'string'){ try{ return JSON.parse(v); }catch(e){ return d; } } return v; };
  const create = (c, body) => req(base(c), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const patch = (c, id, body) => req(base(c) + '/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const del = (c, id) => req(base(c) + '/' + id, { method: 'DELETE' });

  // ---- données ----
  async function loadAll(){
    const [elements, lots, noms, reservations] = await Promise.all([listAll(C.el), listAll(C.lot), listAll(C.nom), listAll(C.res)]);
    noms.forEach(n => { n._lignes = json(n.lignes_json, []); });
    reservations.forEach(r => { r._lignes = json(r.lignes_json, []); r._alloc = json(r.alloc_json, []); });
    return { elements, lots, noms, reservations };
  }
  // Stock physique (somme des restes des rouleaux/sachets), quantités réservées, disponible.
  function stockMap(data, excludeOrderKey){
    const m = new Map();
    data.elements.forEach(e => m.set(e.id, { e, stock: 0, reserve: 0 }));
    data.lots.forEach(l => { const x = m.get(l.element); if(x) x.stock += num(l.restant); });
    data.reservations.forEach(r => {
      if(r.etat !== 'reserve' || (excludeOrderKey && r.order_key === excludeOrderKey)) return;
      (r._lignes || []).forEach(l => { const x = m.get(l.element); if(x) x.reserve += num(l.qte); });
    });
    m.forEach(x => { x.stock = r3(x.stock); x.reserve = r3(x.reserve); x.dispo = r3(x.stock - x.reserve); });
    return m;
  }
  const nomOf = (data, ref) => { const k = norm(ref); return k ? data.noms.find(n => norm(n.ref) === k) : null; };

  // Besoin d'un ensemble de lignes [{productCode, quantity}] : { needs: Map(elementId → qte), managed: n }
  function needsOf(data, lines){
    const needs = new Map(); let managed = 0;
    (lines || []).forEach(l => {
      const nom = nomOf(data, l.productCode);
      if(!nom) return;
      managed++;
      const q = num(l.quantity);
      (nom._lignes || []).forEach(c => needs.set(c.element, r3((needs.get(c.element) || 0) + num(c.qte) * q)));
    });
    return { needs, managed };
  }
  // Contrôle pour un devis : rien n'est déduit ni bloqué. excludeOrderKey : ignore les réservations de cette commande.
  async function check(lines, excludeOrderKey){
    const data = await loadAll();
    const { needs, managed } = needsOf(data, lines);
    const sm = stockMap(data, excludeOrderKey);
    const shortages = [];
    needs.forEach((besoin, id) => {
      const x = sm.get(id);
      if(!x){ shortages.push({ nom: '(élément supprimé)', unite: '', besoin, dispo: 0 }); return; }
      if(besoin > x.dispo + 1e-9) shortages.push({ nom: x.e.nom, unite: x.e.unite || '', besoin, dispo: x.dispo, stock: x.stock, reserve: x.reserve });
    });
    return { shortages, managed };
  }

  // ---- réservation à la validation en commande ----
  // order : { orderKey, contractId, numero, lines:[{idx, productCode, quantity, name}] }
  async function reserve(order){
    const data = await loadAll();
    const mine = data.reservations.filter(r => r.order_key === order.orderKey);
    // on repart d'une réservation propre pour les lignes pas encore consommées
    for(const r of mine.filter(r => r.etat === 'reserve')) await del(C.res, r.id);
    const done = new Set(mine.filter(r => r.etat === 'consomme').map(r => Number(r.line_idx)));
    const { shortages } = await check(order.lines.filter(l => !done.has(Number(l.idx))), order.orderKey);
    let n = 0;
    for(const l of order.lines){
      if(done.has(Number(l.idx))) continue;
      const nom = nomOf(data, l.productCode);
      if(!nom) continue;
      const q = num(l.quantity);
      const lignes = (nom._lignes || []).map(c => ({ element: c.element, qte: r3(num(c.qte) * q) })).filter(c => c.qte > 0);
      if(!lignes.length) continue;
      await create(C.res, { order_key: order.orderKey, contract_id: String(order.contractId || ''), numero: order.numero || '', line_idx: Number(l.idx),
        ref: l.productCode || '', titre: l.name || nom.titre || '', qte_article: q, lignes_json: lignes, etat: 'reserve', alloc_json: [] });
      n++;
    }
    return { reserved: n, shortages };
  }
  async function release(orderKey){
    const rs = (await listAll(C.res, `order_key='${String(orderKey).replace(/'/g, '')}' && etat='reserve'`));
    for(const r of rs) await del(C.res, r.id);
    return rs.length;
  }

  // ---- déduction : ligne validée / dévalidée sur le bon de fabrication ----
  async function consume(r, data){
    const alloc = [];
    for(const c of (r._lignes || [])){
      let reste = num(c.qte);
      const lots = data.lots.filter(l => l.element === c.element && num(l.restant) > 0);
      for(const lot of lots){
        if(reste <= 1e-9) break;
        const take = Math.min(num(lot.restant), reste);
        lot.restant = r3(num(lot.restant) - take);
        await patch(C.lot, lot.id, { restant: lot.restant });
        alloc.push({ lot: lot.id, element: c.element, qte: r3(take) });
        reste = r3(reste - take);
      }
      if(reste > 1e-9) alloc.push({ lot: '', element: c.element, qte: reste }); // stock insuffisant : manque noté
    }
    await patch(C.res, r.id, { etat: 'consomme', alloc_json: alloc });
    r.etat = 'consomme'; r._alloc = alloc;
  }
  async function restore(r, data){
    for(const a of (r._alloc || [])){
      if(!a.lot) continue;
      const lot = data.lots.find(l => l.id === a.lot);
      if(!lot) continue;
      lot.restant = r3(num(lot.restant) + num(a.qte));
      await patch(C.lot, lot.id, { restant: lot.restant });
    }
    await patch(C.res, r.id, { etat: 'reserve', alloc_json: [] });
    r.etat = 'reserve'; r._alloc = [];
  }
  // Aligne les stocks sur l'état des lignes validées (lines_state) d'une commande.
  async function syncOrder(orderKey, linesState){
    const data = await loadAll();
    const mine = data.reservations.filter(r => r.order_key === orderKey);
    let changed = 0;
    for(const r of mine){
      const ok = linesState && linesState[r.line_idx] === true;
      if(ok && r.etat === 'reserve'){ await consume(r, data); changed++; }
      else if(!ok && r.etat === 'consomme'){ await restore(r, data); changed++; }
    }
    if(changed) await checkAlerts(data);
    return changed;
  }
  // Pour les validations faites ailleurs (téléphone) : relit les lignes validées de chaque commande réservée.
  async function reconcileAll(){
    const data = await loadAll();
    const pending = data.reservations.filter(r => r.contract_id);
    const byContract = new Map();
    pending.forEach(r => { (byContract.get(r.contract_id) || byContract.set(r.contract_id, []).get(r.contract_id)).push(r); });
    let changed = 0;
    for(const [cid, rs] of byContract){
      let rec = null;
      try{ const j = await req(CSBAuth.getPbUrl().replace(/\/+$/, '') + '/api/collections/bl_axonaut/records?perPage=1&filter=(' + encodeURIComponent(`contract_id='${cid}'`) + ')'); rec = (j.items || [])[0]; }catch(e){ continue; }
      const st = (rec && rec.lines_state) || {};
      for(const r of rs){
        const ok = st[r.line_idx] === true;
        if(ok && r.etat === 'reserve'){ await consume(r, data); changed++; }
        else if(!ok && r.etat === 'consomme'){ await restore(r, data); changed++; }
      }
    }
    if(changed) await checkAlerts(data);
    return changed;
  }

  // ---- alertes de stock limite ----
  async function getSetting(key){
    const j = await req(base('axonaut_settings') + '?perPage=1&filter=(' + encodeURIComponent(`settings_key='${key}'`) + ')');
    const rec = (j.items || [])[0];
    return { rec, value: rec ? json(rec.settings_value, null) : null };
  }
  async function getAlertEmails(){ try{ const v = (await getSetting(ALERT_KEY)).value; return Array.isArray(v) ? v : []; }catch(e){ return []; } }
  async function setAlertEmails(list){
    const s = await getSetting(ALERT_KEY);
    const body = { settings_key: ALERT_KEY, settings_value: JSON.stringify(list) };
    if(s.rec) await patch('axonaut_settings', s.rec.id, body); else await create('axonaut_settings', body);
  }
  function lowList(data){
    const sm = stockMap(data);
    const out = [];
    sm.forEach(x => { if(num(x.e.stock_min) > 0 && x.stock <= num(x.e.stock_min) + 1e-9) out.push({ e: x.e, stock: x.stock, min: num(x.e.stock_min) }); });
    return out;
  }
  // Un mail par élément qui passe sous sa limite (une seule fois : il repart quand le stock est remonté).
  async function checkAlerts(data){
    data = data || await loadAll();
    const sm = stockMap(data);
    const toSend = [];
    for(const x of sm.values()){
      const min = num(x.e.stock_min);
      const low = min > 0 && x.stock <= min + 1e-9;
      if(low && !x.e.alerte){ await patch(C.el, x.e.id, { alerte: true }); x.e.alerte = true; toSend.push({ e: x.e, stock: x.stock, min }); }
      else if(!low && x.e.alerte){ await patch(C.el, x.e.id, { alerte: false }); x.e.alerte = false; }
    }
    if(toSend.length) await sendAlertMail(toSend);
    return toSend;
  }
  async function sendAlertMail(items){
    const to = await getAlertEmails();
    if(!to.length || !window.csbHost || !window.csbHost.emailSend) return false;
    const line = i => `- ${i.e.nom} : reste ${i.stock} ${i.e.unite || ''} (limite ${i.min} ${i.e.unite || ''})`;
    const text = `Stock limite atteint :\n\n${items.map(line).join('\n')}\n\nPense à recommander la matière.\n— Atelier CSB`;
    try{
      await window.csbHost.emailSend({ to: to.join(', '), subject: 'Stock limite atteint : ' + items.map(i => i.e.nom).join(', '), text,
        html: '<p>Stock limite atteint :</p><ul>' + items.map(i => `<li><b>${String(i.e.nom).replace(/</g, '&lt;')}</b> : reste ${i.stock} ${i.e.unite || ''} (limite ${i.min} ${i.e.unite || ''})</li>`).join('') + '</ul><p>Pense à recommander la matière.</p>' });
      return true;
    }catch(e){ console.warn('Alerte stock : mail non envoyé', e); return false; }
  }
  async function lowStock(){ return lowList(await loadAll()); }

  window.CSBBesoins = { C, num, r3, norm, loadAll, stockMap, nomOf, check, reserve, release, syncOrder, reconcileAll, checkAlerts, lowStock, lowList,
    getAlertEmails, setAlertEmails, sendAlertMail, create, patch, del, listAll };
})();
