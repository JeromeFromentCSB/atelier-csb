'use strict';

/* ============================================================================
   Lecture/écriture des formats de programmes de broderie (DST, PES, VP3, PXF).
   Extrait de Gestion Casaque (utilisé par l'import de bibliothèque) et du
   Visualiseur (devenu le module Recherche / Éditeur) pour être partagé par
   les deux sans dupliquer ce code — voir ces modules pour l'utilisation
   concrète (assemblage PocketBase côté Casaque, explorateur de fichiers côté
   Recherche / Éditeur).

   1) CODEC DST — décodage/encodage bit-à-bit (Tajima).
   Validé : round-trip octet-pour-octet identique sur fichier réel,
   décomposition ternaire équilibrée testée exhaustivement (-121..121),
   décomposition en programmes/segments validée sur fichier composite réel.
   Unité DST = 0.1 mm.
============================================================================ */
const STITCH = 0, JUMP = 1, COLOR = 2, END = 3;

function parseDstHeader(bytes) {
  const text = new TextDecoder('ascii').decode(bytes.slice(0, 512));
  const grab = (label) => {
    const m = text.match(new RegExp(label + ':\\s*([+\\-]?\\d+)'));
    return m ? parseInt(m[1], 10) : 0;
  };
  const nameMatch = text.match(/LA:(.{0,16})/);
  return {
    name: nameMatch ? nameMatch[1].trim() : '',
    stitchCount: grab('ST'), colorCount: grab('CO'),
    plusX: grab('\\+X'), minusX: grab('-X'), plusY: grab('\\+Y'), minusY: grab('-Y'),
  };
}

function decodeDstBody(bytes, headerLen = 512) {
  const body = bytes.slice(headerLen);
  const n = Math.floor(body.length / 3);
  const stitches = [];
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    const b1 = body[i * 3], b2 = body[i * 3 + 1], b3 = body[i * 3 + 2];
    let dx = 0, dy = 0;
    if (b1 & 0x01) dx += 1;   if (b1 & 0x02) dx -= 1;
    if (b1 & 0x04) dx += 9;   if (b1 & 0x08) dx -= 9;
    if (b1 & 0x80) dy += 1;   if (b1 & 0x40) dy -= 1;
    if (b1 & 0x20) dy += 9;   if (b1 & 0x10) dy -= 9;
    if (b2 & 0x01) dx += 3;   if (b2 & 0x02) dx -= 3;
    if (b2 & 0x04) dx += 27;  if (b2 & 0x08) dx -= 27;
    if (b2 & 0x80) dy += 3;   if (b2 & 0x40) dy -= 3;
    if (b2 & 0x20) dy += 27;  if (b2 & 0x10) dy -= 27;
    if (b3 & 0x04) dx += 81;  if (b3 & 0x08) dx -= 81;
    if (b3 & 0x20) dy += 81;  if (b3 & 0x10) dy -= 81;

    const isEnd = (b3 & 0xF3) === 0xF3;
    if (isEnd) { stitches.push({ x, y, type: END }); break; }
    const isColor = (b3 & 0xC3) === 0xC3;
    const isJump = !!(b3 & 0x80);
    x += dx; y += dy;
    stitches.push({ x, y, type: isColor ? COLOR : (isJump ? JUMP : STITCH) });
  }
  return stitches;
}

function decodeDst(bytes) {
  const header = parseDstHeader(bytes);
  const stitches = decodeDstBody(bytes);
  let minx = 0, maxx = 0, miny = 0, maxy = 0;
  for (const s of stitches) {
    if (s.type === END) continue;
    minx = Math.min(minx, s.x); maxx = Math.max(maxx, s.x);
    miny = Math.min(miny, s.y); maxy = Math.max(maxy, s.y);
  }
  return { header, stitches, bbox: { minx, maxx, miny, maxy } };
}

function mod3(n) { return ((n % 3) + 3) % 3; }

