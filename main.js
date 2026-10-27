const { app, BrowserWindow, Menu, ipcMain, shell, safeStorage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { exec } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const vtracer = require('@visioncortex/vtracer');

// Avant d'être installée, Electron nomme le dossier de réglages (userData) d'après le nom
// technique du projet ("atelier-csb", tiré de package.json/name) ; une fois publiée/installée,
// elle le nomme d'après le nom public ("Atelier CSB", le productName). Sans ce qui suit, la
// version de test (npm start) et la version installée avaient donc chacune leurs propres
// réglages (clé API Axonaut, Colissimo...), l'une ne voyant jamais ce que l'autre a enregistré.
// On force ici le même nom dans les deux cas — en recopiant d'abord les réglages déjà présents
// côté "test" si le dossier "Atelier CSB" n'en a encore aucun, pour ne rien perdre.
try {
  const appDataDir = app.getPath('appData');
  const legacyConfigPath = path.join(appDataDir, 'atelier-csb', 'csb-config.json');
  const finalConfigPath = path.join(appDataDir, 'Atelier CSB', 'csb-config.json');
  if (fs.existsSync(legacyConfigPath) && !fs.existsSync(finalConfigPath)) {
    fs.mkdirSync(path.dirname(finalConfigPath), { recursive: true });
    fs.copyFileSync(legacyConfigPath, finalConfigPath);
  }
} catch (e) {}
app.setName('Atelier CSB');

// Relancer l'appli alors qu'elle est déjà ouverte (ex. pour travailler sur deux écrans) ouvre
// une NOUVELLE FENÊTRE dans le programme déjà lancé, au lieu d'un deuxième programme : les
// fenêtres partagent ainsi les mêmes réglages (clé Axonaut, email, connexion, dossiers
// autorisés…). Avant, la deuxième instance recevait un dossier de réglages vide à part, pour ne
// pas faire écrire deux programmes dans les mêmes fichiers — d'où des réglages « perdus ».
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (app.isReady()) createWindow();
    else app.whenReady().then(() => createWindow());
  });
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
  const win = new BrowserWindow({
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

  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = BrowserWindow.getAllWindows().find((w) => w !== win) || null;
  });
  win.loadFile(path.join(__dirname, 'src', 'shell', 'index.html'));
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  const LEVELS = ['log', 'warn', 'error', 'debug'];
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
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
  BrowserWindow.getAllWindows().forEach((w) => { try { w.webContents.send('csb:update-status', { status, ...(extra || {}) }); } catch (e) {} });
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
  if (!gotSingleInstanceLock) return; // deuxième lancement : la fenêtre s'ouvre dans le premier programme
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
// shell.openPath ne lève jamais d'exception : il résout une chaîne vide en cas de succès,
// ou un message d'erreur sinon (ex. aucune appli associée à l'extension).
// ---------- Chemins Dropbox valables sur tous les postes ----------
// Dropbox est installé dans le dossier de chaque utilisateur Windows (C:\Users\<nom>\Dropbox) :
// un chemin copié sur un poste n'existe pas tel quel sur un autre. On sait donc :
//  - écrire un chemin Dropbox sous une forme partageable : %USERPROFILE%\Dropbox\… (que
//    l'Explorateur Windows comprend aussi), ou Dropbox\… si Dropbox est installé ailleurs ;
//  - retrouver, sur ce poste, le bon dossier à partir de n'importe laquelle de ces formes, et même
//    à partir d'un chemin complet pris sur un autre poste (…\Dropbox\… ou …\Dropbox (Équipe)\…).
let dropboxRootsCache = { at: 0, roots: [] };
function localDropboxRoots() {
  if (Date.now() - dropboxRootsCache.at < 30000) return dropboxRootsCache.roots;
  const roots = [];
  for (const infoPath of [path.join(app.getPath('appData'), 'Dropbox', 'info.json'), path.join(os.homedir(), 'AppData', 'Local', 'Dropbox', 'info.json')]) {
    try {
      if (!fs.existsSync(infoPath)) continue;
      const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
      for (const key of ['personal', 'business']) {
        const entry = info[key];
        if (entry && entry.path && fs.existsSync(entry.path) && !roots.some(r => r.path === entry.path)) roots.push({ key, path: entry.path });
      }
    } catch (e) { /* fichier illisible : on essaie le suivant */ }
  }
  dropboxRootsCache = { at: Date.now(), roots };
  return roots;
}
function pickDropboxRoot(roots, folderName) {
  const n = String(folderName || '').toLowerCase();
  return roots.find(r => path.basename(r.path).toLowerCase() === n) || roots[0] || null;
}
function resolvePortablePath(p) {
  if (!p || typeof p !== 'string') return p;
  let s = p.trim().replace(/%([A-Za-z0-9_]+)%/g, (m, v) => (process.env[v] !== undefined ? process.env[v] : m));
  const roots = localDropboxRoots();
  // Forme courte « Dropbox\… » (chemin relatif à la Dropbox)
  const short = s.match(/^(dropbox(?: \([^\\/)]+\))?)(?:[\\/](.*))?$/i);
  if (short && !path.isAbsolute(s)) {
    const r = pickDropboxRoot(roots, short[1]);
    if (r) return path.join(r.path, short[2] || '');
  }
  if (fs.existsSync(s)) return s;
  // Chemin complet pris sur un autre poste : on garde ce qui suit le dossier Dropbox.
  const seg = s.match(/[\\/](Dropbox(?: \([^\\/]+\))?)(?:[\\/](.*))?$/i);
  if (seg && roots.length) {
    const rest = seg[2] || '';
    const first = pickDropboxRoot(roots, seg[1]);
    for (const r of [first, ...roots.filter(x => x !== first)]) {
      const cand = path.join(r.path, rest);
      if (fs.existsSync(cand)) return cand;
    }
  }
  return s;
}
function toPortablePath(p) {
  if (!p || typeof p !== 'string') return p;
  for (const r of localDropboxRoots()) {
    const rel = path.relative(r.path, p);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const fromHome = path.relative(os.homedir(), r.path);
    const base = (!fromHome.startsWith('..') && !path.isAbsolute(fromHome)) ? path.join('%USERPROFILE%', fromHome) : path.basename(r.path);
    return rel ? path.join(base, rel) : base;
  }
  return p;
}
ipcMain.handle('csb:resolve-path', (_event, p) => { const r = resolvePortablePath(p); return { path: r, exists: !!r && fs.existsSync(r) }; });
ipcMain.handle('csb:portable-path', (_event, p) => toPortablePath(p));

