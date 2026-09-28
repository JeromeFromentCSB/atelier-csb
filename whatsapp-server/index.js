// Petit serveur WhatsApp pour l'Atelier CSB.
// ============================================================================
// Rôle : envoyer une photo (hébergée sur PocketBase) à un contact WhatsApp précis, sur demande
// de la page mobile "Photos commandes" (mobile/photo.html). Utilise whatsapp-web.js, qui pilote
// une session WhatsApp Web comme un vrai navigateur — pas l'API WhatsApp Business officielle
// (plus simple et gratuite, mais non officielle : à réserver à un usage ponctuel, pas massif).
//
// Démarrage :
//   cd whatsapp-server
//   npm install
//   npm start
// La première fois, un QR code s'affiche dans le terminal (et sur http://<ce-pc>:8092/qr) :
// à scanner depuis WhatsApp sur le téléphone du compte qui doit envoyer les photos
// (Réglages > Appareils liés > Lier un appareil). Ensuite, la session reste connectée toute
// seule (fichier .wwebjs_auth à côté de ce script) — plus besoin de rescanner, sauf si on
// déconnecte l'appareil lié depuis le téléphone.
//
// Ce serveur doit tourner en continu sur le PC de l'atelier (comme PocketBase), sur le même
// réseau que le téléphone qui utilise la page mobile.

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const nodemailer = require('nodemailer');
const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const PORT = process.env.CSB_WHATSAPP_PORT || 8092;

const app = express();
app.use(express.json());
// La page mobile est servie par PocketBase (port 8090), ce serveur écoute sur un autre port
// (8092) : sans ces en-têtes, le navigateur du téléphone bloque silencieusement les requêtes
// (politique CORS "cross-origin"), ce qui donnait l'impression que le bouton "Envoyer" ne
// faisait rien.
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));

let lastQr = null;
let clientReady = false;
let clientError = null;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox'] },
});

client.on('qr', (qr) => {
  lastQr = qr;
  clientReady = false;
  console.log('\nScanne ce QR code depuis WhatsApp (Réglages > Appareils liés > Lier un appareil) :\n');
  require('qrcode-terminal').generate(qr, { small: true });
  console.log(`\nOu ouvre http://localhost:${PORT}/qr depuis un navigateur sur ce PC.\n`);
});
client.on('ready', () => {
  lastQr = null;
  clientReady = true;
  clientError = null;
  console.log('WhatsApp connecté — le serveur est prêt à envoyer des photos.');
});
client.on('auth_failure', (msg) => {
  clientError = 'Échec de connexion WhatsApp : ' + msg;
  console.error(clientError);
});
client.on('disconnected', (reason) => {
  clientReady = false;
  clientError = 'Déconnecté de WhatsApp : ' + reason;
  console.warn(clientError);
});
client.initialize();

// Numéro saisi côté France (ex. "06 12 34 56 78", "0612345678", "+33612345678") -> numéro
// international sans le +. Un numéro déjà international (commençant par un indicatif pays
// autre que 0) est accepté tel quel.
function normalizePhoneDigits(rawPhone) {
  const digits = String(rawPhone || '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  let national = digits.replace(/^\+/, '');
  if (national.startsWith('0')) national = '33' + national.slice(1);
  return national;
}

app.get('/status', (_req, res) => {
  res.json({ ready: clientReady, hasQr: !!lastQr, error: clientError });
});

app.get('/qr', async (_req, res) => {
  if (clientReady) return res.status(200).send('<p style="font-family:sans-serif">✔ Déjà connecté à WhatsApp — rien à scanner.</p>');
  if (!lastQr) return res.status(202).send('<p style="font-family:sans-serif">QR code pas encore prêt, réessaie dans quelques secondes…</p>');
  const dataUrl = await qrcode.toDataURL(lastQr, { width: 320 });
  res.status(200).send(`<!doctype html><html><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;flex-direction:column;gap:16px;">
    <img src="${dataUrl}" width="320" height="320">
    <p>Scanne avec WhatsApp → Réglages → Appareils liés → Lier un appareil</p>
  </body></html>`);
});

// Envoi par email (alternative à WhatsApp, dont l'envoi de pièces jointes est cassé pour le
// moment — voir /send). Réutilise le compte Gmail déjà configuré dans le module Email de
// l'appli (adresse + mot de passe d'application, dans le fichier de réglages de l'appli sur ce
// PC), pour ne rien avoir à ressaisir : la photo part en vraie pièce jointe.
function readAppEmailCreds() {
  const appData = process.env.APPDATA || '';
  for (const dir of ['Atelier CSB', 'atelier-csb']) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(appData, dir, 'csb-config.json'), 'utf-8'));
      const c = cfg.email_imap;
      if (c && c.email && c.appPassword) return c;
    } catch (e) { /* on essaie le dossier suivant */ }
  }
  return null;
}

