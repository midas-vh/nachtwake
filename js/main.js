// NACHTWAKE - horror in de Notre-Dame. Three.js r160 + three-mesh-bvh voor botsingen.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { Sfx } from './audio.js';
import * as TX from './textures.js';
import { U, stoneMaterial, glassMaterial, floorMaterial, Mirror, HorrorShader } from './world.js';
import { makeEntity, setOpacity } from './entity.js';

const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug'), LOW = Q.has('low');
const B = (x, y, z = 0) => new THREE.Vector3(x, z, -y);       // Blender-coordinaten -> three
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const V = () => new THREE.Vector3();

// ------------------------------------------------------------ renderer, scene, camera
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, LOW ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = !LOW;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010102);
scene.fog = new THREE.FogExp2(0x030406, 0.04);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const hemi = new THREE.HemisphereLight(0x35455f, 0x080605, 0.05); scene.add(hemi);
const flashlight = new THREE.SpotLight(0xffeedd, 0, 48, 0.40, 0.6, 1.5);
flashlight.castShadow = !LOW;
flashlight.shadow.mapSize.set(1024, 1024);
flashlight.shadow.camera.near = 0.3;
flashlight.shadow.bias = -0.0005; flashlight.shadow.normalBias = 0.03;
flashlight.position.set(0.16, -0.16, 0.05);
flashlight.target.position.set(0.02, -0.03, -1);
camera.add(flashlight); camera.add(flashlight.target);
const bolt = new THREE.DirectionalLight(0xa9c0ff, 0); bolt.position.set(-30, 40, 12); scene.add(bolt);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.4, 0.72);
composer.addPass(bloom);
const fx = new ShaderPass(HorrorShader); composer.addPass(fx);
composer.addPass(new OutputPass());
const mirror = new Mirror(0.5);

function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  const pr = renderer.getPixelRatio(); mirror.resize(innerWidth * pr, innerHeight * pr);
}
addEventListener('resize', resize); resize();

// ------------------------------------------------------------ toestand
const sfx = new Sfx();
const S = {
  running: false, paused: false, dead: false, ended: false, time: 0,
  relics: 0, unlocked: false, doorOpen: 0, stage: 0,
  fired: {}, fear: 0, shake: 0, flashOverlay: 0, lightning: null, nextBolt: rand(9, 16),
  nextScare: rand(30, 50), hb: 0, subtitleT: 0,
};
const P = {   // speler: pos = middelpunt van de bovenste bol van de capsule
  pos: B(0, -13.5, 1.45), vel: V(), onGround: false, yaw: 0, pitch: 0.06,
  radius: 0.35, segEnd: new THREE.Vector3(0, -1.1, 0), stamina: 1, battery: 1, light: true,
  bob: 0, stepPhase: 0, moving: 0, noise: 0,
};
const keys = {};
let collider = null, bvh = null, floorMesh = null, root = null;
const chandeliers = [], racks = [], pickups = [], drips = [];
let entity = null, door = null, faceCv = null;

// ------------------------------------------------------------ laden
const loader = new GLTFLoader();
loader.load('assets/kathedraal.glb', (gltf) => {
  $('loadtxt').textContent = 'Steen, water en glas voorbereiden…';
  setTimeout(() => { try { buildWorld(gltf); } catch (e) { $('loadtxt').textContent = 'Fout: ' + e.message; throw e; } }, 30);
}, (x) => { if (x.total) $('loadbar').style.width = (x.loaded / x.total * 90) + '%'; },
(e) => { $('loadtxt').textContent = 'Kon de kathedraal niet laden (start de server met start-server.bat).'; console.error(e); });

function buildWorld(gltf) {
  root = gltf.scene; scene.add(root);
  const stone = TX.stoneTextures(512), pud = TX.puddleTexture(512);
  const gClere = TX.stainedGlassTexture([[150, 168, 205], [105, 125, 190], [170, 166, 156], [50, 72, 170], [165, 105, 80]], 256, 46, 3);
  const gApse = TX.stainedGlassTexture([[20, 40, 160], [30, 70, 220], [190, 22, 15], [230, 160, 30], [30, 120, 60], [140, 40, 150]], 256, 40, 9);
  const gSide = TX.stainedGlassTexture([[160, 150, 130], [90, 110, 160], [60, 80, 150], [150, 60, 50]], 256, 36, 21);
  const M = {
    ND_Steen: stoneMaterial(stone, { wetBase: 0.12 }),
    ND_Steen_Gewelf: stoneMaterial(stone, { tint: 0xe4e0d6, wetBase: 0.04 }),
    ND_Steen_Rib: stoneMaterial(stone, { tint: 0xd8d2c6, wetBase: 0.06 }),
    ND_Marmer_Wit: stoneMaterial(stone, { tint: 0xf2f0ea, wetBase: 0.35, scale: 0.9, bright: 2.0 }),
    ND_Vloer_Dambord: floorMaterial(stone, pud, mirror),
    ND_Glas_Lichtbeuk: glassMaterial(gClere, 1.0),
    ND_Glas_Apsis: glassMaterial(gApse, 1.5),
    ND_Glas_Oculus: glassMaterial(gSide, 0.35, 1.4),
    ND_Glas_Zijbeuk: glassMaterial(gSide, 0.7),
    ND_Glas_Roos: glassMaterial(gApse, 1.3, 0.5),
    ND_Goud: new THREE.MeshStandardMaterial({ color: 0xa87a32, metalness: 1, roughness: 0.32, envMapIntensity: 0.5 }),
    ND_Brons: new THREE.MeshStandardMaterial({ color: 0x3a2814, metalness: 1, roughness: 0.4, envMapIntensity: 0.4 }),
    ND_Kaarslamp: new THREE.MeshStandardMaterial({ color: 0x140d07, roughness: 0.9 }),
    ND_Kaars: new THREE.MeshStandardMaterial({ color: 0x9d968a, roughness: 0.7, envMapIntensity: 0.05 }),
    ND_Fluweel_Rood: new THREE.MeshStandardMaterial({ color: 0x3a0306, roughness: 0.8, envMapIntensity: 0.05 }),
    ND_Hout_Donker: new THREE.MeshStandardMaterial({ color: 0x120804, roughness: 0.6, envMapIntensity: 0.05 }),
  };
  const geos = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const nm = o.material.name;
    if (M[nm]) o.material = M[nm]; else o.material.envMapIntensity = 0.08;
    o.castShadow = o.receiveShadow = !LOW;
    if (o.name === 'ND_Vloer' || (o.parent && o.parent.name === 'ND_Vloer')) floorMesh = o;
    let a = o, chand = false;
    while (a) { if (a.name && a.name.startsWith('ND_Kroonluchter_')) { chand = true; break; } a = a.parent; }
    if (chand) return;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    geos.push(g.index ? g.toNonIndexed() : g);
  });
  root.traverse((o) => { if (o.name && /^ND_Kroonluchter_[LR]\d+$/.test(o.name)) chandeliers.push(o); });
  const merged = mergeGeometries(geos, false);
  bvh = merged.boundsTree = new MeshBVH(merged);
  collider = new THREE.Mesh(merged);

  buildProps(stone);
  faceCv = TX.faceCanvas(512);
  entity = makeEntity(TX.faceTexture(faceCv));
  entity.pos = V(); entity.state = 'hidden'; entity.alpha = 0; entity.path = []; entity.burn = 0; entity.cool = 25;
  entity.seenT = 0; entity.lostT = 0; entity.lifeT = 0; entity.glitchT = 1; entity.breathT = 3;
  setOpacity(entity, 0); scene.add(entity.group);

  // shaders alvast compileren, zodat de eerste frames niet haperen
  placeCamera(); renderer.compile(scene, camera);
  $('loadbar').style.width = '100%';
  $('loading').classList.add('hidden');
  $('controls').classList.remove('hidden');
  $('start').classList.remove('hidden');
  window.G = { S, P, entity, B, trigger, U, mirror, renderer, flashlight, bloom, fx, scene, bvh, root, keys, moveVel, setView: (y, p) => { P.yaw = y; P.pitch = p; }, tp: (x, y, z = 1.45) => P.pos.copy(B(x, y, z)), lightningStrike, spawn: spawnEntity };
  requestAnimationFrame(loop);
  if (DEBUG) console.log('NACHTWAKE geladen', { tris: merged.attributes.position.count / 3, chandeliers: chandeliers.length });
}