ipcMain.handle('csb:open-path', (_event, filePath) => shell.openPath(resolvePortablePath(filePath)));
// Ouvre le dossier du fichier dans l'Explorateur (Finder sur Mac), fichier sélectionné.
ipcMain.handle('csb:show-in-folder', (_event, filePath) => { shell.showItemInFolder(resolvePortablePath(filePath)); return true; });
// Déplace vers la corbeille (récupérable), plutôt qu'une suppression définitive.
ipcMain.handle('csb:trash-file', (_event, filePath) => shell.trashItem(resolvePortablePath(filePath)));
// Bug connu d'Electron sous Windows : après une boîte confirm()/alert(), ou quand une <webview>
// (Axonaut, Fournisseurs) a gardé le focus clavier, la fenêtre n'envoie plus les frappes aux
// champs de saisie — on clique dedans mais on ne peut plus rien taper. Le preload appelle ceci
// quand il détecte le cas ; « blur puis focus » rend réellement le clavier à la fenêtre.
// ---------- PDF à partir d'une page HTML (devis du module Devis) ----------
// Le moteur d'impression de Chromium rend fidèlement les descriptions produits d'Axonaut (gras,
// listes, images), ce qu'une génération PDF « à la main » ne permet pas. Fenêtre invisible, sans
// JavaScript ni accès Node : le HTML (déjà nettoyé par le module) n'est que mis en page.
// Le marqueur __CSB_LOGO__ est remplacé par le logo de l'atelier (src/shell/assets/logo-full.png).
ipcMain.handle('csb:html-to-pdf', async (_event, { html, footerHtml, headerHtml }) => {
  let logo = '';
  try { logo = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'src', 'shell', 'assets', 'logo-full.png')).toString('base64'); } catch (e) {}
  const page = String(html).replace(/__CSB_LOGO__/g, logo);
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(page, 'utf8').toString('base64'));
    // Police du devis (Inter) chargée depuis Google Fonts : petit délai pour qu'elle soit prête ;
    // hors connexion, l'impression se fait avec la police de secours (Segoe UI / Arial).
    await new Promise(r => setTimeout(r, 400));
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'custom', top: headerHtml ? 0.55 : 0.4, bottom: 0.75, left: 0.4, right: 0.4 },
      displayHeaderFooter: !!(footerHtml || headerHtml),
      headerTemplate: headerHtml || '<span></span>',
      footerTemplate: footerHtml || '<span></span>'
    });
    return pdf.toString('base64');
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
});
// Impression d'une page HTML (ex. un mail) : chargée dans une fenêtre cachée sans JavaScript
// (le contenu d'un mail n'exécute donc rien), puis boîte d'impression de Windows.
ipcMain.handle('csb:print-html', async (event, { html, title }) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const win = new BrowserWindow({ show: false, parent: parent || undefined, title: title || 'Impression', webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(String(html), 'utf8').toString('base64'));
    await new Promise((r) => setTimeout(r, 500)); // images du mail
    return await new Promise((resolve, reject) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        if (success || reason === 'cancelled' || reason === 'Print job canceled') resolve({ ok: success });
        else reject(new Error(reason || 'impression impossible'));
      });
    });
  } finally {
    setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, 1000);
  }
});
// Logo de l'atelier en data URL (page client du serveur de suivi des devis).
ipcMain.handle('csb:logo-data-url', () => {
  try { return 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'src', 'shell', 'assets', 'logo-full.png')).toString('base64'); }
  catch (e) { return ''; }
});
// Enregistre un PDF où l'utilisateur le choisit (renvoie le chemin, ou null si annulé).
ipcMain.handle('csb:save-pdf', async (event, { base64, defaultName }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const safeName = String(defaultName || 'document.pdf').replace(/[\\/:*?"<>|]+/g, '-');
  const res = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), safeName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, Buffer.from(base64, 'base64'));
  return res.filePath;
});
// Ouvre un PDF dans la visionneuse par défaut, via une copie dans le dossier temporaire.
ipcMain.handle('csb:open-temp-pdf', async (_event, { base64, name }) => {
  const dir = path.join(os.tmpdir(), 'atelier-csb-pdf');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, String(name || 'document.pdf').replace(/[\\/:*?"<>|]+/g, '-'));
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  const err = await shell.openPath(filePath);
  if (err) throw new Error(err);
  return filePath;
});
// Scan depuis un téléphone associé à ce poste : la fenêtre revient au premier plan.
ipcMain.handle('csb:bring-to-front', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true); win.focus(); win.setAlwaysOnTop(false);
  return true;
});

