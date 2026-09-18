// Historique des versions affiché dans la popup accessible depuis le numéro de version
// (en haut à droite du bandeau). À mettre à jour à chaque nouvelle version publiée — ajouter
// une entrée en tête de tableau (ordre décroissant, la plus récente en premier).
const APP_VERSION_HISTORY = [
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