// ------------------------------------------------------------ rekwisieten
const glowTex = TX.glowTexture();
function flameSprite(color = 0xffa955, size = 0.09) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size); return s;
}
function buildProps(stone) {
  const iron = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0.7, roughness: 0.5, envMapIntensity: 0.3 });
  const wax = new THREE.MeshStandardMaterial({ color: 0xcfc6b2, roughness: 0.6, emissive: 0x2a1505, emissiveIntensity: 1 });
  const stoneM = stoneMaterial(stone, { wetBase: 0.2 });
  // kaarsenrekken met flakkerend licht
  const rackSpots = [[3.8, -9.5, 0, 0.3], [-9.3, -6.0, 0, 1.2], [3.6, 33.0, 0.72, -0.4], [-3.6, 33.0, 0.72, 0.4],
    [19.5, 37.2, 0, 2.6], [-9.3, 70.5, 0, 1.6], [6.5, 92.5, 0, -2.2]];
  for (const [x, y, z, ry] of rackSpots) {
    const g = new THREE.Group(); g.position.copy(B(x, y, z)); g.rotation.y = ry;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.5), iron); frame.position.y = 0.95; g.add(frame);
    const frame2 = frame.clone(); frame2.position.set(0, 1.18, -0.12); frame2.scale.set(1, 1, 0.5); g.add(frame2);
    for (const lx of [-0.7, 0.7]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.95, 0.04), iron); leg.position.set(lx, 0.475, 0); g.add(leg); }
    const flames = [];
    for (let row = 0; row < 2; row++) for (let i = 0; i < 9; i++) {
      if (Math.random() < 0.25) continue;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.05 + Math.random() * 0.12, 8), wax);
      const h = c.geometry.parameters.height;
      c.position.set(-0.64 + i * 0.16, (row ? 1.21 : 0.98) + h / 2, row ? -0.12 : 0.1); g.add(c);
      const f = flameSprite(); f.position.set(c.position.x, c.position.y + h / 2 + 0.035, c.position.z); f.userData.base = 0.07 + Math.random() * 0.04;
      g.add(f); flames.push(f);
    }
    const L = new THREE.PointLight(0xff9a45, 0, 16, 1.7); L.position.set(0, 1.5, 0.2); g.add(L);
    scene.add(g);
    racks.push({ g, L, flames, base: 5.5, on: 1, seed: Math.random() * 100 });
  }
  // relikwieën op sokkels
  const gold = new THREE.MeshStandardMaterial({ color: 0xc89a48, metalness: 1, roughness: 0.25, emissive: 0x3a2508, emissiveIntensity: 0.8, envMapIntensity: 0.8 });
  const relicSpots = [[-21.4, 39.8, 0], [15.5, 31.4, 0], [0, 95.2, 0], [-15.5, 48.0, 0], [-15.5, -14.9, 0]];
  for (const [x, y, z] of relicSpots) {
    const g = new THREE.Group(); g.position.copy(B(x, y, z));
    const ped = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.9, 0.55), stoneM); ped.position.y = 0.45; ped.castShadow = ped.receiveShadow = true; g.add(ped);
    const rel = new THREE.Group(); rel.position.y = 1.05; g.add(rel);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.16), gold); rel.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.13, 0.1, 4, 1), gold); roof.rotation.y = Math.PI / 4; roof.scale.set(1.4, 1, 0.85); roof.position.y = 0.13; rel.add(roof);
    const cv = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.1, 0.015), gold); cv.position.y = 0.24; rel.add(cv);
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.015), gold); ch.position.y = 0.26; rel.add(ch);
    const glow = flameSprite(0xd8a050, 0.9); glow.material.opacity = 0.35; glow.position.y = 0.05; rel.add(glow);
    scene.add(g);
    pickups.push({ type: 'relic', g, item: rel, pos: B(x, y, z + 1.05), taken: false });
  }
  // batterijen
  const batM = new THREE.MeshStandardMaterial({ color: 0x1d2a1d, roughness: 0.5, metalness: 0.4, emissive: 0x0a1a0a });
  for (const [x, y, z] of [[12.0, 41.5, 0], [9.3, 66.5, 0], [-9.3, 19.0, 0]]) {
    const g = new THREE.Group(); g.position.copy(B(x, y, z));
    const stool = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.45), stoneM); stool.position.y = 0.25; g.add(stool);
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 12), batM); bat.rotation.z = Math.PI / 2; bat.position.y = 0.54; g.add(bat);
    const glow = flameSprite(0x88ff88, 0.25); glow.material.opacity = 0.25; glow.position.y = 0.55; g.add(glow);
    scene.add(g);
    pickups.push({ type: 'battery', g, item: bat, pos: B(x, y, 0.55), taken: false });
  }
  // westportaal: twee deurvleugels, met daarachter stormlicht
  const wood = new THREE.MeshStandardMaterial({ color: 0x1a0f08, roughness: 0.7, envMapIntensity: 0.1 });
  door = new THREE.Group(); door.position.copy(B(0, -16.68, 0)); scene.add(door);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 6.2), new THREE.MeshBasicMaterial({ color: 0x8fa6d8, fog: false }));
  outside.position.set(0, 3.1, 0.14); outside.material.color.multiplyScalar(3); door.add(outside); outside.visible = false;
  door.leaves = [];
  for (const sx of [-1, 1]) {
    const hinge = new THREE.Group(); hinge.position.set(sx * 2.3, 0, 0); door.add(hinge);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.3, 6.2, 0.16), wood); leaf.position.set(-sx * 1.15, 3.1, 0); leaf.castShadow = leaf.receiveShadow = true; hinge.add(leaf);
    for (const hy of [1.0, 3.1, 5.2]) { const band = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.04), iron); band.position.set(-sx * 1.15, hy, -0.1); hinge.add(band); }
    door.leaves.push({ hinge, sx });
  }
  door.outside = outside;
  // druppelplekken (water dat door het dak lekt)
  const dropGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.12, 4);
  const dropMat = new THREE.MeshBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.6 });
  const ringGeo = new THREE.RingGeometry(0.06, 0.08, 24); ringGeo.rotateX(-Math.PI / 2);
  for (const [x, y] of [[1.5, -6], [-2.5, 6], [3.2, 15], [-9.5, 2], [11, 24], [0.5, 27], [-16, 40], [-2, 60], [9, 88], [-12, 56]]) {
    const drop = new THREE.Mesh(dropGeo, dropMat); drop.visible = false; scene.add(drop);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x9aaabb, transparent: true, opacity: 0, depthWrite: false }));
    ring.position.copy(B(x, y, 0.01)); scene.add(ring);
    drips.push({ at: B(x, y, 0), drop, ring, t: rand(0, 3), fallT: -1, ringT: -1 });
  }
  // stofdeeltjes rond de speler
  const N = 500, dp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {          // niet vlak voor de camera, anders worden het grote vlekken
    let x, y, z; do { x = (Math.random() - 0.5) * 12; y = (Math.random() - 0.5) * 6; z = (Math.random() - 0.5) * 12; } while (x * x + y * y + z * z < 4);
    dp[i * 3] = x; dp[i * 3 + 1] = y; dp[i * 3 + 2] = z;
  }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.025, map: glowTex, color: 0x6e665a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dust);
}
let dust = null;