ipcMain.handle('csb:refocus-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  win.blur();
  win.focus();
  win.webContents.focus();
  return true;
});

// Identifiants des sites fournisseurs (onglet Fournisseurs) : chiffrés avec le trousseau du
// système (Windows DPAPI / Keychain Mac) via safeStorage, propres à ce poste — jamais envoyés
// vers PocketBase ni écrits en clair dans le fichier de config.
function siteCredsRead() {
  return readConfig().site_creds || {};
}
ipcMain.handle('csb:cred-get', (_event, origin) => {
  const entry = siteCredsRead()[origin];
  if (!entry || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return { username: entry.username, password: safeStorage.decryptString(Buffer.from(entry.password, 'base64')) };
  } catch {
    return null;
  }
});
ipcMain.handle('csb:cred-set', (_event, origin, username, password) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Le chiffrement du système n'est pas disponible sur ce poste.");
  const all = siteCredsRead();
  all[origin] = { username, password: safeStorage.encryptString(password).toString('base64') };
  writeConfig({ site_creds: all });
  return true;
});
ipcMain.handle('csb:cred-delete', (_event, origin) => {
  const all = siteCredsRead();
  delete all[origin];
  writeConfig({ site_creds: all });
  return true;
});
ipcMain.handle('csb:install-update', () => autoUpdater.quitAndInstall());
ipcMain.handle('csb:app-version', () => app.getVersion());

// ---------- Explorateur de fichiers local (module Recherche / Éditeur) ----------
// Remonte la chaîne de dossiers parents jusqu'à la racine (ex. "C:\"), pour
// construire un fil d'Ariane cliquable côté renderer sans lui donner accès
// au module Node "path".
function buildAncestors(dirPath) {
  const list = [];
  let cur = dirPath;
  while (true) {
    list.unshift({ name: path.basename(cur) || cur, path: cur });
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return list;
}
// Récupère nom de volume / type / cible réseau de chaque lecteur via
// PowerShell (CIM), pour afficher des libellés "à la Explorateur Windows"
// (ex. "Broderie Générale (\\SB-CONFECTION) (B:)"). Best-effort : si
// PowerShell échoue pour une raison quelconque, on retombe sur la simple
// lettre de lecteur plus bas.
function getWindowsDriveDetails() {
  return new Promise((resolve) => {
    // PowerShell écrit sa sortie redirigée dans l'encodage console (page de
    // code OEM/ANSI du poste), que Node décode ensuite en UTF-8 : les
    // lettres accentuées (ex. "Générale") ressortaient donc en "?". On
    // contourne le problème en faisant encoder le JSON en Base64 par
    // PowerShell lui-même (texte pur ASCII, insensible à la page de code),
    // puis en le décodant en UTF-8 côté Node.
    const psCmd = '$json = Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,ProviderName,DriveType | ConvertTo-Json -Compress; ' +
      '[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$json))';
    exec('powershell -NoProfile -NonInteractive -Command "' + psCmd.replace(/"/g, '\\"') + '"', { timeout: 6000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve({});
      try {
        const jsonStr = Buffer.from(stdout.trim(), 'base64').toString('utf8');
        let data = JSON.parse(jsonStr);
        if (!Array.isArray(data)) data = [data];
        const map = {};
        data.forEach((d) => { if (d && d.DeviceID) map[String(d.DeviceID).toUpperCase()] = d; });
        resolve(map);
      } catch (e) { resolve({}); }
    });
  });
}
ipcMain.handle('csb:list-drives', async () => {
  if (process.platform !== 'win32') return [{ name: '/', path: '/', isNetwork: false }];
  const details = await getWindowsDriveDetails();
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i) + ':';
    const root = letter + '\\';
    try {
      if (!fs.existsSync(root)) continue;
      const info = details[letter];
      const isNetwork = !!info && info.DriveType === 4;
      const label = info && info.VolumeName ? info.VolumeName : null;
      const provider = info && info.ProviderName ? info.ProviderName : null;
      let name = label ? label + ' (' + letter + ')' : letter;
      if (isNetwork) name = (label || (provider ? path.basename(provider) : letter)) + (provider ? ' (' + provider + ')' : '') + ' (' + letter + ')';
      drives.push({ name, path: root, isNetwork });
    } catch (e) { /* lecteur inaccessible (lecteur optique vide...) */ }
  }
  return drives;
});

