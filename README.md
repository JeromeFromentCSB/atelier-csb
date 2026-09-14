# Atelier CSB — application unifiée

Regroupe 7 outils (Envoi Axonaut, Gestion Casaque, Inventaire, Stock de Fil, Prospection,
Pointage, Vectorisation) dans une seule application de bureau, pour Windows et Mac, avec des
droits admin/utilisateur communs à tous les modules, et des mises à jour automatiques.

## Décisions d'architecture

- **Electron** pour l'empaquetage bureau : les apps existantes utilisent des fonctionnalités
  spécifiques à Chrome (accès à un dossier réseau via l'API File System Access, IndexedDB) —
  Electron embarque Chromium et les préserve. Produit un `.exe` (installeur NSIS) pour Windows
  et un `.dmg` pour Mac.
- **PocketBase conservé** (déjà utilisé par 3 des 4 apps, sur le Synology) plutôt qu'une base
  externe : migration quasi nulle, gratuit sans quota, fonctionne sans connexion internet.
  Si un accès hors du réseau de l'atelier devient nécessaire un jour, la recommandation est
  d'exposer PocketBase via Tailscale (VPN gratuit et chiffré) plutôt que d'ouvrir un port.
- **Une collection d'utilisateurs unique** (`csb_users`, type Auth PocketBase) remplace les
  3 systèmes de droits séparés actuels — voir [pocketbase/SETUP.md](pocketbase/SETUP.md).

## Structure du projet

```
main.js              — processus principal Electron (fenêtre, menu, config locale)
preload.js            — pont sécurisé entre le processus principal et l'interface
src/shell/            — le socle : écran de connexion + barre latérale + zone d'affichage du module actif
src/shared/csb-auth.js — authentification et droits, partagés par le socle et par chaque module
src/shared/vendor/     — SDK PocketBase (copié localement, pas chargé depuis un CDN)
modules/<nom>/         — un dossier par module ; contient pour l'instant une page "à connecter"
pocketbase/            — schéma de la collection unifiée + script d'aide à la migration des comptes
```

## Lancer en développement

```bash
npm install
npm start
```

## Construire les installeurs

```bash
npm run dist:win    # produit un .exe (NSIS) dans dist/
npm run dist:mac     # produit un .dmg dans dist/ — doit être lancé depuis un Mac
```

⚠️ **electron-builder ne peut pas construire pour Mac depuis Windows.** Pour obtenir le `.dmg`,
il faudra soit lancer `npm run dist:mac` sur un Mac (même juste pour la compilation), soit passer
par un service de build cloud (GitHub Actions avec un runner macOS, par exemple — gratuit pour un
usage raisonnable). Le `.exe` Windows, lui, se construit très bien depuis Windows.

Le `.dmg` ne sera pas signé par un compte développeur Apple (ça coûte 99 $/an) : au premier
lancement sur Mac, il faudra faire clic droit → Ouvrir pour passer l'avertissement Gatekeeper.
Le `.exe` Windows n'est pas signé non plus : Windows SmartScreen affichera un avertissement au
premier lancement sur chaque poste — "Informations complémentaires" → "Exécuter quand même".

⚠️ **Windows — construire le `.exe` demande le mode développeur activé** (Paramètres → recherche
"développeurs" → active "Mode développeur"), sinon electron-builder échoue avec une erreur de
lien symbolique lors de l'extraction d'un de ses outils internes. À faire une seule fois sur la
machine qui construit les installeurs (pas nécessaire sur les postes qui se contentent d'utiliser
l'appli).

## Mises à jour automatiques

L'appli vérifie au démarrage si une version plus récente existe (via `electron-updater`), et si
oui : bandeau discret en bas de l'écran, téléchargement en arrière-plan, puis un bouton
"Redémarrer et installer" une fois prêt. Aucune action requise poste par poste.

Les fichiers de mise à jour sont hébergés dans le dossier `pb_public` de PocketBase sur le
Synology (servi automatiquement en fichiers statiques, à l'URL `http://192.168.1.142:8090/`) —
pas de serveur supplémentaire à gérer.

**Pour publier une nouvelle version :**
1. Augmente le numéro de version dans `package.json` (ex. `"version": "0.2.0"`).
2. `npm run dist:win` (variable d'environnement `CSC_IDENTITY_AUTO_DISCOVERY=false` recommandée
   pour éviter un téléchargement inutile d'outil de signature).
3. Dans `dist/`, récupère les 3 fichiers : `Atelier CSB Setup <version>.exe`, son `.blockmap`,
   et `latest.yml`.
4. Dépose-les dans `pb_public/app-updates/` sur le Synology (via l'interface PocketBase, ou un
   partage réseau/File Station vers ce dossier — à côté de `pb_data`).
5. Au prochain lancement, chaque poste détecte la nouvelle version automatiquement.

Le numéro de version dans `latest.yml` doit être strictement supérieur à celui déjà en place
pour que la mise à jour soit proposée.

## État actuel

**Les 6 modules sont branchés et fonctionnels** sur le socle commun :

- Fenêtre Electron avec écran de connexion PocketBase et barre latérale des 4 modules.
- Collection PocketBase `csb_users` (type Auth, champs `role`/`permissions`) — voir
  [pocketbase/SETUP.md](pocketbase/SETUP.md) pour le détail des droits par module.
- Chaque module verrouillé/déverrouillé selon les droits (`permissions`) du compte connecté.
- Écran **"👥 Utilisateurs"** dans la barre du haut (visible seulement pour un admin) : créer,
  modifier, supprimer des comptes et cocher leurs droits par module, sans passer par l'admin
  PocketBase.
- **Envoi Axonaut** (`modules/axonaut/`) : écran de connexion et gestion d'utilisateurs internes
  (collection `app_users`, hachage SHA-256 maison) retirés, remplacés par `CSBAuth`.
- **Gestion Casaque** (`modules/casaque/`) : même traitement (collection `csb_users` d'origine
  renommée en `csb_users_legacy_casaque`, comptes conservés mais plus utilisés).
- **Inventaire** (`modules/inventaire/`) : même traitement (le système de comptes+code PIN
  stocké dans les réglages a été retiré, remplacé par `CSBAuth`).
- **Stock de Fil** (`modules/stock_fil/`) : en plus du même traitement, **migré de Firebase vers
  PocketBase** (nouvelles collections `stock_fil_movements` et `stock_fil_settings`), avec
  récupération des données réelles depuis Firebase (voir `Recuperer_Stock_Fil_Firebase.html`
  généré ponctuellement pour cette bascule — à supprimer une fois que tu n'en as plus besoin).
- **Prospection** (`modules/prospection/`) : outil autonome (API publiques + stockage local),
  aucun changement interne, juste enregistré dans le socle avec un accès simple.
- **Pointage** (`modules/pointage/`) : garde volontairement son propre système de profils
  employés et son rôle utilisateur/administrateur interne — un employé pointé n'est pas
  forcément un utilisateur du logiciel CSB. Seul l'accès au module passe par le socle commun.
- **Vectorisation** (`modules/vectorisation/`) : nouveau module — transforme une image (logo,
  dessin, photo) en aplats de couleurs simplifiés (SVG), pour préparer une base propre à la
  numérisation broderie. Moteur : **VTracer** (`@visioncortex/vtracer`, Rust/WASM — plus rapide
  et meilleure qualité que l'alternative JS pur essayée d'abord). Comme ce moteur est un module
  Node, il tourne dans le **processus principal** d'Electron (`main.js`) ; le module lui-même
  (dans un iframe sans accès à Node) lui envoie l'image via le socle commun
  (`postMessage` → `src/shell/shell.js` → `csbHost.vectorize` → `main.js`), sur le même principe
  que le reste de l'authentification partagée. Réglages : type d'image (préréglages), nombre de
  couleurs, détail minimum (estimé pour une broderie ~100 mm de large), curseur de
  simplification, et options bruit/fusion de formes/contours/finition broderie. Export SVG et PNG.
  Tout se passe en local, aucune image n'est envoyée en dehors du poste — **sauf** le bouton
  optionnel **"🪄 Nettoyer avec l'IA"** (redessine l'image en version simplifiée avant
  vectorisation, via l'API OpenAI `images/edits`, modèle `gpt-image-1` par défaut, réglable) :
  celui-ci envoie l'image à OpenAI et nécessite une clé API personnelle (réglages ⚙︎ du module,
  stockée uniquement sur le poste) — chaque utilisation a un coût sur le compte OpenAI de
  l'atelier. Utile pour les logos/dessins à traits très fins que VTracer seul simplifie mal.
- **Mises à jour automatiques** en place (`electron-updater`) — voir section dédiée ci-dessus.
  Premier `.exe` de test construit (`dist/Atelier CSB Setup 0.1.0.exe`).
- **Correctif important** : `window.prompt()` n'est pas supporté par Electron (contrairement à
  `alert`/`confirm`) — remplacé partout par une fenêtre de saisie maison
  (`src/shared/csb-prompt.js`, fonction globale `customPrompt()`) dans Casaque et Pointage.

Reste à faire, au choix :
- **Icône de l'appli** : aucune pour l'instant (icône Electron par défaut) — fournir un `.ico`
  (Windows) et `.icns` (Mac) dans `build/`, puis les référencer dans `package.json` → `build.win.icon`
  / `build.mac.icon`.
- **Packager pour Mac** : `npm run dist:mac`, doit être lancé depuis un Mac ou via CI — voir plus haut.
- **Nettoyage** : les fichiers `Envoi_Axonaut_CSB_92.html`, `Gestion_Casaque_44.html`,
  `Inventaire_CSB_10.html`, `Stock_Fil_CSB_9.html`, `Prospection_CSB_10.html`,
  `Pointage_CSB_25.html` dans `Downloads` ont été édités sur place pendant le développement (ce
  sont des versions de travail, plus les fichiers de référence — ces derniers vivent maintenant
  dans `modules/*/index.html`) ; à archiver ou supprimer si plus besoin. Idem pour
  `Recuperer_Stock_Fil_Firebase.html`.
- **Accès distant** (si besoin un jour) : exposer PocketBase via Tailscale plutôt que d'ouvrir
  un port sur la box, pour utiliser l'appli hors du réseau de l'atelier.
- Migrer les comptes existants restants (Casaque, s'il y en avait d'autres que les tiens) vers
  `csb_users` avec `pocketbase/migrate-users.js`, ou recréer directement depuis l'écran
  "👥 Utilisateurs" — plus simple pour un petit nombre de comptes.

Limite connue : la règle PocketBase "Update" de `csb_users` permet en théorie à un utilisateur
non-admin de modifier son propre champ `role`/`permissions` via un appel API direct (l'interface
ne le permet pas, mais ce n'est pas bloqué côté serveur). À muscler plus tard si besoin.
