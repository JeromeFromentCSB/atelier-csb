# PocketBase — collection unifiée `csb_users`

✅ **Déjà fait** (créé directement via l'API PocketBase, voir historique de la conversation) :
la collection `csb_users` existe, en type **Auth**, avec les champs `username` (identifiant de
connexion), `role` et `permissions` décrits ci-dessous, les règles d'accès posées, et l'ancienne
collection `csb_users` de Gestion Casaque a été renommée en `csb_users_legacy_casaque` (comptes
existants intacts, l'app Casaque actuelle n'est pas affectée tant qu'elle n'est pas migrée).

Ce document sert maintenant de référence — utile pour migrer les autres modules (Casaque,
Inventaire, Stock de Fil) vers cette même collection.

## 1. Ce que contient la collection

- Nom : `csb_users`, type **Auth** (mot de passe haché nativement par PocketBase — plus de
  SHA-256 « maison »).
- Connexion par **nom d'utilisateur** (`username`), pas par email — l'email reste un champ
  optionnel, non utilisé par l'appli.

### Structure du champ `permissions`

Un objet avec une clé par module, et à l'intérieur les droits fins équivalents à ceux qui
existent déjà dans chaque app :

```json
{
  "axonaut": {
    "access": true,
    "devis": true,
    "commandes": true,
    "etiquettes": true,
    "devis_pdf": true,
    "settings": false,
    "addressbook": true
  },
  "casaque": {
    "access": true,
    "coussin_trousse": false,
    "labels": true
  },
  "inventaire": {
    "access": true,
    "catalogue": true,
    "recherche": true,
    "parametres": false,
    "export": true,
    "import": false
  },
  "stock_fil": {
    "access": true,
    "mouvements": true,
    "recherche": true,
    "parametres": false,
    "export": true,
    "import": false
  },
  "prospection": { "access": true },
  "pointage": { "access": true },
  "vectorisation": { "access": true }
}
```

- `access` = le module apparaît dans la barre latérale de l'appli (sinon il reste verrouillé).
- Un compte avec `role = admin` a **tous** les droits sur tous les modules, quel que soit le
  contenu de `permissions` — pas besoin de tout cocher pour un admin.
- Les autres clés reprennent le sens des droits déjà en place dans chaque app :
  - `axonaut` : `devis` / `commandes` (onglets), `etiquettes` (préparer les envois), `devis_pdf`
    (voir le PDF du devis depuis le bon de livraison), `settings`, `addressbook`. Les documents
    "demande de prix" restent réservés aux admins uniquement (pas de droit séparé, comme dans
    l'app d'origine).
  - `casaque` : `coussin_trousse` (modifier les cases Coussin/Trousse), `labels` (étiquettes
    Colissimo).
  - `inventaire` : `catalogue` / `recherche` / `parametres` (onglets), `export` / `import`
    (sauvegardes). `access` fait aussi office d'accès à l'onglet "Inventaire" lui-même.
  - `stock_fil` : `mouvements` / `recherche` / `parametres` (onglets), `export` / `import`
    (sauvegardes). `access` fait aussi office d'accès à l'onglet "État du stock".

**6 modules au total** : Axonaut, Gestion Casaque, Inventaire, Stock de Fil ont leurs droits
et leur connexion gérés par `csb_users` comme décrit ci-dessus. Stock de Fil a en plus été
migré de Firebase vers PocketBase (collections `stock_fil_movements`/`stock_fil_settings`).

**Prospection** et **Pointage** ont juste `access` (visibilité du module dans la barre du haut) —
aucun droit fin :
- `prospection` n'a pas de base de données du tout (recherche via des API publiques
  gouvernementales, données gardées uniquement dans le navigateur de chaque poste).
- `pointage` a déjà son propre système PocketBase (collections `pointage_*`) et sa propre
  notion de "profil employé" avec rôle utilisateur/administrateur — volontairement **laissée
  telle quelle** : un "employé pointé" n'est pas forcément un utilisateur du logiciel, donc ce
  n'est pas la même chose qu'un compte `csb_users`. Seul l'accès au module lui-même passe par
  le socle commun ; une fois dedans, Pointage garde sa propre sélection d'employé et son propre
  mode administrateur.
- `vectorisation` n'a pas de base de données non plus (traitement d'image 100% local dans le
  navigateur, aucun envoi réseau) — juste `access`.

**Règle d'accès `csb_users` assouplie** : la liste des identifiants (`username` uniquement,
pas les mots de passe ni les droits) est maintenant consultable sans être connecté, pour
peupler le menu déroulant de l'écran de connexion — comme le reste des collections CSB.

## 2. Règles d'API (déjà posées)

Chaque utilisateur voit/modifie son propre profil ; seul un admin peut créer, lister, modifier
ou supprimer les autres comptes :

- **List/Search** et **View** : `id = @request.auth.id || @request.auth.role = "admin"`
- **Create** et **Delete** : `@request.auth.role = "admin"`
- **Update** : `id = @request.auth.id || @request.auth.role = "admin"`
  (un utilisateur peut changer son propre mot de passe ; rien n'empêche aujourd'hui un
  utilisateur non-admin de modifier son propre champ `role`/`permissions` via l'API — l'interface
  ne montre ces champs qu'aux admins, mais ce n'est pas une garantie serveur ; à muscler plus tard
  avec une règle plus fine si besoin)

## 3. Premier compte admin — à faire

Crée un premier enregistrement directement dans l'admin UI PocketBase (`http://192.168.1.142:8090/_/`
→ Collections → `csb_users` → *New record*) :
- `username` : par ex. `admin`
- `password` : à définir, à changer ensuite depuis l'appli si besoin
- `role` : `admin`
- `permissions` : `{}` (inutile de la remplir, un admin a tout de toute façon)

## 4. Étape suivante (plus tard, pas maintenant)

Une fois qu'un module est réellement branché sur `CSBAuth` (voir `modules/<nom>/index.html`),
tu pourras migrer les comptes existants de l'ancienne collection de ce module vers `csb_users` —
voir `migrate-users.js` dans ce dossier (script à adapter et lancer toi-même, il n'est pas exécuté
automatiquement : il touche des données réelles de production).
