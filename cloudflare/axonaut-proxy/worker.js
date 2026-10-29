/*
 * ============================================================================================
 *  Relais Atelier CSB (Cloudflare Worker) = relais existant + suivi des devis.
 *
 *  1) RELAIS EXISTANT, INCHANGÉ (code d'origine plus bas, sous « relaisExistant ») :
 *     adresse racine avec ?path= (Axonaut), ?img= (images), ?valento=, ?colissimo=.
 *  2) SUIVI DES DEVIS (module Devis de l'application), sur des chemins à part :
 *     /d/<jeton>…     page client du devis (consultation, téléchargement, « J'accepte »)
 *     /api/devis…     dépôt des devis et lecture du suivi par l'application (en-tête x-api-key)
 *     Liaisons nécessaires : KV namespace « DEVIS » + secret « DEVIS_API_KEY ».
 *
 *  Toute requête qui ne commence pas par /d/ ou /api/devis va au relais existant, exactement
 *  comme avant. Sauvegarde de l'ancien code : worker-avant-suivi.js.
 * ============================================================================================
 */

const MAX_EVENTS = 300;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (/^\/(d|api\/devis)(\/|$)/.test(url.pathname)) return suiviDevis(request, env, url);
    return relaisExistant.fetch(request, env, ctx);
  }
};

