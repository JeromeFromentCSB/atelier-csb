/*
 * Ajoute le champ « priorite » (nombre : 0 normale, 1 importante ⭐, 2 urgente 🔴) à la
 * collection PocketBase « pensebete ». À lancer une fois, à la main :
 *   node pocketbase/add-pensebete-priorite.js
 * Le mot de passe administrateur est demandé au clavier (il n'est ni affiché ni enregistré).
 */
const PocketBase = require('pocketbase/cjs');
const readline = require('readline');

const PB_URL = 'http://192.168.1.142:8090';
const ADMIN_EMAIL = 'atelier.csb@gmail.com';

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const pb = new PocketBase(PB_URL);
  const password = await askHidden(`Mot de passe admin PocketBase (${ADMIN_EMAIL}) : `);
  await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, password);
  const col = await pb.collections.getOne('pensebete');
  if (col.fields.some((f) => f.name === 'priorite')) {
    console.log('Le champ « priorite » existe déjà — rien à faire.');
    return;
  }
  col.fields.push({ name: 'priorite', type: 'number', required: false, onlyInt: true, min: 0, max: 2 });
  await pb.collections.update(col.id, { fields: col.fields });
  console.log('✔ Champ « priorite » ajouté à la collection « pensebete ».');
})().catch((e) => {
  console.error('Échec :', e.response && e.response.message ? e.response.message : e.message);
  process.exit(1);
});