// ------------------------------------------------------------ wegennet voor het wezen (Blender-coordinaten)
const NODES = {}, EDGES = {};
function node(id, x, y, z = 0) { NODES[id] = B(x, y, z); EDGES[id] = EDGES[id] || new Set(); }
function edge(a, b) { EDGES[a].add(b); EDGES[b].add(a); }
(function buildGraph() {
  const ny = [-14, -2.8, 8.4, 19.6, 30.8];
  ny.forEach((y, i) => node('n' + i, 0, y));
  node('c', 0, 39.8, 0.72);
  for (let i = 0; i < 4; i++) edge('n' + i, 'n' + (i + 1));
  edge('n4', 'c');
  for (const [s, sd] of [[-1, 'L'], [1, 'R']]) {
    ny.forEach((y, i) => {
      node(`i${sd}${i}`, s * 9.3, y); node(`o${sd}${i}`, s * 15.5, y);
      edge('n' + i, `i${sd}${i}`); edge(`i${sd}${i}`, `o${sd}${i}`);
      if (i) { edge(`i${sd}${i - 1}`, `i${sd}${i}`); edge(`o${sd}${i - 1}`, `o${sd}${i}`); }
    });
    node(`t${sd}1`, s * 12, 39.8); node(`t${sd}2`, s * 20.5, 39.8); edge('c', `t${sd}1`); edge(`t${sd}1`, `t${sd}2`);
    [49, 57.4, 68.6, 76].forEach((y, i) => {
      node(`ki${sd}${i}`, s * 9.3, y); node(`ko${sd}${i}`, s * 15.5, y); edge(`ki${sd}${i}`, `ko${sd}${i}`);
      if (i) { edge(`ki${sd}${i - 1}`, `ki${sd}${i}`); edge(`ko${sd}${i - 1}`, `ko${sd}${i}`); }
    });
  }
  [51, 62, 73, 83].forEach((y, i) => { node('k' + i, 0, y, 0.72); if (i) edge('k' + (i - 1), 'k' + i); });
  edge('c', 'k0');
  node('a90', 0, 95.0); node('a45', 10.5, 90.2); node('a135', -10.5, 90.2); node('a0', 13.5, 79.6); node('a180', -13.5, 79.6);
  edge('k3', 'a90'); edge('a90', 'a45'); edge('a45', 'a0'); edge('a90', 'a135'); edge('a135', 'a180');
  edge('a0', 'koR3'); edge('a0', 'kiR3'); edge('a180', 'koL3'); edge('a180', 'kiL3');
})();
function nearestNode(p) { let best = null, bd = 1e9; for (const id in NODES) { const d = NODES[id].distanceToSquared(p); if (d < bd) { bd = d; best = id; } } return best; }
function bfs(a, b) {
  if (a === b) return [a];
  const prev = { [a]: null }, q = [a];
  while (q.length) { const c = q.shift(); for (const n of EDGES[c]) if (!(n in prev)) { prev[n] = c; if (n === b) { const path = [b]; let k = c; while (k) { path.unshift(k); k = prev[k]; } return path; } q.push(n); } }
  return [a];
}