function decomposeDelta(d) {
  if (d < -121 || d > 121) throw new Error('delta hors plage (-121..121): ' + d);
  const weights = [1, 3, 9, 27, 81];
  const signs = {};
  let r = d;
  for (const w of weights) {
    const m = mod3(r);
    if (m === 0) { signs[w] = 0; r = r / 3; }
    else if (m === 1) { signs[w] = 1; r = (r - 1) / 3; }
    else { signs[w] = -1; r = (r + 1) / 3; }
  }
  if (r !== 0) throw new Error('décomposition impossible pour delta=' + d);
  return signs;
}

function encodeMove(dx, dy, type) {
  const sx = decomposeDelta(dx), sy = decomposeDelta(dy);
  let b1 = 0, b2 = 0, b3 = 0x03;
  if (sx[1] === 1) b1 |= 0x01; if (sx[1] === -1) b1 |= 0x02;
  if (sx[9] === 1) b1 |= 0x04; if (sx[9] === -1) b1 |= 0x08;
  if (sy[1] === 1) b1 |= 0x80; if (sy[1] === -1) b1 |= 0x40;
  if (sy[9] === 1) b1 |= 0x20; if (sy[9] === -1) b1 |= 0x10;
  if (sx[3] === 1) b2 |= 0x01; if (sx[3] === -1) b2 |= 0x02;
  if (sx[27] === 1) b2 |= 0x04; if (sx[27] === -1) b2 |= 0x08;
  if (sy[3] === 1) b2 |= 0x80; if (sy[3] === -1) b2 |= 0x40;
  if (sy[27] === 1) b2 |= 0x20; if (sy[27] === -1) b2 |= 0x10;
  if (sx[81] === 1) b3 |= 0x04; if (sx[81] === -1) b3 |= 0x08;
  if (sy[81] === 1) b3 |= 0x20; if (sy[81] === -1) b3 |= 0x10;
  if (type === JUMP) b3 |= 0x80;
  if (type === COLOR) b3 |= 0xC0;
  return [b1, b2, b3];
}

function padNum(n, width) { return String(Math.round(Math.abs(n))).padStart(width, ' ').slice(-width); }
function padSigned(n, width) {
  const sign = n < 0 ? '-' : '+';
  return sign + String(Math.round(Math.abs(n))).padStart(width, ' ').slice(-width);
}

function buildDstHeader({ name, stitchCount, colorCount, plusX, minusX, plusY, minusY, ax = 0, ay = 0, mx = 0, my = 0 }) {
  const enc = new TextEncoder();
  let s = '';
  s += 'LA:' + (name || '').substring(0, 16).padEnd(16, ' ') + '\r';
  s += 'ST:' + padNum(stitchCount, 7) + '\r';
  s += 'CO:' + padNum(colorCount, 3) + '\r';
  s += '+X:' + padNum(plusX, 5) + '\r';
  s += '-X:' + padNum(minusX, 5) + '\r';
  s += '+Y:' + padNum(plusY, 5) + '\r';
  s += '-Y:' + padNum(minusY, 5) + '\r';
  s += 'AX:' + padSigned(ax, 5) + '\r';
  s += 'AY:' + padSigned(ay, 5) + '\r';
  s += 'MX:' + padSigned(mx, 5) + '\r';
  s += 'MY:' + padSigned(my, 5) + '\r';
  s += 'PD:******\r';
  const bytes = new Uint8Array(512);
  const head = enc.encode(s);
  bytes.set(head, 0);
  bytes[head.length] = 0x1a;
  for (let i = head.length + 1; i < 512; i++) bytes[i] = 0x20;
  return bytes;
}

function splitLongJump(dx, dy) {
  const steps = [];
  let rx = dx, ry = dy;
  while (rx !== 0 || ry !== 0) {
    const stepx = Math.max(-121, Math.min(121, rx));
    const stepy = Math.max(-121, Math.min(121, ry));
    steps.push([stepx, stepy]);
    rx -= stepx; ry -= stepy;
  }
  return steps;
}