// ---------- Dropbox (dossiers personnel/équipe détectés automatiquement) ----------
ipcMain.handle('csb:detect-dropbox', () => {
  const candidates = [
    path.join(app.getPath('appData'), 'Dropbox', 'info.json'),
    path.join(os.homedir(), 'AppData', 'Local', 'Dropbox', 'info.json'),
  ];
  for (const infoPath of candidates) {
    try {
      if (!fs.existsSync(infoPath)) continue;
      const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
      const results = [];
      for (const key of ['business', 'personal']) {
        const entry = info[key];
        if (entry && entry.path && fs.existsSync(entry.path)) {
          const label = entry.team ? entry.team + ' Dropbox' : 'Dropbox';
          results.push({ name: label, path: entry.path });
        }
      }
      if (results.length) return results;
    } catch (e) { /* ignore, on essaie le chemin candidat suivant */ }
  }
  return [];
});

// ---------- Réseau : ordinateurs/partages visibles (best-effort, via "net view") ----------
// La découverte réseau Windows classique (navigateur NetBIOS/SMB) est
// best-effort : certains réseaux la désactivent, auquel cas ces commandes
// renvoient simplement une liste vide et l'ajout manuel d'un chemin réseau
// (\\serveur\partage, déjà disponible dans l'appli) reste le moyen fiable.
function execNetView(target) {
  return new Promise((resolve) => {
    const cmd = target ? 'net view ' + target : 'net view';
    exec(cmd, { timeout: 8000, windowsHide: true }, (err, stdout) => resolve(stdout || ''));
  });
}
ipcMain.handle('csb:list-network-computers', async () => {
  if (process.platform !== 'win32') return [];
  const stdout = await execNetView(null);
  const names = [];
  stdout.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\\\\(\S+)/);
    if (m) names.push(m[1]);
  });
  return names;
});
ipcMain.handle('csb:list-network-shares', async (_event, computerName) => {
  if (process.platform !== 'win32') return [];
  const stdout = await execNetView('\\\\' + computerName);
  const shares = [];
  let inTable = false;
  stdout.split(/\r?\n/).forEach((line) => {
    if (/^-{3,}/.test(line.trim())) { inTable = !inTable; return; }
    if (!inTable) return;
    const m = line.match(/^(\S+)\s+(\S+)/);
    if (m && /isk/i.test(m[2])) shares.push(m[1]);
  });
  return shares.map((s) => ({ name: s, path: '\\\\' + computerName + '\\' + s }));
});
ipcMain.handle('csb:pick-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});
ipcMain.handle('csb:list-dir', (_event, requestedPath) => {
  const dirPath = resolvePortablePath(requestedPath);
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = entries.map((e) => {
      const full = path.join(dirPath, e.name);
      let size = 0, mtimeMs = 0;
      try { const st = fs.statSync(full); size = st.size; mtimeMs = st.mtimeMs; } catch (e2) { /* lien mort, permission... */ }
      return {
        name: e.name, path: full, isDir: e.isDirectory(),
        ext: e.isDirectory() ? '' : path.extname(e.name).toLowerCase().replace(/^\./, ''),
        size, mtimeMs,
      };
    });
    return { path: dirPath, ancestors: buildAncestors(dirPath), entries: items };
  } catch (e) {
    return { error: e.message || String(e) };
  }
});
// Sélection d'un ou plusieurs fichiers OU dossiers (kind = 'files' | 'folders'). Windows ne permet pas de
// mélanger les deux dans une même fenêtre de sélection, d'où deux modes distincts.
ipcMain.handle('csb:pick-paths', async (event, kind) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const properties = kind === 'folders' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'];
  const res = await dialog.showOpenDialog(win, { properties });
  return res.canceled ? [] : res.filePaths;
});
// Presse-papier pour les boutons « 📋 Coller » des documents : fichiers copiés dans l'Explorateur
// (Ctrl+C) ou image copiée (WhatsApp, capture d'écran…) — le navigateur ne sait pas lire les fichiers.
ipcMain.handle('csb:clipboard-content', () => {
  const { clipboard } = require('electron');
  let files = [];
  if (process.platform === 'win32') {
    try {
      const buf = clipboard.readBuffer('FileNameW');
      if (buf && buf.length) {
        files = buf.toString('ucs2').split(String.fromCharCode(0)).map(s => s.trim()).filter(p => p && fs.existsSync(p) && fs.statSync(p).isFile());
      }
    } catch (e) {}
  }
  if (files.length) return { files };
  const img = clipboard.readImage();
  if (img && !img.isEmpty()) return { files: [], image: img.toPNG().toString('base64') };
  return { files: [] };
});
ipcMain.handle('csb:read-file-bytes', (_event, filePath) => new Uint8Array(fs.readFileSync(resolvePortablePath(filePath))));