app.post('/send-email', async (req, res) => {
  const { to, photoUrl, subject, text } = req.body || {};
  console.log(`[email] demande reçue — to=${to} photoUrl=${photoUrl}`);
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to).trim())) {
    return res.status(400).json({ error: 'Adresse email manquante ou invalide.' });
  }
  if (!photoUrl) return res.status(400).json({ error: 'Photo manquante.' });
  const creds = readAppEmailCreds();
  if (!creds) {
    return res.status(503).json({ error: "Aucun compte email configuré dans l'appli (module Email, réglages ⚙︎) sur le PC de l'atelier." });
  }
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: creds.email, pass: creds.appPassword },
    });
    const filename = decodeURIComponent(photoUrl.split('?')[0].split('/').pop() || 'photo.jpg');
    await transporter.sendMail({
      from: creds.email,
      to: String(to).trim(),
      subject: subject || 'Photo commande — Atelier CSB',
      text: text || 'Voici la photo de la commande, en pièce jointe.',
      attachments: [{ filename, path: photoUrl }],
    });
    console.log('[email] ✔ envoyé');
    res.json({ ok: true });
  } catch (e) {
    console.error('[email] ✘ échec :', e);
    res.status(500).json({ error: "Échec de l'envoi : " + e.message });
  }
});

app.post('/send', async (req, res) => {
  const { phone, photoUrl, caption } = req.body || {};
  console.log(`[send] demande reçue — phone=${phone} photoUrl=${photoUrl}`);
  if (!clientReady) {
    console.log('[send] refusé : WhatsApp pas connecté');
    return res.status(503).json({ error: "WhatsApp n'est pas connecté sur ce PC — scanne le QR code sur http://<ce-pc>:" + PORT + "/qr" });
  }
  const normalized = normalizePhoneDigits(phone);
  if (!normalized) return res.status(400).json({ error: 'Numéro de téléphone manquant ou invalide.' });
  if (!photoUrl) return res.status(400).json({ error: 'Photo manquante.' });
  try {
    // On laisse WhatsApp résoudre lui-même le numéro (plutôt que de construire "<numéro>@c.us"
    // à la main) : depuis leur système "LID", un identifiant construit à la main fait échouer
    // l'envoi avec "No LID for user" pour un numéro pas déjà connu du compte lié.
    const numberId = await client.getNumberId(normalized);
    if (!numberId) return res.status(404).json({ error: `Le ${phone} ne semble pas être sur WhatsApp.` });
    const chatId = numberId._serialized;
    console.log(`[send] téléchargement de la photo depuis ${photoUrl}…`);
    const media = await MessageMedia.fromUrl(photoUrl, { unsafeMime: true });
    console.log(`[send] photo téléchargée (${media.mimetype}, ${Math.round((media.data.length * 3 / 4) / 1024)} Ko) — envoi à ${chatId}…`);
    try {
      // Bug connu et non résolu de whatsapp-web.js (leurs issues GitHub, correctifs encore en
      // révision) : l'envoi de média plante pour les comptes WhatsApp utilisant leur nouveau
      // système d'identifiants "LID". On tente quand même l'envoi direct de la photo…
      await client.sendMessage(chatId, media, { caption: caption || '' });
      console.log('[send] ✔ photo envoyée');
    } catch (mediaErr) {
      // Bug connu et non résolu de whatsapp-web.js (leurs issues GitHub, correctifs encore en
      // révision) : l'envoi de média — et la reconnaissance des liens — échoue pour les comptes
      // WhatsApp utilisant leur nouveau système d'identifiants "LID". En attendant un correctif
      // de leur côté, on se rabat sur un message texte avec l'adresse de la photo : elle part
      // bien, mais il faut la copier-coller à la main dans un navigateur (pas cliquable pour
      // l'instant).
      console.warn('[send] envoi de la photo en pièce jointe impossible (bug LID connu), repli en lien texte :', mediaErr.message);
      await client.sendMessage(chatId, `📷 Photo commande Atelier CSB : ${photoUrl}`);
      console.log('[send] ✔ lien envoyé en repli (à copier-coller)');
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[send] ✘ échec :', e);
    res.status(500).json({ error: "Échec de l'envoi : " + e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur WhatsApp Atelier CSB démarré sur le port ${PORT}.`);
});
