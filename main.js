const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { autoUpdater } = require('electron-updater');
const vtracer = require('@visioncortex/vtracer');

// Une deuxième instance peut désormais s'ouvrir en parallèle (ex. deux fenêtres pour
// travailler sur deux écrans) : elle reçoit son propre dossier de données (config, email,
// caches locaux) distinct de la première, pour ne jamais faire cohabiter deux processus sur
// les mêmes fichiers — c'est ce partage qui, à l'origine, faisait "disparaître" des réglages
// enregistrés entre-temps (identifiants email notamment) lorsque deux instances tournaient
// sur le même dossier utilisateur.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.setPath('userData', app.getPath('userData') + '-instance-' + process.pid);
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'csb-config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(partial) {
  const current = readConfig();
  const next = { ...current, ...partial };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false, // évite un flash à la taille par défaut avant le maximize() ci-dessous
    backgroundColor: '#faf7f0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      sandbox: true,
      webviewTag: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'shell', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  const LEVELS = ['log', 'warn', 'error', 'debug'];
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const tag = LEVELS[level] || 'log';
    console.log(`[renderer:${tag}] ${sourceId.split(/[\\/]/).pop()}:${line} — ${message}`);
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Atelier CSB',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'quit', label: 'Quitter' }
        ]
      },
      {
        label: 'Édition',
        submenu: [
          { role: 'undo', label: 'Annuler' },
          { role: 'redo', label: 'Rétablir' },
          { type: 'separator' },
          { role: 'cut', label: 'Couper' },
          { role: 'copy', label: 'Copier' },
          { role: 'paste', label: 'Coller' },
          { role: 'selectAll', label: 'Tout sélectionner' }
        ]
      },
      {
        label: 'Affichage',
        submenu: [
          { role: 'reload', label: 'Recharger' },
          { role: 'toggleDevTools', label: 'Outils de développement' },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Zoom réel' },
          { role: 'zoomIn', label: 'Zoom avant' },
          { role: 'zoomOut', label: 'Zoom arrière' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Plein écran' }
        ]
      }
    ])
  );
}

// ---------- Mises à jour automatiques ----------
// Les fichiers de mise à jour (installeur + latest.yml) sont hébergés dans le dossier
// pb_public de PocketBase (servi automatiquement en statique) — voir README pour la procédure
// de publication d'une nouvelle version. En développement (npm start, pas encore packagé), il
// n'y a pas de app-update.yml : on n'essaie même pas, ça échouerait à coup sûr.
function sendUpdateStatus(status, extra) {
  if (mainWindow) mainWindow.webContents.send('csb:update-status', { status, ...(extra || {}) });
}
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
autoUpdater.on('update-available', (info) => sendUpdateStatus('available', { version: info.version }));
autoUpdater.on('update-not-available', () => sendUpdateStatus('none'));
autoUpdater.on('download-progress', (p) => sendUpdateStatus('downloading', { percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('downloaded', { version: info.version }));
autoUpdater.on('error', (err) => sendUpdateStatus('error', { message: err.message }));

// ---------- Menu clic-droit dans les webviews (ex: onglet Axonaut) ----------
// Electron n'affiche aucun menu contextuel par défaut dans une <webview> (contrairement à un
// vrai navigateur) : il faut l'assembler et l'afficher soi-même, ici, dans le processus
// principal (une webview crée son propre WebContents "guest", capté via web-contents-created).
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  // Un lien qui s'ouvrirait normalement dans une nouvelle fenêtre/onglet (target="_blank",
  // window.open() côté page) est plutôt relayé à l'embarqueur (shell.js) pour ouvrir un nouvel
  // onglet interne, au lieu d'ouvrir une fenêtre Electron nue ou d'échouer silencieusement.
  contents.setWindowOpenHandler(({ url }) => {
    contents.hostWebContents.send('csb:webview-open-tab', url);
    return { action: 'deny' };
  });
  contents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.linkURL) {
      items.push({ label: 'Ouvrir le lien dans un nouvel onglet', click: () => contents.hostWebContents.send('csb:webview-open-tab', params.linkURL) });
      items.push({ label: 'Ouvrir le lien dans le navigateur', click: () => shell.openExternal(params.linkURL) });
      items.push({ label: "Copier l'adresse du lien", click: () => require('electron').clipboard.writeText(params.linkURL) });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ label: 'Couper', role: 'cut', enabled: !!params.selectionText });
      items.push({ label: 'Copier', role: 'copy', enabled: !!params.selectionText });
      items.push({ label: 'Coller', role: 'paste' });
      items.push({ type: 'separator' });
    } else if (params.selectionText) {
      items.push({ label: 'Copier', role: 'copy' });
      items.push({ type: 'separator' });
    }
    items.push({ label: 'Recharger', click: () => contents.reload() });
    items.push({ label: 'Précédent', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
    items.push({ label: 'Suivant', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() });
    Menu.buildFromTemplate(items).popup();
  });
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((err) => sendUpdateStatus('error', { message: err.message }));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('csb:get-config', () => readConfig());
ipcMain.handle('csb:set-config', (_event, partial) => writeConfig(partial));
ipcMain.handle('csb:open-external', (_event, url) => shell.openExternal(url));
ipcMain.handle('csb:install-update', () => autoUpdater.quitAndInstall());
ipcMain.handle('csb:app-version', () => app.getVersion());