// ------------------------------------------------------------ hulpfuncties
const ray = new THREE.Ray(), _a = V(), _b = V(), _c = V(), _r = V();
function blocked(a, b) {
  _r.subVectors(b, a); const len = _r.length(); if (len < 0.01) return false;
  ray.origin.copy(a); ray.direction.copy(_r).divideScalar(len);
  const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
  return !!hit && hit.distance < len - 0.35;
}
function groundAt(p) {
  ray.origin.set(p.x, p.y + 1.6, p.z); ray.direction.set(0, -1, 0);
  const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
  return hit ? hit.point.y : 0;
}
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);   // horizontale afstand
function eye() { return new THREE.Vector3(P.pos.x, P.pos.y + 0.15, P.pos.z); }
function camDir(t = V()) { return camera.getWorldDirection(t); }
function say(text, dur = 4) { const s = $('subtitle'); s.textContent = text; s.style.opacity = 1; S.subtitleT = dur; }
function setObjective(t) { const o = $('objective'); o.style.opacity = 0; setTimeout(() => { o.textContent = t; o.style.opacity = 1; }, 600); }
function updateRelicHud() { $('relics').innerHTML = '✝'.repeat(0) + Array.from({ length: 5 }, (_, i) => i < S.relics ? '<b>✠</b>' : '✠').join(' '); }

// ------------------------------------------------------------ invoer
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (!S.running || S.dead || S.ended) return;
  if (e.code === 'KeyF' && P.battery > 0) { P.light = !P.light; sfx.click(); }
  if (e.code === 'KeyE') interact();
  if (DEBUG && e.code === 'Digit1') trigger('crash');
  if (DEBUG && e.code === 'Digit2') lightningStrike(true);
  if (DEBUG && e.code === 'Digit3') trigger('behind');
  if (DEBUG && e.code === 'Digit4') { S.stage = 3; spawnEntity(true); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
// Rondkijken: met pointer lock gewoon de muis bewegen; lukt dat niet, dan slepen met ingedrukte muisknop.
let dragging = false, lockFailed = false;
addEventListener('mousedown', () => { dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (!S.running || S.dead || S.ended) return;
  const locked = document.pointerLockElement === $('c');
  if (!locked && !dragging) return;
  P.yaw -= e.movementX * 0.0021; P.pitch -= e.movementY * 0.0021;
  P.pitch = Math.max(-1.45, Math.min(1.45, P.pitch));
});
document.addEventListener('pointerlockerror', () => {
  lockFailed = true; $('pause').classList.add('hidden'); S.paused = false;
  setTimeout(() => say('Muis vastzetten lukt hier niet: sleep met ingedrukte muisknop om rond te kijken.', 6), 4500);
});
function lockMouse() {
  setTimeout(() => {   // sommige vensters weigeren stil: dan na 1 s overschakelen op slepen
    if (!lockFailed && S.running && document.pointerLockElement !== $('c')) document.dispatchEvent(new Event('pointerlockerror'));
  }, 1000);
  try { const p = $('c').requestPointerLock(); if (p && p.catch) p.catch(() => document.dispatchEvent(new Event('pointerlockerror'))); }
  catch { document.dispatchEvent(new Event('pointerlockerror')); }
}
$('start').addEventListener('click', (e) => { e.stopPropagation(); begin(); });
$('title').addEventListener('click', () => { if (!$('start').classList.contains('hidden')) begin(); });
$('pause').addEventListener('click', () => { lockMouse(); });
$('again').addEventListener('click', () => location.reload());
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === $('c');
  if (!S.running || S.dead || S.ended || DEBUG || lockFailed) return;
  S.paused = !locked; $('pause').classList.toggle('hidden', locked);
  if (sfx.ctx) (locked ? sfx.ctx.resume() : sfx.ctx.suspend());
});

function begin() {
  if (S.running) return;
  sfx.init(); sfx.ambience();
  S.running = true;
  $('title').classList.add('hidden'); $('hud').classList.remove('hidden');
  if (!DEBUG) lockMouse();
  updateRelicHud();
  setObjective('Vind de vijf relikwieën');
  setTimeout(() => say('…de deuren zitten op slot. Ik moet hier weg.'), 1500);
  sfx.slam(B(0, -16.7, 2), 1.2);
}

function interact() {
  const p = currentPickup();
  if (!p) return;
  p.taken = true;
  p.item.visible = false;
  for (const c of p.g.children) if (c.isSprite) c.visible = false;
  if (p.type === 'battery') { P.battery = Math.min(1, P.battery + 0.55); sfx.click(); say('Een batterij. Nog even licht.', 2.5); return; }
  S.relics++; S.stage = S.relics; updateRelicHud(); sfx.pickup();
  if (S.relics === 1) { setObjective('Relikwieën: 1 / 5'); say('Iets in het donker heeft me gehoord.', 3.5); }
  if (S.relics === 2) { setObjective('Relikwieën: 2 / 5'); setTimeout(() => lightningStrike(true), 4500); }
  if (S.relics === 3) { setObjective('Relikwieën: 3 / 5'); setTimeout(() => trigger('behind'), 2500); }
  if (S.relics === 4) { setObjective('Het weet waar je bent. Relikwieën: 4 / 5'); setTimeout(() => { sfx.organ(0.45); S.shake = 0.6; }, 1200); }
  if (S.relics === 5) trigger('unlock');
}
function currentPickup() {
  const d = camDir(_b); let best = null;
  for (const p of pickups) {
    if (p.taken) continue;
    _a.subVectors(p.pos, camera.position); const dist = _a.length();
    if (dist > 2.4) continue;
    if (_a.normalize().dot(d) < 0.86) continue;
    best = p;
  }
  return best;
}

