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

export default {
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