// ---------- Email (IMAP + mot de passe d'application) ----------
// Remplace l'ancienne connexion OAuth Google (trop lourde à configurer : projet Google
// Cloud, écran de consentement, utilisateurs test…) par une simple connexion IMAP avec un
// « mot de passe d'application » Google — aucune inscription développeur nécessaire. Le
// module Email (iframe sans accès Node) ne peut pas ouvrir de connexion TCP lui-même ; tout
// le dialogue IMAP se fait donc ici, dans le principal, et le module appelle ces fonctions
// via IPC.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

function emailReadCreds() {
  const cfg = readConfig();
  return cfg.email_imap || {};
}
function emailWriteCreds(partial) {
  const cfg = readConfig();
  const next = { ...(cfg.email_imap || {}), ...partial };
  writeConfig({ email_imap: next });
  return next;
}

let cachedImapClient = null;
async function getImapClient() {
  const creds = emailReadCreds();
  if (!creds.email || !creds.appPassword) {
    throw new Error('Email non connecté — renseigne ton adresse et ton mot de passe d\'application (réglages ⚙︎).');
  }
  if (cachedImapClient && cachedImapClient.usable) return cachedImapClient;
  const client = new ImapFlow({
    host: creds.host || 'imap.gmail.com',
    port: creds.port || 993,
    secure: true,
    auth: { user: creds.email, pass: creds.appPassword },
    logger: false
  });
  await client.connect();
  cachedImapClient = client;
  client.on('close', () => { if (cachedImapClient === client) cachedImapClient = null; });
  client.on('error', () => { if (cachedImapClient === client) cachedImapClient = null; });
  return client;
}

function bodyStructureHasAttachment(struct) {
  if (!struct) return false;
  const disposition = struct.disposition && String(struct.disposition).toLowerCase();
  const filename = (struct.dispositionParameters && struct.dispositionParameters.filename) ||
    (struct.parameters && struct.parameters.name);
  if (disposition === 'attachment' || (filename && disposition !== 'inline')) return true;
  return (struct.childNodes || []).some(bodyStructureHasAttachment);
}

ipcMain.handle('csb:email-set-credentials', (_event, { email, appPassword, host, port }) => {
  emailWriteCreds({ email, appPassword, host: host || undefined, port: port || undefined });
  cachedImapClient = null;
  return { ok: true };
});
ipcMain.handle('csb:email-status', () => {
  const creds = emailReadCreds();
  return { connected: !!(creds.email && creds.appPassword), email: creds.email || '' };
});
ipcMain.handle('csb:email-disconnect', async () => {
  emailWriteCreds({ email: '', appPassword: '' });
  if (cachedImapClient) { try { await cachedImapClient.logout(); } catch (e) {} }
  cachedImapClient = null;
  return { ok: true };
});
ipcMain.handle('csb:email-test-connection', async () => {
  cachedImapClient = null; // force une vraie tentative de connexion, pas le cache
  const client = await getImapClient();
  const lock = await client.getMailboxLock('INBOX');
  lock.release();
  return { ok: true };
});