async function suiviDevis(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (path.startsWith('/api/')) return cors(await handleApi(request, env, url, path));
    const m = path.match(/^\/d\/([A-Za-z0-9_-]{20,64})(\/[a-z]+)?$/);
    if (m) return await handleClient(request, env, url, m[1], m[2] || '');
    return notFound();
  } catch (e) {
    return new Response('Erreur : ' + (e && e.message ? e.message : e), { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}

// ============================================================================================
//  SUIVI DES DEVIS
// ============================================================================================
// ---------------------------------------------------------------- API (application)
async function handleApi(request, env, url, path) {
  const apiKey = env.DEVIS_API_KEY || env.API_KEY;
  if (!apiKey || request.headers.get('x-api-key') !== apiKey) return json({ error: 'clé invalide' }, 401);
  if (!env.DEVIS) return json({ error: 'KV « DEVIS » non lié au worker' }, 500);

  if (path === '/api/devis' && request.method === 'POST') {
    const body = await request.json();
    let token = body.token && /^[A-Za-z0-9_-]{20,64}$/.test(body.token) ? body.token : randomToken();
    const prev = await getJson(env, 'meta:' + token);
    const meta = {
      numero: String(body.numero || ''), client: String(body.client || ''),
      totalHt: num(body.totalHt), totalTtc: num(body.totalTtc), expiry: String(body.expiry || ''),
      atelier: body.atelier || {}, closed: false, closedReason: '',
      // reaccept : commande modifiée renvoyée au client, qui doit accepter la nouvelle version
      // (l'accord précédent est conservé dans previousAcceptances).
      accepted: body.reaccept ? null : (prev ? prev.accepted || null : null),
      previousAcceptances: (prev && prev.previousAcceptances ? prev.previousAcceptances : []).concat(body.reaccept && prev && prev.accepted ? [prev.accepted] : []),
      createdAt: prev ? prev.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString(),
      version: prev ? (prev.version || 1) + 1 : 1
    };
    if (body.pdfBase64) await env.DEVIS.put('pdf:' + token, base64ToBytes(body.pdfBase64));
    if (body.logoDataUrl && /^data:image\/(png|jpeg);base64,/.test(body.logoDataUrl)) await env.DEVIS.put('asset:logo', body.logoDataUrl);
    await env.DEVIS.put('meta:' + token, JSON.stringify(meta));
    return json({ token, url: url.origin + '/d/' + token });
  }
  let m;
  if ((m = path.match(/^\/api\/devis\/([A-Za-z0-9_-]{20,64})\/events$/)) && request.method === 'GET') {
    const meta = await getJson(env, 'meta:' + m[1]);
    if (!meta) return json({ error: 'devis inconnu' }, 404);
    const events = (await getJson(env, 'events:' + m[1])) || [];
    return json({ numero: meta.numero, accepted: meta.accepted || null, closed: !!meta.closed, events });
  }
  if ((m = path.match(/^\/api\/devis\/([A-Za-z0-9_-]{20,64})\/close$/)) && request.method === 'POST') {
    const meta = await getJson(env, 'meta:' + m[1]);
    if (!meta) return json({ error: 'devis inconnu' }, 404);
    const body = await request.json().catch(() => ({}));
    meta.closed = true; meta.closedReason = String(body.reason || '');
    await env.DEVIS.put('meta:' + m[1], JSON.stringify(meta));
    return json({ ok: true });
  }
  return json({ error: 'route inconnue' }, 404);
}

// ---------------------------------------------------------------- pages client
async function handleClient(request, env, url, token, sub) {
  const meta = await getJson(env, 'meta:' + token);
  if (!meta) return notFound();

  if (sub === '/pdf' && request.method === 'GET') {
    const pdf = await env.DEVIS.get('pdf:' + token, 'arrayBuffer');
    if (!pdf) return notFound();
    if (url.searchParams.get('dl') === '1') await addEvent(env, token, request, 'download');
    const name = `Devis ${meta.numero || ''}.pdf`.replace(/[^\w .\-À-ÿ]/g, '');
    return new Response(pdf, { headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${url.searchParams.get('dl') === '1' ? 'attachment' : 'inline'}; filename="${name}"`,
      'cache-control': 'no-store'
    } });
  }
  if (sub === '/seen' && request.method === 'POST') {
    await addEvent(env, token, request, 'open');
    return new Response(null, { status: 204 });
  }
  if (sub === '/accept' && request.method === 'POST') {
    const form = await request.formData();
    const name = String(form.get('name') || '').trim().slice(0, 120);
    const ok = form.get('ok') === 'on';
    if (meta.closed || meta.accepted || isExpired(meta)) return Response.redirect(url.origin + '/d/' + token, 303);
    if (!name || !ok) return html(page(meta, token, env, await getLogo(env), 'Indique ton nom et coche la case « Bon pour accord ».'), 400);
    meta.accepted = { at: new Date().toISOString(), name, ip: request.headers.get('cf-connecting-ip') || '', ua: (request.headers.get('user-agent') || '').slice(0, 200), version: meta.version || 1 };
    await env.DEVIS.put('meta:' + token, JSON.stringify(meta));
    await addEvent(env, token, request, 'accept', { name });
    return Response.redirect(url.origin + '/d/' + token, 303);
  }
  if (sub === '' && request.method === 'GET') {
    return html(page(meta, token, env, await getLogo(env), ''));
  }
  return notFound();
}

function page(meta, token, env, logo, error) {
  const e = escapeHtml;
  const at = meta.atelier || {};
  const expired = isExpired(meta);
  let action;
  if (meta.accepted) {
    action = `<div class="ok">✔ Devis accepté le ${e(frDateTime(meta.accepted.at))} par ${e(meta.accepted.name)}.<br>Merci ! Nous revenons vers vous rapidement.</div>`;
  } else if (meta.closed) {
    action = `<div class="warn">Ce devis n'est plus valable${meta.closedReason ? ' (' + e(meta.closedReason) + ')' : ''}. Contactez-nous pour toute question.</div>`;
  } else if (expired) {
    action = `<div class="warn">Ce devis a expiré le ${e(frDate(meta.expiry))}. Contactez-nous pour le renouveler.</div>`;
  } else {
    const prevAcc = (meta.previousAcceptances || []).slice(-1)[0];
    action = `<form method="post" action="/d/${e(token)}/accept" class="accept">
      <h2>Accepter le devis</h2>
      ${prevAcc ? `<div class="warn" style="margin-bottom:12px;">Ce devis a été modifié depuis votre accord du ${e(frDateTime(prevAcc.at))}. Merci de vérifier la nouvelle version ci-dessus et de l'accepter à nouveau.</div>` : ''}
      ${error ? `<div class="err">${e(error)}</div>` : ''}
      <label>Nom et prénom<input type="text" name="name" required maxlength="120" autocomplete="name"></label>
      <label class="chk"><input type="checkbox" name="ok" required> Bon pour accord : j'accepte le devis n° ${e(meta.numero)} d'un montant de ${e(eur(meta.totalTtc))} TTC.</label>
      <button type="submit">J'accepte le devis</button>
    </form>`;
  }
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Devis ${e(meta.numero)} — ${e(at.nom || "L'Atelier CSB")}</title>
  <style>
    :root{ --ink:#211C16; --muted:#7a7062; --blue:#1F3A66; --line:#E3E7EE; }
    *{ box-sizing:border-box; }
    body{ margin:0; font-family:-apple-system, 'Segoe UI', Roboto, Arial, sans-serif; background:#F5F2EC; color:var(--ink); }
    .wrap{ max-width:980px; margin:0 auto; padding:20px 16px 40px; }
    header{ display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
    header img{ height:64px; }
    header .t{ text-align:right; }
    header h1{ margin:0; font-size:22px; color:var(--blue); }
    .card{ background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px; margin-top:16px; }
    .sum{ display:flex; gap:24px; flex-wrap:wrap; font-size:14px; }
    .sum b{ display:block; font-size:18px; }
    .btns{ display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; }
    a.btn, button{ display:inline-block; background:var(--blue); color:#fff; border:none; border-radius:8px; padding:10px 16px; font-size:15px; font-weight:600; text-decoration:none; cursor:pointer; }
    a.btn.ghost{ background:#fff; color:var(--blue); border:1px solid var(--blue); }
    iframe{ width:100%; height:78vh; border:1px solid var(--line); border-radius:8px; margin-top:12px; background:#fff; }
    .accept h2{ margin:0 0 10px; font-size:18px; }
    .accept label{ display:block; margin-bottom:10px; font-size:14px; }
    .accept input[type=text]{ display:block; width:100%; max-width:420px; margin-top:4px; padding:9px 10px; border:1px solid #cfc7b8; border-radius:8px; font-size:15px; }
    .accept .chk{ display:flex; gap:8px; align-items:flex-start; }
    .ok{ background:#EAF4EA; border:1px solid #B9D8BA; color:#2E7D32; border-radius:10px; padding:14px; font-weight:600; }
    .warn{ background:#FFF6E0; border:1px solid #EBD59A; border-radius:10px; padding:14px; }
    .err{ color:#B5452F; margin-bottom:10px; }
    footer{ margin-top:24px; font-size:12px; color:var(--muted); text-align:center; line-height:1.6; }
  </style></head><body><div class="wrap">
    <header>
      ${logo ? `<img src="${logo}" alt="${e(at.nom || '')}">` : `<strong style="font-size:20px;">${e(at.nom || "L'Atelier CSB")}</strong>`}
      <div class="t"><h1>Devis n° ${e(meta.numero)}</h1><div>${e(meta.client)}</div></div>
    </header>
    <div class="card">
      <div class="sum">
        <div>Montant HT<b>${e(eur(meta.totalHt))}</b></div>
        <div>Montant TTC<b>${e(eur(meta.totalTtc))}</b></div>
        ${meta.expiry ? `<div>Valable jusqu'au<b>${e(frDate(meta.expiry))}</b></div>` : ''}
      </div>
      <div class="btns">
        <a class="btn ghost" href="/d/${e(token)}/pdf?dl=1">⬇ Télécharger le PDF</a>
        <a class="btn ghost" href="/d/${e(token)}/pdf" target="_blank" rel="noopener">Ouvrir le PDF</a>
      </div>
      <iframe src="/d/${e(token)}/pdf" title="Devis ${e(meta.numero)}"></iframe>
    </div>
    <div class="card">${action}</div>
    <footer>${e(at.nom || "L'Atelier CSB")}${at.tel ? ' · ' + e(at.tel) : ''}${at.email ? ' · ' + e(at.email) : ''}</footer>
  </div>
  <script>
    // Ouverture réelle (les robots qui pré-chargent les liens des emails n'exécutent pas ce script).
    fetch('/d/${token}/seen', { method: 'POST', keepalive: true }).catch(function(){});
  </script>
  </body></html>`;
}

// ---------------------------------------------------------------- utilitaires
async function addEvent(env, token, request, type, extra) {
  const key = 'events:' + token;
  const events = (await getJson(env, key)) || [];
  events.push(Object.assign({
    type, at: new Date().toISOString(),
    ip: request.headers.get('cf-connecting-ip') || '',
    country: (request.cf && request.cf.country) || '',
    ua: (request.headers.get('user-agent') || '').slice(0, 200)
  }, extra || {}));
  await env.DEVIS.put(key, JSON.stringify(events.slice(-MAX_EVENTS)));
}
async function getJson(env, key) {
  const v = await env.DEVIS.get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
async function getLogo(env) { return (await env.DEVIS.get('asset:logo')) || ''; }
function isExpired(meta) {
  if (!meta.expiry) return false;
  return new Date(meta.expiry + 'T23:59:59') < new Date();
}
function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function eur(n) { return num(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }); }
function frDate(iso) { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; }
function frDateTime(iso) { return new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8' } }); }
function html(body, status) { return new Response(body, { status: status || 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } }); }
function notFound() { return new Response('Devis introuvable.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
function cors(res) {
  const r = new Response(res.body, res);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'content-type, x-api-key');
  return r;
}

// ============================================================================================
//  RELAIS EXISTANT (code d'origine, seul « export default » a été renommé en relaisExistant)
// ============================================================================================
/**
 * Relais (proxy) vers l'API Axonaut + relais d'images TopTex + relais API Valento
 * + relais API Colissimo (SLS) — Cloudflare Workers (gratuit).
 *
 * 1) Relais Axonaut : https://TON-WORKER.workers.dev?path=/me
 *      Header:  x-axonaut-key: <ta clé API Axonaut>
 *
 * 2) Relais image TopTex : https://TON-WORKER.workers.dev?img=<url encodée>
 *
 * 3) Relais Valento (API catalogue, authentification HTTP Basic, pas de CORS côté Valento) :
 *      https://TON-WORKER.workers.dev?valento=/catalog_feed.php%3Fpage=1%26page_size=500
 *      Header:  Authorization: Basic <base64(user:pass)>  (le navigateur le construit et le
 *      Worker le retransmet tel quel à Valento)
 *
 * 4) Relais Colissimo (Web Service SLS v3.1, REST, authentification par apiKey) :
 *      https://TON-WORKER.workers.dev?colissimo=/generateLabel   (POST, corps JSON)
 *      https://TON-WORKER.workers.dev?colissimo=/checkGenerateLabel
 *      https://TON-WORKER.workers.dev?colissimo=/getLabel
 *      etc. — la clé apiKey est injectée côté Worker depuis le secret COLISSIMO_API_KEY,
 *      jamais transmise ni visible depuis le navigateur.
 *
 *      Particularité : generateLabel (contrairement à checkGenerateLabel) répond en
 *      multipart — un objet JSON nommé "jsonInfos" (parcelNumber, etc.) et jusqu'à 3
 *      pièces jointes binaires nommées "label", "cn23" et "proforma" (doc officielle
 *      Colissimo). Le Worker les retrouve par leur nom et renvoie un JSON unique et
 *      simple au navigateur :
 *        { ...champs de la réponse..., labelContentType, labelBase64, cn23ContentType, cn23Base64 }
 */

const ALLOWED_IMAGE_HOSTS = [
  "cdn.toptex.com",
  "media.europeancatalog.com",
  "valentocatalog.eu",
  "www.valentocatalog.eu",
  "download.falk-ross.eu",
];

const COLISSIMO_BASE = "https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.1";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-axonaut-key, Authorization",
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

// ---------- Aides binaire <-> chaîne latin1 (pour manipuler du binaire dans une string JS sans Buffer) ----------
function bytesToLatin1String(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return s;
}
function latin1StringToBytes(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  return bytes;
}
function bytesToBase64(bytes) {
  return btoa(bytesToLatin1String(bytes));
}

// ---------- Découpe une réponse multipart/related ou multipart/mixed en parties {headers, bodyBytes} ----------
function parseMultipart(arrayBuffer, contentType) {
  const m = /boundary="?([^";]+)"?/i.exec(contentType || "");
  if (!m) return null;
  const boundary = "--" + m[1];
  const bytes = new Uint8Array(arrayBuffer);
  const full = bytesToLatin1String(bytes);
  const rawParts = full.split(boundary).slice(1, -1); // enlève préambule et épilogue final "--"
  const parts = [];
  for (let raw of rawParts) {
    if (raw.startsWith("\r\n")) raw = raw.slice(2);
    if (raw.endsWith("\r\n")) raw = raw.slice(0, -2);
    const sep = raw.indexOf("\r\n\r\n");
    if (sep === -1) continue;
    const headerBlock = raw.slice(0, sep);
    const bodyStr = raw.slice(sep + 4);
    const headers = {};
    headerBlock.split("\r\n").forEach((line) => {
      const idx = line.indexOf(":");
      if (idx > -1) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    });
    parts.push({ headers, bodyBytes: latin1StringToBytes(bodyStr) });
  }
  return parts;
}

const relaisExistant = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // ---- Relais image TopTex ----
    const imgParam = url.searchParams.get("img");
    if (imgParam) {
      try {
        const target = new URL(imgParam);
        if (!ALLOWED_IMAGE_HOSTS.includes(target.hostname)) {
          return jsonResponse({ error: "Domaine image non autorisé : " + target.hostname }, 403);
        }
        const imgRes = await fetch(target.toString());
        if (!imgRes.ok) {
          return jsonResponse({ error: "Échec du téléchargement de l'image (HTTP " + imgRes.status + ")" }, imgRes.status);
        }
        const contentType = imgRes.headers.get("Content-Type") || "image/jpeg";
        return new Response(imgRes.body, {
          status: 200,
          headers: { ...corsHeaders(), "Content-Type": contentType },
        });
      } catch (e) {
        return jsonResponse({ error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    // ---- Relais Valento ----
    const valentoParam = url.searchParams.get("valento");
    if (valentoParam) {
      try {
        if (!valentoParam.startsWith("/")) {
          return jsonResponse({ error: "Paramètre ?valento=/... invalide" }, 400);
        }
        const authHeader = request.headers.get("Authorization"); // optionnel : utilisé seulement en mode identifiant/mot de passe
        const targetUrl = "https://www.valento.es/rest" + valentoParam;
        const fetchHeaders = { Accept: "application/json" };
        if (authHeader) fetchHeaders.Authorization = authHeader;
        const valentoRes = await fetch(targetUrl, { headers: fetchHeaders });
        const text = await valentoRes.text();
        const contentType = valentoRes.headers.get("Content-Type") || "application/json";
        return new Response(text, {
          status: valentoRes.status,
          headers: { ...corsHeaders(), "Content-Type": contentType },
        });
      } catch (e) {
        return jsonResponse({ error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    // ---- Suivi des colis Colissimo (Web Service Suivi TL « timelineCompany ») ----
    //   https://TON-WORKER.workers.dev?colissimoSuivi=<n° de colis>
    // Même clé que les étiquettes (secret COLISSIMO_API_KEY). Facultatif : secrets COLISSIMO_LOGIN et
    // COLISSIMO_PASSWORD (n° de contrat et mot de passe Colissimo Box) si la clé seule est refusée.
    const suiviParam = url.searchParams.get("colissimoSuivi");
    if (suiviParam) {
      try {
        const parcelNumber = String(suiviParam).replace(/[^A-Za-z0-9]/g, "").slice(0, 30);
        if (!parcelNumber) return jsonResponse({ error: "N° de colis manquant" }, 400);
        if (!env.COLISSIMO_API_KEY && !env.COLISSIMO_LOGIN) {
          return jsonResponse({ error: "Secret COLISSIMO_API_KEY non configuré sur le Worker" }, 500);
        }
        const body = { parcelNumber, lang: "fr_FR" };
        if (env.COLISSIMO_API_KEY) body.apiKey = env.COLISSIMO_API_KEY;
        if (env.COLISSIMO_LOGIN) { body.login = env.COLISSIMO_LOGIN; body.password = env.COLISSIMO_PASSWORD || ""; }
        const res = await fetch("https://ws.colissimo.fr/tracking-timeline-ws/rest/tracking/timelineCompany", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) {}
        return jsonResponse(parsed || { error: "Réponse Colissimo illisible", status: res.status, raw: text.slice(0, 500) }, parsed ? 200 : 502);
      } catch (e) {
        return jsonResponse({ error: "Suivi Colissimo injoignable : " + (e && e.message ? e.message : e) }, 502);
      }
    }

    // ---- Relais Colissimo (Web Service SLS) ----
    const colissimoParam = url.searchParams.get("colissimo");
    if (colissimoParam) {
      try {
        if (!colissimoParam.startsWith("/")) {
          return jsonResponse({ error: "Paramètre ?colissimo=/... invalide" }, 400);
        }
        if (!env.COLISSIMO_API_KEY) {
          return jsonResponse({ error: "Secret COLISSIMO_API_KEY non configuré sur le Worker" }, 500);
        }

        const targetUrl = COLISSIMO_BASE + colissimoParam;
        const init = {
          method: request.method,
          headers: {
            "Content-Type": "application/json",
            apiKey: env.COLISSIMO_API_KEY,
          },
        };
        if (!["GET", "HEAD"].includes(request.method)) {
          init.body = await request.text();
        }

        const colissimoRes = await fetch(targetUrl, init);
        const contentType = colissimoRes.headers.get("Content-Type") || "application/json";
        const buf = await colissimoRes.arrayBuffer();

        // Réponse multipart. D'après la doc officielle Colissimo (chapitre generateLabel) :
        // « Ce service retourne une Map contenant un objet json et 0 à 3 tableaux d'octets.
        //   L'objet json est sauvegardé avec la clé "jsonInfos"... Les trois tableaux d'octets
        //   sont chacun sauvegardés avec les clés : proforma, label et cn23. »
        // Chaque partie MIME porte donc un Content-ID (ou un name= dans Content-Disposition)
        // fixe : "jsonInfos", "label", "cn23", "proforma" — pas de référence cid: à résoudre
        // depuis le JSON, contrairement à ce qu'on pourrait attendre d'un XOP classique.
        if (contentType.toLowerCase().includes("multipart")) {
          const parts = parseMultipart(buf, contentType);
          if (!parts || parts.length === 0) {
            return jsonResponse({ error: "Réponse multipart Colissimo illisible" }, 502);
          }

          function findPartByName(name) {
            const n = name.toLowerCase();
            return (
              parts.find((p) => (p.headers["content-id"] || "").replace(/^<|>$/g, "").toLowerCase() === n) ||
              parts.find((p) => (p.headers["content-disposition"] || "").toLowerCase().includes('name="' + n + '"')) ||
              null
            );
          }

          const jsonPartEntry =
            findPartByName("jsonInfos") ||
            parts.find((p) => (p.headers["content-type"] || "").toLowerCase().includes("json"));
          let jsonPart = null;
          if (jsonPartEntry) {
            try {
              jsonPart = JSON.parse(new TextDecoder("utf-8").decode(jsonPartEntry.bodyBytes));
            } catch (e) {
              /* laissera result vide, message d'erreur transmis tel quel plus bas si besoin */
            }
          }

          const result = Object.assign({}, jsonPart || {});

          const labelPart = findPartByName("label");
          const cn23Part = findPartByName("cn23");
          const proformaPart = findPartByName("proforma");

          if (labelPart) {
            result.labelContentType = labelPart.headers["content-type"] || "application/octet-stream";
            result.labelBase64 = bytesToBase64(labelPart.bodyBytes);
          } else {
            // Filet de sécurité pour d'anciennes réponses qui fourniraient une URL signée
            // (pdfUrl) plutôt qu'une pièce jointe directe.
            const container = result.labelV31Response || result.labelV2Response || result;
            if (container.pdfUrl) {
              try {
                const pdfRes = await fetch(container.pdfUrl);
                if (pdfRes.ok) {
                  const pdfBuf = await pdfRes.arrayBuffer();
                  result.labelContentType = pdfRes.headers.get("Content-Type") || "application/pdf";
                  result.labelBase64 = bytesToBase64(new Uint8Array(pdfBuf));
                } else {
                  result.labelFetchError = "Échec de récupération via pdfUrl (HTTP " + pdfRes.status + ")";
                }
              } catch (e) {
                result.labelFetchError = "Échec de récupération via pdfUrl : " + String(e && e.message ? e.message : e);
              }
            }
          }
          if (cn23Part) {
            result.cn23ContentType = cn23Part.headers["content-type"] || "application/pdf";
            result.cn23Base64 = bytesToBase64(cn23Part.bodyBytes);
          }
          if (proformaPart) {
            result.proformaContentType = proformaPart.headers["content-type"] || "application/pdf";
            result.proformaBase64 = bytesToBase64(proformaPart.bodyBytes);
          }

          return jsonResponse(result, colissimoRes.status);
        }

        // Réponse JSON classique (checkGenerateLabel, erreurs, etc.)
        return new Response(new TextDecoder("utf-8").decode(buf), {
          status: colissimoRes.status,
          headers: { ...corsHeaders(), "Content-Type": contentType },
        });
      } catch (e) {
        return jsonResponse({ error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    // ---- Relais Axonaut ----
    try {
      const path = url.searchParams.get("path");
      if (!path || !path.startsWith("/")) {
        return jsonResponse({ error: "Paramètre ?path=/..., ?img=..., ?valento=... ou ?colissimo=... manquant ou invalide" }, 400);
      }

      const axonautKey = request.headers.get("x-axonaut-key");
      if (!axonautKey) {
        return jsonResponse({ error: "En-tête x-axonaut-key manquant" }, 400);
      }

      const targetUrl = "https://axonaut.com/api/v2" + path;
      const init = {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
          userApiKey: axonautKey,
        },
      };
      if (!["GET", "HEAD"].includes(request.method)) {
        init.body = await request.text();
      }

      const axonautRes = await fetch(targetUrl, init);
      const text = await axonautRes.text();

      return new Response(text, {
        status: axonautRes.status,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    } catch (e) {
      return jsonResponse({ error: String(e && e.message ? e.message : e) }, 500);
    }
  },
};
