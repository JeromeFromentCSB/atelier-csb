# Relais Axonaut + suivi des devis (Cloudflare)

`worker.js` = le relais existant (`axonaut-proxy` : Axonaut, images, Valento, Colissimo), **inchangé**,
plus le suivi des devis du module Devis (page client, ouvertures, acceptation en ligne).

- Les appels habituels du relais (adresse racine avec `?path=`, `?img=`, `?valento=`, `?colissimo=`)
  passent exactement comme avant : vérifié en comparant les réponses de l'ancien et du nouveau code.
- Le suivi utilise ses propres chemins : `/d/…` (page client) et `/api/devis…` (application).
- `worker-avant-suivi.js` = l'ancien code, à recoller tel quel pour revenir en arrière.

## Mise en place (une seule fois, ~10 minutes)

Sur **https://dash.cloudflare.com** :

### 1. Créer l'espace de stockage des devis
1. Menu de gauche : **Storage & Databases → KV** (ou *Workers KV*).
2. **Create** → nom : `devis-suivi` → **Add**.

### 2. Relier le stockage et la clé au relais
**Workers & Pages → axonaut-proxy → Settings** :
1. **Bindings → Add → KV namespace** :
   - *Variable name* : `DEVIS` (exactement, en majuscules)
   - *KV namespace* : `devis-suivi`
   → **Deploy**.
2. **Variables and Secrets → Add** :
   - *Type* : **Secret** — *Name* : `DEVIS_API_KEY`
   - *Value* : une longue suite de caractères au hasard (au moins 30). **Garde-la** pour l'étape 4.
   → **Deploy**.
   (Ne touche pas au secret `COLISSIMO_API_KEY` déjà présent.)

### 3. Remplacer le code
**axonaut-proxy → Edit code** : sélectionne tout, colle le contenu de `worker.js` de ce dossier,
puis **Deploy**.

Vérification immédiate : dans l'application, **Gestion Commande → ↻ Actualiser** doit toujours
charger les commandes. Sinon, recolle `worker-avant-suivi.js` et **Deploy** pour revenir à l'état d'avant.

### 4. Renseigner l'application
Module **Devis → ⚙︎ Réglages du module → Envoi des devis** :
- *Clé secrète* : la valeur de `DEVIS_API_KEY` ;
- l'adresse du relais est reprise automatiquement (laisser vide) ;
- **Tester la connexion**, puis **Enregistrer l'envoi des devis**.

## Bon à savoir
- Une **ouverture** n'est comptée que quand la page s'affiche vraiment dans un navigateur (les robots
  qui pré-chargent les liens des emails ne sont pas comptés).
- Le lien reste le même quand on renvoie un devis modifié : le PDF en ligne est simplement remplacé.
- Quand un devis est annulé ou refusé dans le module, sa page indique qu'il n'est plus valable.

## Suivi des colis Colissimo (onglet « 🚚 Suivi colis » de Gestion Commande)

Le relais sait aussi interroger le suivi Colissimo : `?colissimoSuivi=<n° de colis>`.
Il utilise **la même clé que les étiquettes** (secret `COLISSIMO_API_KEY`), rien à ajouter en principe.

Pour l'activer : copie le contenu de `worker.js` dans l'éditeur du Worker sur Cloudflare, puis **Deploy**.

Si Colissimo refuse la clé seule pour le suivi (message « Compte non authentifié »), ajoute deux secrets
dans *Settings → Variables and Secrets* : `COLISSIMO_LOGIN` (n° de contrat Colissimo, 6 chiffres) et
`COLISSIMO_PASSWORD` (mot de passe de la Colissimo Box), puis **Deploy**.