// ------------------------------------------------------------ speler en botsing
const tmpBox = new THREE.Box3(), seg = new THREE.Line3(), triPt = V(), capPt = V(), delta = V(), fwd = V(), right = V(), wish = V();
const moveVel = V();
function updatePlayer(dt) {
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const wantRun = (keys.ShiftLeft || keys.ShiftRight) && f > 0;
  const run = wantRun && P.stamina > 0.05;
  P.stamina = Math.max(0, Math.min(1, P.stamina + (run ? -dt / 5.5 : dt / 9)));
  fwd.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)); right.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  wish.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(right, s);
  if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(run ? 4.9 : 2.3);
  moveVel.lerp(wish, 1 - Math.exp(-dt * 9));
  P.vel.y += P.onGround ? 0 : -25 * dt;
  P.pos.addScaledVector(P.vel, dt).addScaledVector(moveVel, dt);
  // capsule tegen de BVH
  seg.start.copy(P.pos); seg.end.copy(P.pos).add(P.segEnd);
  tmpBox.makeEmpty(); tmpBox.expandByPoint(seg.start); tmpBox.expandByPoint(seg.end);
  tmpBox.min.addScalar(-P.radius); tmpBox.max.addScalar(P.radius);
  bvh.shapecast({
    intersectsBounds: (box) => box.intersectsBox(tmpBox),
    intersectsTriangle: (tri) => {
      const dist = tri.closestPointToSegment(seg, triPt, capPt);
      if (dist < P.radius) {
        const depth = P.radius - dist, dir = capPt.sub(triPt).normalize();
        seg.start.addScaledVector(dir, depth); seg.end.addScaledVector(dir, depth);
      }
    },
  });
  delta.subVectors(seg.start, P.pos);
  P.onGround = delta.y > Math.abs(dt * P.vel.y * 0.25);
  const off = Math.max(0, delta.length() - 1e-5);
  delta.normalize().multiplyScalar(off);
  P.pos.add(delta);
  if (!P.onGround) { delta.normalize(); P.vel.addScaledVector(delta, -delta.dot(P.vel)); } else P.vel.set(0, 0, 0);
  if (P.pos.y < -8) { P.pos.copy(B(0, -13.5, 1.45)); P.vel.set(0, 0, 0); }
  // hoofdbeweging, voetstappen, lawaai
  const sp = Math.hypot(moveVel.x, moveVel.z);
  P.moving = Math.min(1, sp / 2.3);
  const prev = P.stepPhase;
  P.stepPhase += dt * sp * 2.6;
  if (Math.floor(prev / Math.PI) !== Math.floor(P.stepPhase / Math.PI) && sp > 0.6 && P.onGround) sfx.step(Math.random() < 0.5, run, 1);
  P.bob = Math.sin(P.stepPhase) * 0.04 * P.moving;
  P.noise = run && sp > 2.5 ? 1 : sp > 0.6 ? 0.3 : 0;
}
function placeCamera() {
  camera.position.copy(P.pos); camera.position.y += 0.15 + P.bob;
  const sh = S.shake * S.shake;
  camera.rotation.set(P.pitch + (Math.random() - 0.5) * sh * 0.05, P.yaw + (Math.random() - 0.5) * sh * 0.05, Math.sin(P.stepPhase * 0.5) * 0.006 * P.moving + (Math.random() - 0.5) * sh * 0.03);
}

// ------------------------------------------------------------ licht, bliksem, sfeer
function lightningStrike(silhouette = false) {
  S.lightning = { t: 0, pulses: [[0, 1], [0.07, 0.15], [0.13, 0.85], [0.28, 0.05], [0.4, 0.55], [0.55, 0.0]], silhouette };
  if (silhouette && entity) {
    const cands = Object.values(NODES).filter((n) => { const d = n.distanceTo(P.pos); if (d < 14 || d > 34) return false; _a.subVectors(n, camera.position).normalize(); return _a.dot(camDir(_b)) > 0.75 && !blocked(eye(), _b.copy(n).setY(n.y + 1.8)); });
    S.lightning.at = cands.length ? cands[Math.floor(Math.random() * cands.length)] : null;
  }
  setTimeout(() => sfx.ctx && sfx.thunder(rand(0.55, 1.0)), rand(500, 1800));
}
function updateAtmosphere(dt) {
  U.uTime.value = S.time;
  let L = 0;
  if (S.lightning) {
    const lt = S.lightning; lt.t += dt;
    for (const [t, v] of lt.pulses) if (lt.t >= t) L = v;
    L *= Math.random() * 0.3 + 0.7;
    if (lt.silhouette && lt.at && entity.state !== 'hunt') {
      if (L > 0.3) { entity.pos.copy(lt.at); entity.pos.y = groundAt(lt.at); setOpacity(entity, 1); faceEntity(); }
      else if (entity.state === 'hidden') setOpacity(entity, 0);
    }
    if (lt.t > 0.7) { if (lt.silhouette && entity.state === 'hidden') setOpacity(entity, 0); S.lightning = null; }
  }
  S.nextBolt -= dt;
  if (S.nextBolt < 0 && S.running) { lightningStrike(false); S.nextBolt = rand(16, 38); }
  U.uGlow.value = 0.2 + L * 6;
  bolt.intensity = L * 2.2;
  hemi.intensity = 0.14 + L * 0.6;
  fx.uniforms.uFlash.value = L * 0.02 + S.flashOverlay;
  S.flashOverlay = Math.max(0, S.flashOverlay - dt * 3);
  // kaarsen flakkeren
  for (const r of racks) {
    const n = Math.sin(S.time * 13 + r.seed) * 0.5 + Math.sin(S.time * 23.7 + r.seed * 2) * 0.3 + Math.random() * 0.25;
    r.L.intensity = r.base * r.on * (0.8 + 0.2 * n);
    for (const f of r.flames) { f.visible = r.on > 0.05; f.scale.setScalar(f.userData.base * (0.85 + 0.25 * Math.random()) * Math.max(0.2, r.on)); }
  }
  // zaklamp: batterij, flakkeren bij gevaar
  if (P.light) P.battery = Math.max(0, P.battery - dt / 260);
  if (P.battery <= 0) P.light = false;
  let fl = P.light ? 75 : 0;
  const ed = entity && entity.group.visible ? hdist(entity.pos, P.pos) : 99;
  if (P.light && (P.battery < 0.15 || ed < 14)) fl *= Math.random() < (ed < 14 ? 0.18 : 0.08) ? Math.random() * 0.3 : 1;
  flashlight.intensity = fl;
  // stof volgt de speler
  if (dust) { dust.position.copy(camera.position); dust.rotation.y += dt * 0.01; dust.position.y += Math.sin(S.time * 0.2) * 0.2; }
  // druppels
  for (const d of drips) {
    d.t -= dt;
    if (d.t < 0 && d.fallT < 0) { d.fallT = 0; d.drop.visible = true; d.t = rand(1.2, 4.5); }
    if (d.fallT >= 0) {
      d.fallT += dt; const h = 14 - 0.5 * 9.8 * d.fallT * d.fallT;
      d.drop.position.set(d.at.x, Math.max(0, h), d.at.z);
      if (h <= 0) { d.fallT = -1; d.drop.visible = false; d.ringT = 0; if (sfx.ctx && d.at.distanceTo(P.pos) < 22) sfx.drip(d.at); }
    }
    if (d.ringT >= 0) {
      d.ringT += dt; const k = d.ringT / 1.1; d.ring.scale.setScalar(1 + k * 9); d.ring.material.opacity = 0.35 * (1 - k);
      if (k >= 1) { d.ringT = -1; d.ring.material.opacity = 0; }
    }
  }
}

