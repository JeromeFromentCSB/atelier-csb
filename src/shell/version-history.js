// Historique des versions affiché dans la popup accessible depuis le numéro de version
// (en haut à droite du bandeau). À mettre à jour à chaque nouvelle version publiée — ajouter
// une entrée en tête de tableau (ordre décroissant, la plus récente en premier).
const APP_VERSION_HISTORY = [
  { v: '0.2.28', items: [
    "Inventaire : l'import du catalogue TopTex (70 000+ références, forcément long) enregistre désormais chaque page au fur et à mesure au lieu d'attendre la toute fin — un timeout en cours de route ne fait plus tout perdre, un bouton « Reprendre l'import » permet de continuer exactement où ça s'est arrêté",
  ]},
  { v: '0.2.27', items: [
    "Inventaire : l'import du catalogue TopTex retente automatiquement en cas de timeout passager (HTTP 504/502/503) au lieu d'abandonner tout l'import, et utilise des pages plus petites pour réduire le risque",
  ]},
  { v: '0.2.26', items: [
    "Inventaire : correction de l'import du catalogue TopTex — il ne récupérait qu'un petit sous-ensemble récent (~200 lignes) au lieu du catalogue complet, d'où des références bien réelles absentes après import ; le sélecteur « Type » du Catalogue fournisseurs restait aussi vide (mauvaise extraction du champ), corrigé également",
  ]},
  { v: '0.2.25', items: [
    "Gestion Casaque : l'étiquette Colissimo s'affiche automatiquement juste après « Valider et générer » (si tout s'est bien passé), sans avoir à recliquer sur télécharger",
  ]},
  { v: '0.2.24', items: [
    "Correction (Colissimo/France Express) : la fenêtre de réglages affichait des champs vides — au lieu d'une vraie erreur — quand la connexion au serveur avait un souci passager, ce qui donnait l'impression que les réglages étaient perdus et invitait à écraser les vraies valeurs en ressaisissant. Un bandeau d'avertissement apparaît désormais dans ce cas et empêche d'enregistrer par-dessus",
  ]},
  { v: '0.2.23', items: [
    "Pense-bête : possibilité de marquer une note en priorité (⭐) — elle remonte en haut de la liste ; nécessite d'ajouter le champ « priorite » (Bool) à la collection pensebete dans PocketBase",
  ]},
  { v: '0.2.22', items: [
    "Pense-bête : bouton ↻ pour actualiser la liste des notes (utile après une note ajoutée depuis un autre appareil)",
  ]},
  { v: '0.2.21', items: [
    "Pense-bête : changer la liste d'une note ouvre maintenant un choix parmi les listes existantes (au lieu d'une saisie manuelle)",
  ]},
  { v: '0.2.20', items: [
    "Correction : en quittant l'onglet Fournisseurs (ou Axonaut) pour un autre onglet, le site affiché restait visible par-dessus le nouvel onglet au lieu de disparaître",
  ]},
  { v: '0.2.19', items: [
    "Pense-bête : possibilité de changer la liste d'une note déjà créée (tag cliquable sous chaque note)",
  ]},
  { v: '0.2.18', items: [
    "Nouvel onglet Pense-bête : les mêmes notes que sur l'appli iPhone (Pense-bête CSB), directement dans Atelier CSB",
  ]},
  { v: '0.2.17', items: [
    "Les onglets (Gestion Commande, Gestion Casaque…) peuvent maintenant être réorganisés par glisser-déposer ; l'ordre choisi est mémorisé sur ce poste",
  ]},
  { v: '0.2.16', items: [
    "Correction (la vraie cette fois) : en revenant sur l'onglet Axonaut (ou Fournisseurs) après être passé sur un autre onglet, la page restait parfois réduite à une petite bande en haut au lieu d'occuper toute la hauteur",
  ]},
  { v: '0.2.15', items: [
    "Correction : en revenant sur l'onglet Gestion Commande après être passé sur un autre onglet, la fenêtre restait parfois réduite à une petite bande en haut au lieu d'occuper toute la hauteur",
  ]},
  { v: '0.2.14', items: [
    "Gestion Commande : une commande peut désormais avoir plusieurs colis/étiquettes (bouton « Étiquette supplémentaire », chaque colis avec ses propres impression/CN23/facture/refaire/supprimer)",
  ]},
  { v: '0.2.13', items: [
    "Nouvel onglet Fournisseurs : mini-navigateur à onglets pour TopTex, Valento, Imbretex, Falk & Ross et Safety Jogger (liste modifiable avec ✎)",
    "Fournisseurs : identifiants mémorisables par site (bouton 🔑, chiffrés sur le poste), pré-remplis et validés automatiquement à l'ouverture de la page de connexion",
  ]},
  { v: '0.2.12', items: [
    "Correction : les réglages partagés (Colissimo, France Express…) ne se chargeaient pas depuis un poste à distance si la bascule automatique vers Tailscale n'avait pas eu le temps de se faire",
  ]},
  { v: '0.2.11', items: [
    "Sécurité : les données PocketBase (commandes, casaques, réglages…) exigent désormais un compte connecté, plus d'accès public",
    "Accès à distance : bascule automatique sur Tailscale si le réseau local de l'atelier n'est pas joignable",
  ]},
  { v: '0.2.10', items: [
    "Possibilité d'ouvrir 2 fenêtres de l'appli en même temps",
    "Réglages Colissimo et France Express désormais partagés entre tous les postes via PocketBase (compte Axonaut et email restent par poste)",
    "Stock de Fil : bouton pour générer un PDF de l'état du stock (numéro, couleur, quantité), trié par numéro, caisses puis étagères",
  ]},
  { v: '0.2.9', items: [
    "Gestion Commande : les réglages Colissimo/France Express/PocketBase sont maintenant migrés automatiquement vers le fichier persistant de l'appli dès l'ouverture, pour ne plus se perdre à une mise à jour",
  ]},
  { v: '0.2.8', items: [
    "Gestion Casaque : la signature de la facture douane imprimée ne disparaît plus (elle ne dépendait plus du réglage \"graphiques d'arrière-plan\" de l'imprimante)",
  ]},
  { v: '0.2.7', items: [
    "Gestion Casaque : nouvelle tentative de correction de la facture douane imprimée (mise en page sans flex ni tableau pour la ligne signature, plus fiable à l'impression)",
  ]},
  { v: '0.2.6', items: [
    "Gestion Casaque : correction de la facture douane imprimée — la signature ne saute plus sur une page à part et se trouve juste sous la dernière ligne",
  ]},
  { v: '0.2.5', items: [
    "Email : affichage des mails des 30 derniers jours en un seul chargement, bouton « Charger plus » pour remonter au-delà",
    "Email : glisser-déposer un mail vers un dossier de la colonne de gauche pour le déplacer",
    "Email : option « Conversations » pour regrouper les mails d'un même échange",
    "Stock de Fil (Trouver couleur) : outil pipette pour lire directement le code d'une couleur sur l'image",
    "Stock de Fil (Recherche) : si une référence n'est pas en stock, suggestion des couleurs les plus proches disponibles avec % d'écart",
    "Gestion Commande : suppression individuelle des photos liées à une commande, avec un droit dédié par utilisateur",
  ]},
  { v: '0.2.4', items: [
    "Correction des mises à jour automatiques sur Mac (le fichier nécessaire à l'installation automatique manquait)",
  ]},
  { v: '0.2.3', items: [
    "Onglet Commande : référence article et prix HT visibles dans le détail des lignes, réservés aux admins",
    "Nouvelle petite appli mobile pour prendre une photo depuis le téléphone et l'affecter directement à une commande",
    "Réglages Fabrication/Demande de prix : message d'erreur plus précis en cas de problème d'accès au dossier",
  ]},
  { v: '0.2.2', items: [
    "Bon de fabrication : coordonnées de l'Atelier CSB (au lieu de l'expéditeur Colissimo), logo agrandi, gestion des documents de plusieurs pages",
    "Gestion Commande : masquage complet des prix pour les comptes non-admin (liste, devis, détail des lignes)",
    "Gestion Casaque : les étiquettes/CN23/factures générées sont aussi sauvegardées sur le serveur, pas seulement sur l'appareil",
  ]},
  { v: '0.2.1', items: [
    "Droits par utilisateur pour l'onglet État du stock (Stock de Fil)",
    "Droits par utilisateur pour les boutons Exporter / Exporter les alertes / Doublons probables (Gestion Casaque)",
    "Le bouton d'étiquette (Gestion Commande) ouvre le PDF pour impression au lieu de le télécharger",
  ]},
  { v: '0.2.0', items: [
    "Les modules gardent leur état en changeant d'onglet (plus de rechargement à chaque clic)",
    "Mises à jour automatiques via GitHub Releases (plus besoin de copie manuelle sur le NAS)",
    "Module Email (IMAP) et verrou anti-double-instance",
  ]},
  { v: '0.1.0', items: [
    "Première version : Gestion Commande, Casaque, Inventaire, Stock de Fil, Prospection, Pointage, Email",
  ]},
];