// Construit l'arbre des dossiers/labels IMAP (Gmail expose ses labels comme des dossiers).
// On marque les dossiers spéciaux (Corbeille, Envoyés, etc.) via leur attribut « specialUse »,
// indépendant du nom affiché (qui change selon la langue du compte Google).
ipcMain.handle('csb:email-list-folders', async () => {
  const client = await getImapClient();
  const list = await client.list();
  return list
    .filter(f => !f.flags || !f.flags.has('\\Noselect'))
    .map(f => ({
      path: f.path,
      name: f.name,
      delimiter: f.delimiter,
      specialUse: f.specialUse || null
    }))
    .sort((a, b) => {
      // Boîte de réception toujours en premier, puis ordre alphabétique.
      if (a.path === 'INBOX') return -1;
      if (b.path === 'INBOX') return 1;
      return a.path.localeCompare(b.path);
    });
});

async function findSpecialMailbox(client, specialUse) {
  const list = await client.list();
  const found = list.find(f => f.specialUse === specialUse);
  return found ? found.path : null;
}

ipcMain.handle('csb:email-set-flags', async (_event, { uid, mailbox, addFlags, removeFlags }) => {
  const client = await getImapClient();
  const lock = await client.getMailboxLock(mailbox || 'INBOX');
  try {
    if (addFlags && addFlags.length) await client.messageFlagsAdd({ uid: String(uid) }, addFlags, { uid: true });
    if (removeFlags && removeFlags.length) await client.messageFlagsRemove({ uid: String(uid) }, removeFlags, { uid: true });
    return { ok: true };
  } finally {
    lock.release();
  }
});

// « Supprimer » déplace le message vers la Corbeille Gmail (récupérable), jamais de
// suppression définitive ni de vidage de corbeille depuis l'app.
ipcMain.handle('csb:email-move-to-trash', async (_event, { uid, mailbox }) => {
  const client = await getImapClient();
  const trashPath = await findSpecialMailbox(client, '\\Trash');
  if (!trashPath) throw new Error('Dossier Corbeille introuvable sur ce compte.');
  const lock = await client.getMailboxLock(mailbox || 'INBOX');
  try {
    await client.messageMove({ uid: String(uid) }, trashPath, { uid: true });
    return { ok: true };
  } finally {
    lock.release();
  }
});

// Glisser-déposer un mail sur un dossier de la colonne de gauche : déplace vers ce dossier.
ipcMain.handle('csb:email-move-to-folder', async (_event, { uid, mailbox, targetPath }) => {
  const client = await getImapClient();
  const lock = await client.getMailboxLock(mailbox || 'INBOX');
  try {
    await client.messageMove({ uid: String(uid) }, targetPath, { uid: true });
    return { ok: true };
  } finally {
    lock.release();
  }
});

ipcMain.handle('csb:email-list', async (_event, { query, limit, mailbox, offset }) => {
  const client = await getImapClient();
  const lock = await client.getMailboxLock(mailbox || 'INBOX');
  try {
    const max = limit || 40;
    const off = offset || 0;
    let targetUids;
    let hasMore;
    if (query && query.trim()) {
      // Une recherche explicite couvre tout le dossier, sans limite de date.
      const uids = await client.search(
        { or: [{ subject: query }, { from: query }, { body: query }] },
        { uid: true }
      );
      // uids est trié du plus ancien au plus récent : on prend une tranche en partant de la fin,
      // "offset" mails déjà chargés plus loin.
      const end = uids.length - off;
      const start = Math.max(0, end - max);
      targetUids = uids.slice(start, end).reverse();
      hasMore = start > 0;
    } else {
      // Navigation par défaut (sans recherche) : tous les mails des 30 derniers jours sont
      // chargés d'un coup (pas de limite de 40 sur cette fenêtre) ; "Charger plus" (offset) ne
      // sert qu'à remonter au-delà de ces 30 jours, par lots de "max".
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentUids = await client.search({ since: thirtyDaysAgo }, { uid: true });
      if (off === 0) {
        const olderUids = await client.search({ before: thirtyDaysAgo }, { uid: true });
        targetUids = recentUids.slice().reverse();
        hasMore = olderUids.length > 0;
      } else {
        const olderUids = await client.search({ before: thirtyDaysAgo }, { uid: true });
        const olderOffset = Math.max(0, off - recentUids.length);
        const end = olderUids.length - olderOffset;
        const start = Math.max(0, end - max);
        targetUids = olderUids.slice(start, end).reverse();
        hasMore = start > 0;
      }
    }
    const results = [];
    if (targetUids.length) {
      for await (const msg of client.fetch(targetUids, { envelope: true, flags: true, bodyStructure: true }, { uid: true })) {
        const from = (msg.envelope.from && msg.envelope.from[0]) || {};
        results.push({
          uid: msg.uid,
          subject: msg.envelope.subject || '(sans objet)',
          from: { name: from.name || from.address || '', email: from.address || '' },
          date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
          unread: !(msg.flags && msg.flags.has('\\Seen')),
          hasAttachment: bodyStructureHasAttachment(msg.bodyStructure)
        });
      }
    }
    results.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { items: results, hasMore };
  } finally {
    lock.release();
  }
});