function encodeDst(records, meta) {
  const bytesOut = [];
  let x = 0, y = 0, colorCount = 0, stitchCount = 0;
  for (const r of records) {
    const dx = r.x - x, dy = r.y - y;
    if (r.type === COLOR) colorCount++;
    if (Math.abs(dx) > 121 || Math.abs(dy) > 121) {
      const steps = splitLongJump(dx, dy);
      for (let i = 0; i < steps.length; i++) {
        const [sx, sy] = steps[i];
        const t = (i === steps.length - 1) ? r.type : JUMP;
        bytesOut.push(...encodeMove(sx, sy, t));
        stitchCount++;
      }
    } else {
      bytesOut.push(...encodeMove(dx, dy, r.type));
      stitchCount++;
    }
    x = r.x; y = r.y;
  }
  bytesOut.push(0x00, 0x00, 0xF3);

  let minx = 0, maxx = 0, miny = 0, maxy = 0;
  for (const r of records) {
    minx = Math.min(minx, r.x); maxx = Math.max(maxx, r.x);
    miny = Math.min(miny, r.y); maxy = Math.max(maxy, r.y);
  }
  const last = records.length ? records[records.length - 1] : { x: 0, y: 0 };
  const header = buildDstHeader({
    name: meta.name || 'MONTAGE', stitchCount, colorCount,
    plusX: maxx, minusX: -minx, plusY: maxy, minusY: -miny,
    ax: last.x, ay: last.y, mx: last.x, my: last.y,
  });
  const out = new Uint8Array(header.length + bytesOut.length + 1);
  out.set(header, 0);
  out.set(bytesOut, header.length);
  out[out.length - 1] = 0x1a;
  return out;
}