// Recherche récursive (dossier courant + tous ses sous-dossiers), filtrée par
// extension et par un mot dans le nom de fichier — en flux : les résultats
// sont envoyés au renderer par lots au fur et à mesure qu'on les trouve
// (plutôt qu'en un seul bloc à la fin), pour un affichage progressif. Le
// parcours avance un dossier à la fois via setImmediate, afin de ne jamais
// bloquer le process principal (important sur une arborescence réseau
// lente) et de laisser les lots déjà envoyés arriver côté renderer.
// Plafonnée pour rester réactive même sur une arborescence volumineuse.
// Une recherche en remplace une autre : seule la plus récente (activeSearchId)
// va à son terme, les précédentes s'arrêtent dès leur prochain tick.
const SEARCH_FILES_LIMIT = 2000;
const SEARCH_BATCH_SIZE = 60;
const SEARCH_BATCH_DELAY_MS = 120;
let searchRequestCounter = 0;
let activeSearchId = 0;
ipcMain.handle('csb:search-files-start', (event, { rootPath, query, exts, includeRecycle }) => {
  rootPath = resolvePortablePath(rootPath);
  const requestId = ++searchRequestCounter;
  activeSearchId = requestId;
  // Chaque module tourne dans sa propre <iframe> (nodeIntegrationInSubFrames),
  // avec son propre ipcRenderer isolé : event.sender.send() livre au cadre
  // PRINCIPAL de la fenêtre (le shell), jamais à cette iframe, et les
  // écouteurs onSearchFilesProgress/onSearchFilesDone ne recevaient donc
  // jamais rien. event.senderFrame cible le cadre exact d'où vient l'appel.
  const targetFrame = event.senderFrame;
  function sendToFrame(channel, payload) {
    try { if (targetFrame) targetFrame.send(channel, payload); } catch (e) { /* cadre fermé entre-temps */ }
  }
  const queryLower = (query || '').toLowerCase();
  const extList = exts || [];

  let batch = [];
  let total = 0;
  let truncated = false;
  let lastFlush = Date.now();
  const dirQueue = [rootPath];

  function flush(force) {
    const now = Date.now();
    if (batch.length && (force || now - lastFlush >= SEARCH_BATCH_DELAY_MS || batch.length >= SEARCH_BATCH_SIZE)) {
      sendToFrame('csb:search-files-progress', { requestId, results: batch });
      batch = [];
      lastFlush = now;
    }
  }

  function step() {
    if (requestId !== activeSearchId) return; // remplacée par une recherche plus récente
    if (truncated || !dirQueue.length) {
      flush(true);
      sendToFrame('csb:search-files-done', { requestId, total, truncated });
      return;
    }
    const dir = dirQueue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { entries = []; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        // Corbeille / miniatures du NAS Synology : ignorées sauf si demandé.
        if (!includeRecycle && (e.name === '#recycle' || e.name === '@eaDir')) continue;
        dirQueue.push(full);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase().replace(/^\./, '');
      if (extList.length && !extList.includes(ext)) continue;
      if (queryLower && !e.name.toLowerCase().includes(queryLower)) continue;
      let size = 0, mtimeMs = 0;
      try { const st = fs.statSync(full); size = st.size; mtimeMs = st.mtimeMs; } catch (e2) { /* lien mort, permission... */ }
      batch.push({ name: e.name, path: full, dir, ext, size, mtimeMs });
      total++;
      if (total >= SEARCH_FILES_LIMIT) { truncated = true; break; }
    }
    flush(false);
    setImmediate(step);
  }
  setImmediate(step);

  return requestId;
});