// ------------------------------------------------------------ het wezen
function visibleToPlayer(extra = 0) {
  if (!entity.group.visible) return false;
  const chest = entity.pos.clone(); chest.y += 1.7;
  const ndc = chest.clone().project(camera);
  if (ndc.z > 1 || Math.abs(ndc.x) > 1.05 || Math.abs(ndc.y) > 1.05) return false;
  const d = chest.distanceTo(camera.position);
  if (blocked(camera.position, chest)) return false;
  const lit = P.light && flashlight.intensity > 5 && chest.clone().sub(camera.position).normalize().dot(camDir(V())) > Math.cos(0.4) && d < 34;
  return lit || d < 7 + extra || !!S.lightning;
}
function faceEntity() {
  const dx = camera.position.x - entity.pos.x, dz = camera.position.z - entity.pos.z;
  entity.group.rotation.y = Math.atan2(dx, dz);
}
function spawnEntity(hunt = false) {
  const cands = [];
  for (const id in NODES) {
    const n = NODES[id], d = n.distanceTo(P.pos);
    if (d < (hunt ? 14 : 18) || d > 34) continue;
    _a.subVectors(n, camera.position).normalize();
    const inView = _a.dot(camDir(_b)) > 0.55 && !blocked(eye(), _c.copy(n).setY(n.y + 1.7));
    if (!inView) cands.push(id);
  }
  if (!cands.length) return false;
  const id = cands[Math.floor(Math.random() * cands.length)];
  entity.pos.copy(NODES[id]); entity.pos.y = groundAt(NODES[id]);
  entity.state = hunt ? 'hunt' : 'stalk'; entity.alpha = 0; entity.path = []; entity.lifeT = 0; entity.seenT = 0; entity.lostT = 0;
  entity.repathT = 0;
  sfx.whisper(entity.pos.clone().setY(entity.pos.y + 2), 2, 0.4);
  return true;
}
function vanish(shriek = false) {
  if (shriek) { sfx.shriek(entity.pos.clone().setY(entity.pos.y + 2)); S.flashOverlay = 0.05; }
  entity.state = 'vanish';
}
function updateEntity(dt) {
  const e = entity;
  e.cool -= dt;
  // regie: wanneer verschijnt het?
  if (e.state === 'hidden' && !S.lightning) {
    const ready = (S.stage >= 1 || S.time > 70) && e.cool <= 0;
    if (ready) { if (spawnEntity(S.unlocked)) e.cool = 0; else e.cool = 3; }
    return;
  }
  if (e.state === 'hidden') return;
  if (e.state === 'vanish') {
    e.alpha = Math.max(0, e.alpha - dt * 2.5); setOpacity(e, e.alpha);
    if (e.alpha <= 0) { e.state = 'hidden'; e.cool = S.unlocked ? rand(4, 7) : rand(14, 26) - S.stage * 2; }
    return;
  }
  if (e.state === 'behind') return;      // geregeld door het event
  e.alpha = Math.min(1, e.alpha + dt * 1.5); setOpacity(e, e.alpha);
  e.lifeT += dt;
  const head = e.pos.clone(); head.y += 2.1;
  const dist = hdist(e.pos, P.pos);
  const seen = visibleToPlayer();
  const canSee = dist < (P.light ? 20 : 9) && !blocked(head, camera.position);
  // verjagen met de zaklamp
  const inBeam = seen && P.light && flashlight.intensity > 5 && head.clone().sub(camera.position).normalize().dot(camDir(V())) > Math.cos(0.3) && dist < 17;
  e.burn = inBeam ? e.burn + dt : Math.max(0, e.burn - dt * 0.5);
  if (e.burn > (e.state === 'hunt' ? 1.4 : 0.9)) { P.battery = Math.max(0, P.battery - 0.08); e.burn = 0; vanish(true); return; }
  // toestanden
  if (e.state === 'stalk') {
    if (seen) e.seenT += dt;
    if ((canSee && S.stage >= 2) || (P.noise >= 1 && dist < 22 && S.stage >= 2) || S.unlocked) { e.state = 'hunt'; sfx.whisper(head.clone(), 1.2, 0.8); }
    else if (e.seenT > 1.2 && S.stage < 2) { vanish(false); sfx.whisper(head.clone(), 1.5, 0.6); return; }
    if (e.lifeT > 28) { vanish(false); return; }
  } else if (e.state === 'hunt') {
    e.lostT = canSee ? 0 : e.lostT + dt;
    if (e.lostT > (S.unlocked ? 20 : 8)) { vanish(false); return; }
  }
  // bewegen: rechtstreeks als het je ziet, anders langs het wegennet
  const speed = e.state === 'hunt' ? (S.unlocked ? 4.35 : 3.1 + S.stage * 0.22) : 1.35;
  let target;
  if (e.state === 'hunt' && canSee) target = _b.copy(P.pos);
  else {
    e.repathT -= dt;
    if (e.repathT <= 0 || !e.path.length) { e.path = bfs(nearestNode(e.pos), nearestNode(P.pos)).slice(1); e.repathT = 1.5; }
    target = e.path.length ? _b.copy(NODES[e.path[0]]) : _b.copy(P.pos);
    if (e.path.length && Math.hypot(target.x - e.pos.x, target.z - e.pos.z) < 0.8) e.path.shift();
  }
  const dir = _c.set(target.x - e.pos.x, 0, target.z - e.pos.z);
  const len = dir.length();
  if (len > 0.05) e.pos.addScaledVector(dir.divideScalar(len), Math.min(len, speed * dt));
  // schokkerige sprongen tijdens de jacht
  e.glitchT -= dt;
  if (e.state === 'hunt' && e.glitchT < 0) {
    e.glitchT = rand(0.7, 1.6);
    if (Math.random() < 0.35 && dist > 4) { e.pos.addScaledVector(_c.set(P.pos.x - e.pos.x, 0, P.pos.z - e.pos.z).normalize(), 1.4); S.flashOverlay = 0.015; }
  }
  e.pos.y += (groundAt(e.pos) - e.pos.y) * Math.min(1, dt * 6);
  // pakken
  if (dist < 1.3 && (e.state === 'hunt' || e.state === 'stalk') && !DEBUG_GOD) death();
  // ademhaling en hartslag
  e.breathT -= dt;
  if (e.breathT < 0 && dist < 16) { sfx.breath(head.clone(), 0.5); e.breathT = 2.8; }
}
let DEBUG_GOD = DEBUG && Q.has('god');
function animateEntity(dt) {
  const e = entity, g = e.group;
  g.position.copy(e.pos); g.position.y += 0.12 + Math.sin(S.time * 1.7) * 0.05;
  if (e.state !== 'behind') faceEntity();
  e.head.rotation.z = Math.sin(S.time * 0.9) * 0.08 + (Math.random() < 0.02 ? (Math.random() - 0.5) * 0.9 : 0);
  e.head.rotation.x = 0.12 + Math.sin(S.time * 0.6) * 0.05;
  e.arms[0].rotation.x = -0.12 + Math.sin(S.time * 1.3) * 0.06;
  e.arms[1].rotation.x = -0.12 + Math.sin(S.time * 1.1 + 1) * 0.06;
  if (e.state === 'hunt') { e.arms[0].rotation.x = -0.9; e.arms[1].rotation.x = -0.75; }
}

