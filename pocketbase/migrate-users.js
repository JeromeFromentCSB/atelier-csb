/*
 * Script d'aide à la migration des comptes existants vers la collection unifiée "csb_users".
 *
 * ⚠️ CE SCRIPT N'EST PAS EXÉCUTÉ AUTOMATIQUEMENT. C'est un modèle à relire et adapter
 * toi-même avant de le lancer une fois, à la main, sur le réseau de l'atelier — il touche
 * des données réelles (comptes utilisateurs de production).
 *
 * Ce qu'il fait : pour chaque ancienne collection (une par module), il lit les comptes,
 * et crée un enregistrement correspondant dans la nouvelle collection "csb_users" avec
 * les bons droits dans le champ "permissions". Les mots de passe NE SONT PAS repris
 * (l'ancien hash SHA-256 "maison" n'est pas compatible avec le hachage sécurisé de
 * PocketBase Auth) — chaque utilisateur devra définir un nouveau mot de passe à sa
 * première connexion.
 *
 * Utilisation :
 *   1. npm install pocketbase   (déjà fait si tu es dans ce projet)
 *   2. Renseigne PB_URL, ADMIN_EMAIL, ADMIN_PASSWORD ci-dessous.
 *   3. node pocketbase/migrate-users.js
 */
const PocketBase = require('pocketbase/cjs');

const PB_URL = 'http://192.168.1.142:8090';
const ADMIN_EMAIL = 'CHANGE_ME@example.com'; // compte admin PocketBase (Settings → Admins)
const ADMIN_PASSWORD = 'CHANGE_ME';

async function main() {
  const pb = new PocketBase(PB_URL);
  await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);

  // --- Envoi Axonaut : collection "app_users" ---
  // Champs connus : username, password_hash, is_admin, access_devis, access_commandes,
  // access_settings, access_addressbook, access_etiquettes, access_devis_pdf.
  const axonautUsers = await pb.collection('app_users').getFullList();
  for (const u of axonautUsers) {
    await upsertUnifiedUser(pb, u.username, {
      role: u.is_admin ? 'admin' : 'user',
      modulePerms: {
        axonaut: {
          access: true,
          devis: !!u.access_devis,
          commandes: !!u.access_commandes,
          settings: !!u.access_settings,
          addressbook: !!u.access_addressbook,
          etiquettes: !!u.access_etiquettes,
          demande_prix: !!u.is_admin
        }
      }
    });
  }

  // --- Gestion Casaque : collection "csb_users_legacy_casaque" (renommée, voir SETUP.md) ---
  const casaqueUsers = await pb.collection('csb_users_legacy_casaque').getFullList();
  for (const u of casaqueUsers) {
    await upsertUnifiedUser(pb, u.username, {
      role: u.role === 'admin' ? 'admin' : 'user',
      modulePerms: {
        casaque: {
          access: true,
          coussin_trousse: !!u.can_coussin_trousse,
          labels: !!u.can_labels
        }
      }
    });
  }

  // --- Inventaire : adapte le nom de collection et les champs de droits réels avant de lancer ---
  // const inventaireUsers = await pb.collection('NOM_COLLECTION_INVENTAIRE').getFullList();
  // for (const u of inventaireUsers) {
  //   await upsertUnifiedUser(pb, u.username, {
  //     role: u.role === 'admin' ? 'admin' : 'user',
  //     modulePerms: { inventaire: { access: true } }
  //   });
  // }

  console.log('Migration terminée. Pense à prévenir chaque utilisateur : il devra définir un nouveau mot de passe.');
}

async function upsertUnifiedUser(pb, username, { role, modulePerms }) {
  if (!username) return;
  let existing = null;
  try {
    existing = await pb.collection('csb_users').getFirstListItem(`username = "${username}"`);
  } catch (e) {
    existing = null;
  }

  if (existing) {
    const mergedPermissions = { ...(existing.permissions || {}), ...modulePerms };
    const mergedRole = existing.role === 'admin' || role === 'admin' ? 'admin' : 'user';
    await pb.collection('csb_users').update(existing.id, { role: mergedRole, permissions: mergedPermissions });
    console.log(`Mis à jour : ${username}`);
  } else {
    const tempPassword = 'ChangeMoi' + Math.random().toString(36).slice(2, 8) + '!';
    await pb.collection('csb_users').create({
      username,
      password: tempPassword,
      passwordConfirm: tempPassword,
      role,
      permissions: modulePerms
    });
    console.log(`Créé : ${username} — mot de passe temporaire : ${tempPassword}`);
  }
}

main().catch((err) => {
  console.error('Échec de la migration :', err);
  process.exit(1);
});