// ---------- Image produit → dossier partagé Axonaut (Synology) ----------
// Axonaut n'a pas de champ "image" dans son API produit (confirmé via leur doc v2) : pas moyen
// d'attacher une photo à la création. À la place, on enregistre l'image dans ce dossier partagé
// sur le NAS pour que ce soit rapide de la glisser-déposer à la main dans Axonaut ensuite.
const AXONAUT_IMAGES_DIR = '\\\\SB-CONFECTION\\Atelier CSB\\Images AXONAUT';
ipcMain.handle('csb:save-axonaut-image', (_event, { filename, dataBase64 }) => {
  if (!filename || !dataBase64) throw new Error('Nom de fichier ou image manquant.');
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '_');
  fs.mkdirSync(AXONAUT_IMAGES_DIR, { recursive: true });
  const fullPath = path.join(AXONAUT_IMAGES_DIR, safeName);
  fs.writeFileSync(fullPath, Buffer.from(dataBase64, 'base64'));
  return fullPath;
});
const AXONAUT_IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
// Retrouve la vignette d'un article (enregistrée par le handler ci-dessus, nommée d'après sa
// référence) pour l'afficher dans les lignes de devis/commande — la référence ne connaît pas
// l'extension d'origine, donc on cherche le premier fichier qui correspond, quelle qu'elle soit.
ipcMain.handle('csb:get-axonaut-image', (_event, reference) => {
  if (!reference) return null;
  const safeName = String(reference).replace(/[^a-zA-Z0-9_-]/g, '_');
  try {
    const match = fs.readdirSync(AXONAUT_IMAGES_DIR).find((f) => path.parse(f).name === safeName);
    if (!match) return null;
    const ext = path.extname(match).toLowerCase();
    const mime = AXONAUT_IMAGE_MIME[ext];
    if (!mime) return null;
    const data = fs.readFileSync(path.join(AXONAUT_IMAGES_DIR, match));
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (e) {
    return null;
  }
});
// Vignettes gérées depuis le module Articles : suppression (toutes extensions) et renommage quand
// le code article change. Mêmes règles de nom que csb:get-axonaut-image.
const axonautImageName = (reference) => String(reference || '').replace(/[^a-zA-Z0-9_-]/g, '_');
const axonautImageFiles = (reference) => {
  const name = axonautImageName(reference);
  try {
    return fs.readdirSync(AXONAUT_IMAGES_DIR).filter((f) => path.parse(f).name === name && AXONAUT_IMAGE_MIME[path.extname(f).toLowerCase()]);
  } catch (e) {
    return [];
  }
};
ipcMain.handle('csb:delete-axonaut-image', (_event, reference) => {
  if (!reference) return 0;
  const files = axonautImageFiles(reference);
  files.forEach((f) => fs.unlinkSync(path.join(AXONAUT_IMAGES_DIR, f)));
  return files.length;
});
ipcMain.handle('csb:rename-axonaut-image', (_event, { from, to }) => {
  if (!from || !to || axonautImageName(from) === axonautImageName(to)) return false;
  const files = axonautImageFiles(from);
  if (!files.length) return false;
  axonautImageFiles(to).forEach((f) => fs.unlinkSync(path.join(AXONAUT_IMAGES_DIR, f)));
  const src = files[0];
  fs.renameSync(path.join(AXONAUT_IMAGES_DIR, src), path.join(AXONAUT_IMAGES_DIR, axonautImageName(to) + path.extname(src).toLowerCase()));
  files.slice(1).forEach((f) => fs.unlinkSync(path.join(AXONAUT_IMAGES_DIR, f)));
  return true;
});

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
// Deuxième connexion IMAP, réservée aux tâches de fond (demandes, compteur) : une connexion IMAP
// ne traite qu'un dossier à la fois, donc sans elle la liste des mails attendait leur fin.
let cachedImapBgClient = null;
async function getImapBgClient() {
  if (cachedImapBgClient && cachedImapBgClient.usable) return cachedImapBgClient;
  const creds = emailReadCreds();
  if (!creds.email || !creds.appPassword) throw new Error('Email non connecté.');
  const client = new ImapFlow({ host: creds.host || 'imap.gmail.com', port: creds.port || 993, secure: true, auth: { user: creds.email, pass: creds.appPassword }, logger: false });
  await client.connect();
  cachedImapBgClient = client;
  client.on('close', () => { if (cachedImapBgClient === client) cachedImapBgClient = null; });
  client.on('error', () => { if (cachedImapBgClient === client) cachedImapBgClient = null; });
  return client;
}
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
  allMailPathCache = null;
  if (cachedImapBgClient) { try { cachedImapBgClient.logout(); } catch (e) {} cachedImapBgClient = null; }
  return { ok: true };
});
// Envoi d'un email (devis aux clients) avec le même compte et le même mot de passe
// d'application que la lecture IMAP. Gmail range automatiquement le message dans « Envoyés ».
ipcMain.handle('csb:email-send', async (_event, { to, cc, bcc, subject, text, html, attachments }) => {
  const creds = emailReadCreds();
  if (!creds.email || !creds.appPassword) {
    throw new Error("Compte email non configuré : connecte-le d'abord dans le module Email (adresse + mot de passe d'application).");
  }
  const imapHost = creds.host || 'imap.gmail.com';
  const smtpHost = /^imap\./i.test(imapHost) ? imapHost.replace(/^imap\./i, 'smtp.') : 'smtp.gmail.com';
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: smtpHost, port: 465, secure: true,
    auth: { user: creds.email, pass: creds.appPassword }
  });
  const info = await transporter.sendMail({
    from: creds.email, to, cc: cc || undefined, bcc: bcc || undefined, subject, text, html,
    attachments: (attachments || []).map(a => ({ filename: a.filename, content: Buffer.from(a.base64, 'base64'), contentType: a.contentType || 'application/pdf' }))
  });
  return { messageId: info.messageId, from: creds.email, accepted: info.accepted, rejected: info.rejected };
});
ipcMain.handle('csb:email-status', () => {
  const creds = emailReadCreds();
  return { connected: !!(creds.email && creds.appPassword), email: creds.email || '' };
});
ipcMain.handle('csb:email-disconnect', async () => {
  emailWriteCreds({ email: '', appPassword: '' });
  if (cachedImapClient) { try { await cachedImapClient.logout(); } catch (e) {} }
  cachedImapClient = null;
  if (cachedImapBgClient) { try { await cachedImapBgClient.logout(); } catch (e) {} cachedImapBgClient = null; }
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
  const client = await imapClientFor(mailbox);
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
  const client = await imapClientFor(mailbox);
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
  const client = await imapClientFor(mailbox);
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
        // les UID croissent avec l'arrivée des mails : s'il existe un UID plus petit que le premier
        // mail récent, il y a des mails plus anciens — sans refaire une recherche dans tout le dossier
        targetUids = recentUids.slice().reverse();
        hasMore = recentUids.length ? (client.mailbox && client.mailbox.exists > recentUids.length) : (client.mailbox && client.mailbox.exists > 0);
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
      for await (const msg of client.fetch(targetUids, { envelope: true, flags: true, bodyStructure: true, labels: true, threadId: true }, { uid: true })) {
        const from = (msg.envelope.from && msg.envelope.from[0]) || {};
        results.push({
          uid: msg.uid,
          subject: msg.envelope.subject || '(sans objet)',
          from: { name: from.name || from.address || '', email: from.address || '' },
          date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
          unread: !(msg.flags && msg.flags.has('\\Seen')),
          flagged: !!(msg.flags && msg.flags.has('\\Flagged')),
          hasAttachment: bodyStructureHasAttachment(msg.bodyStructure),
          labels: msg.labels ? [...msg.labels] : [],
          threadId: msg.threadId ? String(msg.threadId) : null
        });
      }
    }
    results.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    // Mails épinglés du dossier (drapeau Flagged = étoile Gmail / épingle Spark) : la liste les
    // garde en tête même quand ils sont plus anciens que les mails chargés.
    let pinnedUids = [];
    try { pinnedUids = ((await client.search({ flagged: true }, { uid: true })) || []).slice(-50); } catch (e) { /* pas grave */ }
    return { items: results, hasMore, pinnedUids };
  } finally {
    lock.release();
  }
});