// ------------------------------------------------------------ scripted events
function trigger(name) {
  if (S.fired[name] && name !== 'unlock') return; S.fired[name] = true;
  if (name === 'crash') {
    // de dichtstbijzijnde kroonluchter vóór de speler stort neer
    const d = camDir(V()); let best = null, bd = 1e9;
    for (const c of chandeliers) {
      const p = c.getWorldPosition(V()); _a.subVectors(p, P.pos); const dist = Math.hypot(_a.x, _a.z);
      if (dist < 5 || dist > 15) continue;
      if (_a.setY(0).normalize().dot(d.setY(0).normalize()) < 0.6) continue;
      if (dist < bd) { bd = dist; best = c; }
    }
    if (!best) { S.fired.crash = false; return; }
    best.userData.fall = { v: 0, rx: rand(-0.6, 0.6), rz: rand(-0.6, 0.6), y0: best.position.y };
    sfx.creak(best.getWorldPosition(V()));
  }
  if (name === 'steps') {
    let k = 0; const back = () => {
      if (k++ > 4) { sfx.whisper(eye().clone().addScaledVector(camDir(V()), -2.5), 1.6, 0.6); return; }
      const p = P.pos.clone().addScaledVector(camDir(V()).setY(0).normalize(), -(5 - k * 0.6)); p.y = 0.2;
      sfx.step(true, false, 1.8, p); setTimeout(back, 520);
    };
    setTimeout(back, 300);
  }
  if (name === 'behind') {
    racks.forEach((r, i) => setTimeout(() => { r.on = 0; sfx.puff(r.g.position); }, 300 + i * 260));
    setTimeout(() => {
      const back = camDir(V()).setY(0).normalize().multiplyScalar(-1.5);
      entity.pos.copy(P.pos).add(back); entity.pos.y = groundAt(entity.pos);
      entity.state = 'behind'; entity.alpha = 1; setOpacity(entity, 1); faceEntity();
      entity.behindT = 0;
      sfx.whisper(entity.pos.clone().setY(entity.pos.y + 2), 2.2, 1.0);
    }, 300 + racks.length * 260 + 900);
    setTimeout(() => racks.forEach((r, i) => setTimeout(() => { r.on = 1; }, i * 700)), 30000);
  }
  if (name === 'unlock') {
    S.unlocked = true; S.stage = 5;
    setObjective('Het portaal is open. RENNEN.');
    sfx.slam(B(0, -16.7, 3), 2); setTimeout(() => sfx.creak(B(0, -16.7, 3)), 400);
    setTimeout(() => { sfx.organ(0.5); S.shake = 0.8; }, 900);
    door.opening = true; door.outside.visible = true;
    entity.state = 'hidden'; entity.cool = 2.5; setOpacity(entity, 0);
  }
}
function updateEvents(dt) {
  const by = -P.pos.z, bx = P.pos.x;                    // terug naar Blender-coordinaten
  if (!S.fired.crash && by > 1 && Math.abs(bx) < 6) trigger('crash');
  if (!S.fired.steps && Math.abs(bx) > 8 && by < 33) trigger('steps');
  // vallende kroonluchter
  for (const c of chandeliers) {
    const f = c.userData.fall; if (!f || f.done) continue;
    f.v += 9.8 * dt; c.position.y -= f.v * dt; c.rotation.x += f.rx * dt * 2; c.rotation.z += f.rz * dt * 2;
    if (c.position.y < 1.0) {
      c.position.y = 1.0; f.done = true; c.rotation.x = f.rx * 0.6; c.rotation.z = f.rz * 0.6 + 0.3;
      const p = c.getWorldPosition(V()); sfx.crash(p); S.shake = Math.max(S.shake, 1.2 - Math.min(1, p.distanceTo(P.pos) / 20)); S.flashOverlay = 0.03;
      setTimeout(() => say('Dat was geen ongeluk.', 3), 1600);
    }
  }
  // "achter je"
  if (entity && entity.state === 'behind') {
    entity.behindT += dt;
    _a.subVectors(entity.pos, P.pos).setY(0).normalize();
    if (_a.dot(camDir(_b).setY(0).normalize()) > 0.6) {
      sfx.stinger(1); S.flashOverlay = 0.5; S.shake = 1; flashFace(130);
      entity.state = 'vanish'; entity.alpha = 1;
    } else if (entity.behindT > 7) { entity.state = 'vanish'; }
  }
  // deur open en ontsnappen
  if (door && door.opening) {
    S.doorOpen = Math.min(1, S.doorOpen + dt * 0.35);
    for (const l of door.leaves) l.hinge.rotation.y = l.sx * -S.doorOpen * 1.2;
    if (S.doorOpen > 0.6 && P.pos.distanceTo(B(0, -15.4, 1.45)) < 2.6) escape();
  }
  // losse schrikmomenten
  S.nextScare -= dt;
  if (S.nextScare < 0) {
    S.nextScare = rand(22, 48);
    const r = Math.random(), far = P.pos.clone().add(V().set(rand(-1, 1), 0, rand(-1, 1)).normalize().multiplyScalar(rand(12, 25)));
    if (r < 0.3) sfx.slam(far, 0.8);
    else if (r < 0.55) sfx.whisper(eye().clone().add(V().set(rand(-1, 1), 0.2, rand(-1, 1)).normalize().multiplyScalar(2)), 1.8, 0.5);
    else if (r < 0.75) { const keep = flashlight.intensity; P.light = false; setTimeout(() => { if (P.battery > 0) P.light = true; }, 900); sfx.click(); }
    else sfx.creak(far);
  }
  // hartslag en angst
  const ed = entity && entity.group.visible ? hdist(entity.pos, P.pos) : 99;
  const targetFear = Math.max(0, 1 - ed / 18) + (entity && entity.state === 'hunt' ? 0.25 : 0);
  S.fear += (Math.min(1, targetFear) - S.fear) * Math.min(1, dt * 2);
  S.hb -= dt;
  if (S.fear > 0.15 && S.hb < 0) { sfx.heartbeat(0.25 + S.fear * 0.6); S.hb = 1.15 - S.fear * 0.65; }
  if (sfx.droneGain) sfx.droneGain.gain.setTargetAtTime(0.11 + S.fear * 0.18, sfx.t, 0.5);
  fx.uniforms.uFear.value = S.fear;
  S.shake = Math.max(0, S.shake - dt * 1.4);
}