// Récupère le résumé (expéditeur/objet/date/lu) de mails précis par UID, sans les marquer comme
// lus — utilisé pour ré-afficher un mail épinglé qui n'est plus dans les 40 derniers mails
// chargés (ou hors du filtre de recherche en cours), sans le rouvrir pour de vrai.
ipcMain.handle('csb:email-get-by-uids', async (_event, { uids, mailbox }) => {
  if (!uids || !uids.length) return [];
  const client = await getImapClient();
  const lock = await client.getMailboxLock(mailbox || 'INBOX');
  try {
    const results = [];
    for await (const msg of client.fetch(uids.map(String), { envelope: true, flags: true, bodyStructure: true }, { uid: true })) {
      const from = (msg.envelope.from && msg.envelope.from[0]) || {};
      results.push({
        uid: msg.uid,
        subject: msg.envelope.subject || '(sans objet)',
        from: { name: from.name || from.address || '', email: from.address || '' },
        date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
        unread: !(msg.flags && msg.flags.has('\\Seen')),
        hasAttachment: bodyStructureHasAttachment(msg.bodyStructure)
      });
    }
    return results;
  } finally {
    lock.release();
  }
});

ipcMain.handle('csb:email-get-message', async (_event, { uid, mailbox }) => {
  const client = await getImapClient();
  const lock = await client.getMailboxLock(mailbox || 'INBOX');
  try {
    const msg = await client.fetchOne(uid, { source: true }, { uid: true });
    if (!msg) throw new Error('Message introuvable (a-t-il été déplacé/supprimé depuis la liste ?).');
    // Ouvrir un mail le marque comme lu, comme dans n'importe quel client mail.
    try { await client.messageFlagsAdd({ uid: String(uid) }, ['\\Seen'], { uid: true }); } catch (e) {}
    const parsed = await simpleParser(msg.source);
    const fromAddr = parsed.from && parsed.from.value && parsed.from.value[0];
    return {
      subject: parsed.subject || '(sans objet)',
      from: fromAddr ? { name: fromAddr.name || fromAddr.address, email: fromAddr.address } : { name: '', email: '' },
      to: parsed.to ? parsed.to.text : '',
      date: parsed.date ? parsed.date.toISOString() : null,
      html: parsed.html || null,
      text: parsed.text || null,
      attachments: (parsed.attachments || []).map((a, i) => ({
        idx: i,
        filename: a.filename || `piece-jointe-${i + 1}`,
        contentType: a.contentType || 'application/octet-stream',
        size: a.size || (a.content ? a.content.length : 0),
        contentBase64: a.content ? a.content.toString('base64') : ''
      }))
    };
  } finally {
    lock.release();
  }
});

app.on('before-quit', async () => {
  if (cachedImapClient) { try { await cachedImapClient.logout(); } catch (e) {} }
});

// ---------- Vectorisation (VTracer) ----------
// @visioncortex/vtracer est un module Node (le moteur Rust/WASM tourne ici, dans le
// processus principal) — le module Vectorisation, lui, s'exécute dans un iframe sandboxé
// sans accès à Node. Le socle (src/shell/shell.js) relaie donc la demande depuis l'iframe
// jusqu'ici via postMessage, exactement comme il relaie déjà l'authentification.
ipcMain.handle('csb:vectorize', (_event, { rgba, width, height, options }) => {
  return vtracer.convertPixels(new Uint8Array(rgba), width, height, options || {});
});