// Récupère le résumé (expéditeur/objet/date/lu) de mails précis par UID, sans les marquer comme
// lus — utilisé pour ré-afficher un mail épinglé qui n'est plus dans les 40 derniers mails
// chargés (ou hors du filtre de recherche en cours), sans le rouvrir pour de vrai.
ipcMain.handle('csb:email-get-by-uids', async (_event, { uids, mailbox }) => {
  if (!uids || !uids.length) return [];
  const client = await imapClientFor(mailbox);
  const lock = await client.getMailboxLock(mailbox || 'INBOX');
  try {
    const results = [];
    for await (const msg of client.fetch(uids.map(String), { envelope: true, flags: true, bodyStructure: true, labels: true, threadId: true }, { uid: true })) {
      const from = (msg.envelope.from && msg.envelope.from[0]) || {};
      results.push({
        uid: msg.uid,
        subject: msg.envelope.subject || '(sans objet)',
        from: { name: from.name || from.address || '', email: from.address || '' },
        date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
        unread: !(msg.flags && msg.flags.has('\\Seen')),
        flagged: !!(msg.flags && msg.flags.has('\\Flagged')),
        hasAttachment: bodyStructureHasAttachment(msg.bodyStructure),
        labels: msg.labels ? [...msg.labels] : [],
        threadId: msg.threadId ? String(msg.threadId) : null
      });
    }
    return results;
  } finally {
    lock.release();
  }
});