// ------------------------------------------------------------ jumpscare, dood, ontsnappen
const scareCv = $('scare'), sctx = scareCv.getContext('2d');
function drawScare(intensity) {
  scareCv.width = innerWidth; scareCv.height = innerHeight;
  const w = innerWidth, h = innerHeight, s = Math.max(w, h) * (1.05 + Math.random() * 0.25);
  sctx.fillStyle = '#000'; sctx.fillRect(0, 0, w, h);
  sctx.save();
  sctx.translate(w / 2 + (Math.random() - 0.5) * 60 * intensity, h / 2 + (Math.random() - 0.5) * 60 * intensity);
  sctx.rotate((Math.random() - 0.5) * 0.15 * intensity);
  sctx.drawImage(faceCv, -s / 2, -s / 2, s, s);
  sctx.restore();
  sctx.fillStyle = `rgba(120,0,0,${0.25 * intensity})`; sctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 18 * intensity; i++) { sctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`; sctx.fillRect(0, Math.random() * h, w, Math.random() * 6); }
}
function flashFace(ms) { scareCv.classList.remove('hidden'); drawScare(0.6); setTimeout(() => scareCv.classList.add('hidden'), ms); }
function death() {
  if (S.dead) return;
  S.dead = true; document.exitPointerLock();
  sfx.scream(1); S.shake = 2;
  scareCv.classList.remove('hidden');
  const t0 = performance.now();
  const anim = () => {
    const k = (performance.now() - t0) / 1000;
    if (k < 1.5) { drawScare(1 - k * 0.3); requestAnimationFrame(anim); }
    else {
      scareCv.classList.add('hidden');
      $('hud').classList.add('hidden');
      $('endTitle').textContent = 'GEVONDEN';
      $('endText').textContent = `Je hield het ${fmt(S.time)} vol en vond ${S.relics} van de 5 relikwieën. De nachtwake gaat door, met jou erbij.`;
      $('end').classList.remove('hidden');
    }
  };
  anim();
}
function escape() {
  if (S.ended) return;
  S.ended = true; document.exitPointerLock();
  S.flashOverlay = 1.5; sfx.thunder(1);
  setTimeout(() => {
    $('hud').classList.add('hidden');
    $('endTitle').textContent = 'ONTSNAPT';
    $('endText').textContent = `De storm slaat je in het gezicht. Je bent buiten, na ${fmt(S.time)}. Achter je slaan de deuren dicht. Binnen begint iemand weer de kaarsen aan te steken…`;
    $('end').classList.remove('hidden');
  }, 900);
}
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------ hoofdlus
const clock = new THREE.Clock();
let fpsT = 0, fpsN = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  const live = S.running && !S.paused && !S.dead && !S.ended;
  if (live) {
    S.time += dt;
    updatePlayer(dt);
    updateEvents(dt);
    updateEntity(dt);
  }
  if (entity) animateEntity(dt);
  if (S.dead && entity) {                        // het wezen staat vlak voor je gezicht
    camera.getWorldDirection(_a); entity.pos.copy(camera.position).addScaledVector(_a.setY(0).normalize(), 0.75); entity.pos.y = camera.position.y - 2.15;
    setOpacity(entity, 1); entity.state = 'dead'; faceEntity(); entity.group.position.copy(entity.pos);
  }
  placeCamera();
  updateAtmosphere(live ? dt : dt * 0.3);
  // HUD
  if (S.running) {
    $('battery').style.transform = `scaleX(${P.battery})`;
    $('stamina').style.transform = `scaleX(${P.stamina})`;
    const pk = live && currentPickup();
    $('prompt').textContent = pk ? (pk.type === 'relic' ? '[E] Neem het relikwie' : '[E] Pak de batterij') : '';
    if (S.subtitleT > 0) { S.subtitleT -= dt; if (S.subtitleT <= 0) $('subtitle').style.opacity = 0; }
    for (const p of pickups) if (!p.taken) { p.item.rotation.y += dt * 0.6; }
  }
  if (sfx.ctx) sfx.listener(camera);
  fx.uniforms.uTime.value = S.time;
  if (!collider) return;
  // renderen: eerst de spiegeling van de natte vloer, dan het beeld
  if (!LOW) renderer.shadowMap.needsUpdate = true;
  if (!LOW && floorMesh) mirror.render(renderer, scene, camera, [floorMesh, dust]);
  if (LOW) U.uRefl.value = 0;
  composer.render();
  if (DEBUG) { fpsN++; fpsT += dt; if (fpsT > 1) { document.title = `Nachtwake ${fpsN} fps`; fpsN = 0; fpsT = 0; } }
}
