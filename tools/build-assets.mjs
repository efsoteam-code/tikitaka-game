// Builds the compact files in public/assets from the Quaternius CC0 originals.
// Usage: node tools/build-assets.mjs <source dir> <output dir> <comma separated clip names>
// Needs: npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions sharp
// <source dir> must hold flat/ (Universal Base Characters glTF files) and animationlibrary/ (UAL1_Standard.glb, UAL2_Standard.glb).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, resample, dedup } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'node:fs';
const SRC = process.argv[2], OUT = process.argv[3], KEEP = (process.argv[4] || '').split(',').filter(Boolean);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(OUT, { recursive: true });

// --- body: drop normal/roughness maps, shrink textures
{
  const doc = await io.read(`${SRC}/flat/Superhero_Male_FullBody.gltf`);
  for (const m of doc.getRoot().listMaterials()) { m.setNormalTexture(null); m.setMetallicRoughnessTexture(null); m.setOcclusionTexture(null); m.setRoughnessFactor(0.75); m.setMetallicFactor(0); }
  await doc.transform(prune(), dedup());
  for (const t of doc.getRoot().listTextures()) {
    const big = /Superhero/.test(t.getURI() || t.getName());
    const size = big ? 1024 : 256;
    const img = sharp(Buffer.from(t.getImage())).resize(size, size, { fit: 'inside' });
    const hasAlpha = (await sharp(Buffer.from(t.getImage())).metadata()).hasAlpha;
    if (hasAlpha) { t.setImage(new Uint8Array(await img.png().toBuffer())); t.setMimeType('image/png'); }
    else { t.setImage(new Uint8Array(await img.jpeg({ quality: 86 }).toBuffer())); t.setMimeType('image/jpeg'); }
  }
  await doc.transform(prune());
  await io.write(`${OUT}/player.glb`, doc);
}
// --- hair: geometry only (coloured in the game)
for (const h of ['Hair_Buzzed', 'Hair_SimpleParted']) {
  const doc = await io.read(`${SRC}/flat/${h}.gltf`);
  for (const m of doc.getRoot().listMaterials()) { m.setNormalTexture(null); m.setBaseColorTexture(null); }
  await doc.transform(prune());
  await io.write(`${OUT}/${h.toLowerCase()}.glb`, doc);
}
// --- animations: chosen clips only, no mesh, no finger tracks
const FINGER = /^(index|middle|pinky|ring|thumb)_/;
let n = 0;
for (const lib of ['UAL1_Standard', 'UAL2_Standard']) {
  const doc = await io.read(`${SRC}/animationlibrary/${lib}.glb`);
  if (!KEEP.length) { console.log(lib, doc.getRoot().listAnimations().map((a) => a.getName()).join(',')); }
  for (const a of doc.getRoot().listAnimations()) {
    if (KEEP.length && !KEEP.includes(a.getName())) { for (const c of a.listChannels()) c.dispose(); for (const sm of a.listSamplers()) sm.dispose(); a.dispose(); continue; }
    for (const c of a.listChannels()) if (FINGER.test(c.getTargetNode()?.getName() || '') || c.getTargetPath() === 'scale') { c.getSampler()?.dispose(); c.dispose(); }
  }
  for (const node of doc.getRoot().listNodes()) { node.setMesh(null); node.setSkin(null); }
  for (const s of doc.getRoot().listSkins()) s.dispose();
  await doc.transform(prune({ keepLeaves: true }), resample({ tolerance: 0.0005 }), prune({ keepLeaves: true }));
  if (doc.getRoot().listAnimations().length) { n++; await io.write(`${OUT}/anims${n}.glb`, doc); }
}
for (const f of fs.readdirSync(OUT)) console.log(f, (fs.statSync(`${OUT}/${f}`).size / 1024).toFixed(0) + ' KB');