ipcMain.handle('csb:email-get-message', async (_event, { uid, mailbox }) => {
  const client = await imapClientFor(mailbox);
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

// ---------- Demandes (module Devis) : recherche Gmail, conversations et libellés ----------
// Les demandes de prix et commandes reçues par mail sont repérées par des libellés Gmail
// (« Demandes/Prix », « Demandes/Commande », « Demandes/Traite »…), posés depuis l'appli ou
// depuis Spark : l'état reste donc dans la boîte mail elle-même, visible des deux côtés.
// On travaille dans « Tous les messages » pour voir aussi nos réponses dans les conversations.
let allMailPathCache = null;
async function gmailAllMailPath(client) {
  if (allMailPathCache) return allMailPathCache;
  const list = await client.list();
  const all = list.find((f) => f.specialUse === '\\All');
  allMailPathCache = all ? all.path : 'INBOX';
  return allMailPathCache;
}
// Les opérations sur « Tous les messages » (demandes, conversations) passent par la connexion de
// fond : une connexion IMAP n'a qu'un dossier ouvert à la fois, et faire basculer la connexion
// principale entre la boîte de réception et « Tous les messages » ralentissait tout l'affichage.
async function imapClientFor(mailbox) {
  if (mailbox && allMailPathCache && mailbox === allMailPathCache && mailbox !== 'INBOX') return getImapBgClient();
  return getImapClient();
}
function demandeSummary(msg) {
  const env = msg.envelope || {};
  const from = (env.from && env.from[0]) || {};
  return {
    uid: msg.uid,
    threadId: msg.threadId ? String(msg.threadId) : null,
    labels: msg.labels ? [...msg.labels] : [],
    subject: env.subject || '(sans objet)',
    from: { name: from.name || from.address || '', email: (from.address || '').toLowerCase() },
    to: (env.to || []).map((a) => (a.address || '').toLowerCase()).filter(Boolean),
    date: env.date ? new Date(env.date).toISOString() : null,
    unread: !(msg.flags && msg.flags.has('\\Seen')),
    hasAttachment: bodyStructureHasAttachment(msg.bodyStructure)
  };
}
const DEMANDE_FETCH = { envelope: true, flags: true, labels: true, threadId: true, bodyStructure: true };
// Recherche avec la syntaxe de la barre de recherche Gmail (ex. « label:Demandes-Prix »).
ipcMain.handle('csb:demandes-search', async (_event, { gmraw, limit }) => {
  const client = await getImapBgClient();
  const mailbox = await gmailAllMailPath(client);
  const lock = await client.getMailboxLock(mailbox);
  try {
    const uids = (await client.search({ gmraw }, { uid: true })) || [];
    const take = uids.slice(-(limit || 300));
    const items = [];
    if (take.length) for await (const msg of client.fetch(take, DEMANDE_FETCH, { uid: true })) items.push(demandeSummary(msg));
    return { mailbox, items };
  } finally {
    lock.release();
  }
});
// Tous les messages des conversations demandées (y compris nos réponses et les relances).
ipcMain.handle('csb:demandes-threads', async (_event, { threadIds }) => {
  const client = await getImapBgClient();
  const mailbox = await gmailAllMailPath(client);
  const lock = await client.getMailboxLock(mailbox);
  try {
    const uids = new Set();
    const ids = (threadIds || []).map(String);
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40);
      const query = chunk.length === 1 ? { threadId: chunk[0] } : { or: chunk.map((id) => ({ threadId: id })) };
      const found = (await client.search(query, { uid: true })) || [];
      found.forEach((u) => uids.add(u));
    }
    const items = [];
    if (uids.size) for await (const msg of client.fetch([...uids], DEMANDE_FETCH, { uid: true })) items.push(demandeSummary(msg));
    return { mailbox, items };
  } finally {
    lock.release();
  }
});
// Texte d'un PDF (pièce jointe d'une demande) avec la position de chaque morceau de texte, pour
// relire les tableaux des bons de commande (colonnes Référence / Désignation / Quantité…).
let pdfjsPromise = null;
ipcMain.handle('csb:pdf-text', async (_event, { base64, maxPages }) => {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await pdfjsPromise;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(base64, 'base64')), useSystemFonts: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages || 10); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str, x: Math.round(it.transform[4]), y: Math.round(it.transform[5]) })));
  }
  await doc.destroy();
  return pages;
});
// Conversation d'un mail ouvert dans un dossier quelconque (module Email) : renvoie tous ses
// messages vus depuis « Tous les messages », pour y poser les libellés des demandes.
ipcMain.handle('csb:demandes-thread-of', async (_event, { uid, mailbox }) => {
  const client = await getImapBgClient();
  let threadId = null;
  let lock = await client.getMailboxLock(mailbox || 'INBOX');
  try {
    const msg = await client.fetchOne(String(uid), { threadId: true }, { uid: true });
    threadId = msg && msg.threadId ? String(msg.threadId) : null;
  } finally {
    lock.release();
  }
  if (!threadId) throw new Error('Conversation introuvable pour ce mail.');
  const all = await gmailAllMailPath(client);
  lock = await client.getMailboxLock(all);
  try {
    const uids = (await client.search({ threadId }, { uid: true })) || [];
    const items = [];
    if (uids.length) for await (const m of client.fetch(uids, DEMANDE_FETCH, { uid: true })) items.push(demandeSummary(m));
    return { mailbox: all, threadId, items };
  } finally {
    lock.release();
  }
});
// Ajoute / retire des libellés Gmail (créés au besoin) sur des messages.
ipcMain.handle('csb:email-labels', async (_event, { uids, add, remove }) => {
  if (!uids || !uids.length) return { ok: true };
  const client = await getImapBgClient();
  const mailbox = await gmailAllMailPath(client);
  if (add && add.length) {
    const existing = new Set((await client.list()).map((f) => f.path));
    for (const label of add) {
      if (!existing.has(label)) { try { await client.mailboxCreate(label); } catch (e) { /* déjà créé entre-temps */ } }
    }
  }
  const lock = await client.getMailboxLock(mailbox);
  try {
    const range = uids.map(String).join(',');
    if (add && add.length) await client.messageFlagsAdd(range, add, { uid: true, useLabels: true });
    if (remove && remove.length) await client.messageFlagsRemove(range, remove, { uid: true, useLabels: true });
    return { ok: true };
  } finally {
    lock.release();
  }
});

app.on('before-quit', async () => {
  if (cachedImapClient) { try { await cachedImapClient.logout(); } catch (e) {} }
  if (cachedImapBgClient) { try { await cachedImapBgClient.logout(); } catch (e) {} }
});

// ---------- Vectorisation (VTracer) ----------
// @visioncortex/vtracer est un module Node (le moteur Rust/WASM tourne ici, dans le
// processus principal) — le module Vectorisation, lui, s'exécute dans un iframe sandboxé
// sans accès à Node. Le socle (src/shell/shell.js) relaie donc la demande depuis l'iframe
// jusqu'ici via postMessage, exactement comme il relaie déjà l'authentification.
ipcMain.handle('csb:vectorize', (_event, { rgba, width, height, options }) => {
  return vtracer.convertPixels(new Uint8Array(rgba), width, height, options || {});
});
