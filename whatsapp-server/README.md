# Serveur d'envoi (WhatsApp + Email) — Atelier CSB

Petit serveur à part, à lancer en continu sur le PC de l'atelier (comme PocketBase). Il permet à
la page mobile **Photos commandes** (`mobile/photo.html`) d'envoyer une photo déjà prise, par
email ou par WhatsApp, à un contact précis.

## Installation (une seule fois)

```bash
cd whatsapp-server
npm install
```

## Démarrage

Double-clique sur **`Lancer WhatsApp.bat`**, ou en ligne de commande :

```bash
npm start
```

La première fois, un QR code s'affiche dans le terminal (et sur `http://<ce-pc>:8092/qr`) : à
scanner depuis WhatsApp sur le téléphone qui doit envoyer les photos (Réglages → Appareils liés →
Lier un appareil). Ensuite la session reste connectée toute seule (dossier `.wwebjs_auth/`, créé
à côté de ce script) — plus besoin de rescanner, sauf si l'appareil lié est déconnecté depuis le
téléphone.

Laisse cette fenêtre ouverte en permanence — c'est elle qui reçoit les demandes d'envoi de la page
mobile.

## Email

Réutilise automatiquement le compte Gmail déjà configuré dans le module **Email** de l'appli
principale (adresse + mot de passe d'application) — rien à reconfigurer ici.

## WhatsApp — limitation connue

L'envoi de la photo en pièce jointe directe échoue pour l'instant (bug non résolu de la
bibliothèque `whatsapp-web.js` avec le nouveau système d'identifiants "LID" de WhatsApp — voir
leurs tickets GitHub). En attendant un correctif de leur côté, le serveur envoie automatiquement
un message texte avec le lien de la photo à la place (à copier-coller dans un navigateur).

## Accès hors du réseau de l'atelier (Tailscale)

Si Tailscale est installé sur le NAS (PocketBase) et relaie le réseau de l'atelier
(`192.168.1.0/24` en route annoncée + approuvée dans la console Tailscale), la page mobile et ce
serveur restent joignables depuis un téléphone connecté à Tailscale, même hors du Wi-Fi de
l'atelier.