/* ============================================================================
   2) LECTEUR PXF — métadonnées + aperçu uniquement (Tajima Pulse/DG16).
   La géométrie des points réside dans un bloc chiffré/propriétaire non
   exploitable (entropie ~8 bits/octet mesurée) : lecture seule, jamais de
   points de piqûre utilisables. Nécessite JSZip (chargé séparément par
   chaque module qui l'utilise).
============================================================================ */
function readPxfDirectory(bytes) {
  const knownNames = ['COPYRIGHT.1', 'HISTORY.1', 'ICON.1', 'DESIGNINFO.ZIP.1', 'MACHINE.ZIP.1', 'ENC.INDEX.1'];
  const text = new TextDecoder('latin1').decode(bytes);
  let tableStart = -1;
  for (const nm of knownNames) {
    const idx = text.indexOf(nm);
    if (idx >= 0) { tableStart = idx - 2; break; }
  }
  if (tableStart < 0) throw new Error('Table de répertoire PXF introuvable (fichier non reconnu)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = {};
  let pos = tableStart;
  while (pos < bytes.length - 4) {
    const nameLen = view.getUint16(pos, true);
    if (nameLen === 0 || nameLen > 200) break;
    const nameBytes = bytes.slice(pos + 2, pos + 2 + nameLen - 1);
    const name = new TextDecoder('ascii').decode(nameBytes);
    const p2 = pos + 2 + nameLen;
    if (p2 + 8 > bytes.length) break;
    entries[name] = { offset: view.getUint32(p2, true), size: view.getUint32(p2 + 4, true) };
    pos = p2 + 8;
  }
  return entries;
}

async function parsePxf(bytes) {
  const entries = readPxfDirectory(bytes);
  const result = { entries, width_mm: null, height_mm: null, stitchCount: null, colorChanges: null, iconBytes: null };
  if (entries['DESIGNINFO.ZIP.1']) {
    const { offset, size } = entries['DESIGNINFO.ZIP.1'];
    const zip = await JSZip.loadAsync(bytes.slice(offset, offset + size));
    const infoFile = zip.file('info.xml');
    if (infoFile) {
      const xml = await infoFile.async('string');
      const dims = xml.match(/<dimensions left="(-?\d+)" top="(-?\d+)" right="(-?\d+)" bottom="(-?\d+)"/);
      const stitches = xml.match(/<stitches count="(\d+)" colourchanges="(\d+)"/);
      if (dims) {
        const w = parseInt(dims[3], 10) - parseInt(dims[1], 10);
        const h = parseInt(dims[4], 10) - parseInt(dims[2], 10);
        result.width_mm = Math.round(w * 0.05 * 10) / 10;
        result.height_mm = Math.round(h * 0.05 * 10) / 10;
      }
      if (stitches) { result.stitchCount = parseInt(stitches[1], 10); result.colorChanges = parseInt(stitches[2], 10); }
    }
  }
  if (entries['ICON.1']) {
    const { offset, size } = entries['ICON.1'];
    result.iconBytes = bytes.slice(offset, offset + size);
  }
  return result;
}

/* ============================================================================
   3) LECTEUR PES/PEC — décodage complet des piqûres.
   Validé sur 2 fichiers réels : le bounding box recalculé point par point
   correspond (à 1 unité de 0.1mm près, arrondi normal) à la fois à celui
   déclaré dans le sous-en-tête PEC ET, pour Base1_PES.PES, à celui du
   fichier Base1.DST du même dessin — donc décodage croisé-vérifié, comme
   pour le DST. Cible les PES modernes (#PES0100, bloc PEC "LA:" classique
   avec en-tête 512 octets) ; les très anciennes variantes de PES peuvent
   différer et ne sont pas garanties.
============================================================================ */
function decodePes(bytes) {
  const text = new TextDecoder('latin1').decode(bytes);
  const laIdx = text.indexOf('LA:');
  if (laIdx < 0) throw new Error('Bloc PEC introuvable dans ce fichier PES');
  const nameMatch = text.slice(laIdx, laIdx + 20).match(/LA:(.{0,16})/);
  const name = nameMatch ? nameMatch[1].trim() : '';

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const subStart = laIdx + 512;
  const thumbOffsetRel = view.getUint16(subStart + 2, true);
  const stitchStart = subStart + 20;
  const stitchEnd = subStart + thumbOffsetRel;
  if (thumbOffsetRel <= 20 || stitchEnd > bytes.length) throw new Error('Structure PEC inattendue (offset vignette incohérent)');

  const stitches = [];
  let x = 0, y = 0, minx = 0, maxx = 0, miny = 0, maxy = 0;
  let i = stitchStart;
  while (i < stitchEnd) {
    const v1 = bytes[i]; i++;
    if (v1 === 0xff) { stitches.push({ x, y, type: END }); break; }
    if (v1 === 0xfe) {
      const v2 = bytes[i]; i++;
      if (v2 === 0xb0) { i += 1; stitches.push({ x, y, type: COLOR }); continue; }
      break; // commande spéciale non gérée : on arrête proprement le décodage ici
    }
    let val1, ctrl1 = 0;
    if (v1 & 0x80) {
      const v1b = bytes[i]; i++;
      ctrl1 = (v1 >> 4) & 0x7;
      val1 = ((v1 & 0x0f) << 8) | v1b;
      if (val1 & 0x800) val1 -= 0x1000;
    } else {
      val1 = (v1 & 0x40) ? v1 - 0x80 : v1;
    }
    const v2 = bytes[i]; i++;
    let val2, ctrl2 = 0;
    if (v2 & 0x80) {
      const v2b = bytes[i]; i++;
      ctrl2 = (v2 >> 4) & 0x7;
      val2 = ((v2 & 0x0f) << 8) | v2b;
      if (val2 & 0x800) val2 -= 0x1000;
    } else {
      val2 = (v2 & 0x40) ? v2 - 0x80 : v2;
    }
    // NOTE ORIENTATION : le sens des axes X/Y encodé en PEC est l'exact
    // inverse (rotation 180°) de la convention Tajima DST utilisée partout
    // ailleurs dans l'outil. Vérifié par comparaison visuelle directe avec
    // Base1.DST (même dessin) : sans cette correction, casaque et toque
    // apparaissent tête-bêche. On compense en soustrayant au lieu d'ajouter.
    x -= val1; y -= val2;
    minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
    const isJump = ctrl1 === 1 || ctrl1 === 2 || ctrl2 === 1 || ctrl2 === 2; // jump ou trim -> pas de piqûre réelle
    stitches.push({ x, y, type: isJump ? JUMP : STITCH });
  }
  if (!stitches.length || stitches[stitches.length - 1].type !== END) stitches.push({ x, y, type: END });
  if (maxx - minx > 50000 || maxy - miny > 50000) throw new Error('Dimensions décodées invraisemblables — structure PES non reconnue');

  return { header: { name, stitchCount: stitches.length - 1, colorCount: stitches.filter(s => s.type === COLOR).length }, stitches, bbox: { minx, maxx, miny, maxy } };
}

// Décodeur VP3 (Husqvarna Viking / Pfaff). Format non documenté
// officiellement — ce lecteur est un portage fidèle de l'implémentation de
// référence Vp3Reader.py du projet open-source pyembroidery
// (EmbroidePy/pyembroidery), vérifié point par point (0 écart sur 37 246
// piqûres réelles) contre cette référence avant intégration. Unité de
// coordonnées : 0.1 mm, identique à DST/PES, donc aucune conversion
// supplémentaire nécessaire en aval. Un "coupe-fil" VP3 (commande dédiée
// dans ce format, sans déplacement) est reconstruit ici comme 3 sauts
// consécutifs sur place, pour rester compatible avec la convention Tajima
// déjà utilisée partout ailleurs (détection, bascule saut/coupe-fil,
// marqueurs...).
function decodeVp3(bytes) {
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function u8() { const v = view.getUint8(pos); pos += 1; return v; }
  function i8() { const v = view.getInt8(pos); pos += 1; return v; }
  function u16be() { const v = view.getUint16(pos, false); pos += 2; return v; }
  function i32be() { const v = view.getInt32(pos, false); pos += 4; return v; }
  function u32be() { const v = view.getUint32(pos, false); pos += 4; return v; }
  function skip(n) { pos += n; }
  function skipVp3String() { const len = u16be(); skip(len); }
  function readVp3String8() {
    const len = u16be();
    const strBytes = bytes.subarray(pos, pos + len);
    pos += len;
    try { return new TextDecoder('utf-8').decode(strBytes); } catch (e) { return ''; }
  }
  function readSignedBytes(n) {
    const arr = new Int8Array(n);
    for (let k = 0; k < n; k++) arr[k] = i8();
    return arr;
  }
  function signed16From2(b0, b1) {
    const v = ((b0 & 0xFF) << 8) | (b1 & 0xFF);
    return v > 0x7FFF ? v - 0x10000 : v;
  }

  skip(6); // magic "%vsm%\0"
  skipVp3String();
  skip(7);
  skipVp3String();
  skip(32);
  const centerX = i32be() / 100;
  const centerY = -(i32be() / 100);
  skip(27);
  skipVp3String();
  skip(24);
  skipVp3String();
  const countColors = u16be();
  if (!(countColors >= 0 && countColors < 5000)) throw new Error('Structure VP3 non reconnue');

  const stitches = [];
  const threads = [];
  let curX = 0, curY = 0;

  function pushAbs(x, y, type) { stitches.push({ x, y, type }); curX = x; curY = y; }
  function pushRel(dx, dy, type) { curX += dx; curY += dy; stitches.push({ x: curX, y: curY, type }); }
  function pushZero(type) { stitches.push({ x: curX, y: curY, type }); }
  function pushTrimAsJumps() { for (let k = 0; k < 3; k++) stitches.push({ x: curX, y: curY, type: JUMP }); }

  function readThread() {
    const colors = u8();
    const transition = u8();
    let color = 0;
    for (let m = 0; m < colors; m++) {
      color = (u8() << 16) | (u8() << 8) | u8();
      u8(); // parts
      u16be(); // colorLength
    }
    u8(); // threadType
    u8(); // weight
    const catalogNumber = readVp3String8();
    const description = readVp3String8();
    const brand = readVp3String8();
    return { color, catalogNumber, description, brand };
  }

  for (let ci = 0; ci < countColors; ci++) {
    skip(3); // bytescheck1
    const distanceToNextBlock = u32be();
    const blockEndPosition = pos + distanceToNextBlock;

    const startX = i32be() / 100;
    const startY = -(i32be() / 100);
    const absX = startX + centerX;
    const absY = startY + centerY;
    if (absX !== 0 && absY !== 0) pushAbs(Math.round(absX), Math.round(absY), JUMP);

    threads.push(readThread());
    skip(15);
    skip(3); // bytescheck2
    const stitchByteLength = blockEndPosition - pos;
    const stitchBytes = readSignedBytes(stitchByteLength);

    let i = 0;
    while (i < stitchBytes.length - 1) {
      let x = stitchBytes[i], y = stitchBytes[i + 1];
      i += 2;
      if ((x & 0xFF) !== 0x80) { pushRel(x, y, STITCH); continue; }
      if (y === 0x01) {
        const nx = signed16From2(stitchBytes[i], stitchBytes[i + 1]); i += 2;
        const ny = signed16From2(stitchBytes[i], stitchBytes[i + 1]); i += 2;
        pushRel(nx, ny, STITCH);
        i += 2; // ignore le marqueur de fin 0x80 0x02
      } else if (y === 0x03) {
        pushTrimAsJumps();
      }
      // y === 0x02 : marqueur sans effet, déjà consommé par le cas 0x01.
    }
    if (ci + 1 < countColors) pushZero(COLOR);
  }
  stitches.push({ x: curX, y: curY, type: END });

  let minx = 0, maxx = 0, miny = 0, maxy = 0;
  for (const s of stitches) {
    if (s.type === END) continue;
    minx = Math.min(minx, s.x); maxx = Math.max(maxx, s.x);
    miny = Math.min(miny, s.y); maxy = Math.max(maxy, s.y);
  }
  return {
    header: { name: '', stitchCount: stitches.filter(s => s.type === STITCH).length, colorCount: threads.length },
    stitches, bbox: { minx, maxx, miny, maxy }, threads,
  };
}

// Extrait la table de couleurs déclarée dans l'en-tête PES (hors bloc PEC),
// dans l'ordre d'apparition = ordre d'utilisation des fils. Deux formats
// rencontrés en pratique : soit des chaînes lisibles "Rxx Gxx Bxx", soit un
// triplet RVB brut juste avant un marqueur fixe 00 0A 00 00 00 suivi du nom
// du fil. On tente les deux, dans cet ordre.
function extractPesColorTable(bytes, headerEnd) {
  const text = new TextDecoder('latin1').decode(bytes.slice(0, headerEnd));
  const colors = [];
  const reA = /R(\d{1,3}) G(\d{1,3}) B(\d{1,3})/g;
  let m;
  while ((m = reA.exec(text))) colors.push({ r: +m[1], g: +m[2], b: +m[3] });
  if (colors.length) return colors;

  const marker = [0x00, 0x0a, 0x00, 0x00, 0x00];
  for (let i = 3; i < headerEnd - 8; i++) {
    let ok = true;
    for (let k = 0; k < 5; k++) if (bytes[i + k] !== marker[k]) { ok = false; break; }
    if (!ok) continue;
    // Rejette les faux positifs : le marqueur doit être immédiatement suivi
    // d'un octet de longueur plausible (1-40) puis d'autant de caractères
    // ASCII imprimables (le nom du fil).
    const nameLen = bytes[i + 5];
    if (nameLen < 1 || nameLen > 40 || i + 6 + nameLen > headerEnd) continue;
    const nameBytes = bytes.slice(i + 6, i + 6 + nameLen);
    let printable = true;
    for (const b of nameBytes) if (b < 32 || b > 126) { printable = false; break; }
    if (!printable) continue;
    colors.push({ r: bytes[i - 3], g: bytes[i - 2], b: bytes[i - 1] });
  }
  return colors;
}

function sniffType(bytes) {
  const head = new TextDecoder('ascii').decode(bytes.slice(0, 8));
  if (head.startsWith('LA:')) return 'dst';
  if (head.startsWith('PMLPXF01')) return 'pxf';
  if (head.startsWith('#PES')) return 'pes';
  return null;
}

/* ============================================================================
   4) Palette France Galop -> numéro de bobine (fournie par l'utilisateur).
   Les codes hex sont une approximation visuelle de chaque couleur nommée (le
   tableau source ne donne que nom + n° de bobine, pas de RVB).
============================================================================ */
const FRANCE_GALOP_COLORS = [
  { nom: 'Blanc', bobine: '1801', hex: '#FFFFFF' },
  { nom: 'Gris', bobine: '1918', hex: '#9E9E9E' },
  { nom: 'Rose', bobine: '1921', hex: '#F4A6C6' },
  { nom: 'Rouge', bobine: '1839', hex: '#D2232A' },
  { nom: 'Grenat', bobine: '1635', hex: '#6D1B2A' },
  { nom: 'Orange', bobine: '1778', hex: '#F58220' },
  { nom: 'Jaune', bobine: '1924', hex: '#FFD500' },
  { nom: 'Vert', bobine: '1651', hex: '#3C8C3C' },
  { nom: 'Vert Clair', bobine: '1748', hex: '#8DC63F' },
  { nom: 'Gros Vert', bobine: '1970', hex: '#00693E' },
  { nom: 'Bleu (Roi)', bobine: '1842', hex: '#1E4FA3' },
  { nom: 'Bleu Clair', bobine: '1874', hex: '#5DADE2' },
  { nom: 'Gros Bleu', bobine: '1967', hex: '#0B2D5C' },
  { nom: 'Mauve', bobine: '1711', hex: '#B57EDC' },
  { nom: 'Violet', bobine: '1922', hex: '#6A1B9A' },
  { nom: 'Beige', bobine: '1855', hex: '#D8C39A' },
  { nom: 'Marron', bobine: '1758', hex: '#6B4226' },
  { nom: 'Noir', bobine: '1800', hex: '#1A1A1A' },
  { nom: 'Or', bobine: '1670', hex: '#C9A227' },
];

// Associe une couleur RVB à la référence France Galop la plus proche (limite
// de tolérance raisonnable) ; sinon conserve la teinte exacte en "libre"
// pour ne pas fausser la couleur d'origine avec un mauvais rapprochement.
function closestFranceGalopColorId(r, g, b) {
  let best = null, bestDist = Infinity;
  for (const c of FRANCE_GALOP_COLORS) {
    const hex = c.hex.replace('#', '');
    const cr = parseInt(hex.slice(0, 2), 16), cg = parseInt(hex.slice(2, 4), 16), cb = parseInt(hex.slice(4, 6), 16);
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  const hexOriginal = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  if (best && Math.sqrt(bestDist) < 35) return { colorId: best.bobine, note: hexOriginal + ' → rapproché de ' + best.nom + ' (bobine ' + best.bobine + ')' };
  return { colorId: 'custom:' + hexOriginal, note: hexOriginal + ' (aucune correspondance proche dans la palette France Galop)' };
}

/* ============================================================================
   5) Dessin d'un tracé de piqûres sur un canvas (vignettes, aperçus).
============================================================================ */
function isNearWhiteColor(hex) {
  if (!hex) return false;
  const h = hex.replace('#', '');
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  return r >= 245 && g >= 245 && b >= 245;
}

function drawStitchPath(ctx, w, h, stitches, bbox, strokeColor) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = isNearWhiteColor(strokeColor) ? '#000000' : '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const bw = bbox.maxx - bbox.minx || 1, bh = bbox.maxy - bbox.miny || 1;
  const pad = 3;
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const ox = pad + (w - pad * 2 - bw * scale) / 2 - bbox.minx * scale;
  const oy = pad + (h - pad * 2 - bh * scale) / 2 - bbox.miny * scale;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let started = false;
  for (const s of stitches) {
    if (s.type === END) break;
    const px = ox + s.x * scale, py = h - (oy + s.y * scale);
    if (s.type === JUMP) { ctx.moveTo(px, py); started = true; continue; }
    if (!started) { ctx.moveTo(px, py); started = true; } else { ctx.lineTo(px, py); }
  }
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
}
