// Het wezen: lange gestalte in een gerafeld gewaad met kap, bleek gezicht en te lange armen.
import * as THREE from 'three';

export function makeEntity(faceTex) {
  const g = new THREE.Group();
  const mats = [];
  const M = (m) => { m.transparent = true; mats.push(m); return m; };
  // mat zwart zonder glans: zelfs in de volle lichtbundel blijft het een gat in het beeld
  const cloth = M(new THREE.MeshLambertMaterial({ color: 0x020202, side: THREE.DoubleSide }));
  const skin = M(new THREE.MeshLambertMaterial({ color: 0x2e2c27 }));

  // gewaad (draaivorm) met gerafelde zoom
  const prof = [[0.03, 2.3], [0.15, 2.26], [0.23, 2.14], [0.26, 1.96], [0.29, 1.72], [0.31, 1.4], [0.37, 1.0],
    [0.47, 0.55], [0.56, 0.18], [0.6, -0.05]].map(([r, y]) => new THREE.Vector2(r, y));
  const robe = new THREE.LatheGeometry(prof, 56);
  const p = robe.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0.5) {
      const a = Math.atan2(z, x), k = (0.5 - y) / 0.55;
      const r = 1 + k * 0.18 * Math.sin(a * 5 + 1.3);
      p.setXYZ(i, x * r, y - k * (0.22 * Math.abs(Math.sin(a * 7)) + 0.12 * Math.abs(Math.sin(a * 17))), z * r);
    }
  }
  robe.computeVertexNormals();
  const robeM = new THREE.Mesh(robe, cloth); g.add(robeM);

  // kap met opening aan de voorkant (+z)
  const open = THREE.MathUtils.degToRad(110);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 20, Math.PI / 2 + open / 2, Math.PI * 2 - open, 0, Math.PI * 0.68), cloth);
  hood.scale.set(1, 1.3, 1.1); hood.position.set(0, 2.22, -0.02); g.add(hood);

  // hoofd en gezicht
  const head = new THREE.Group(); head.position.set(0, 2.2, 0.02); g.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 18), skin); skull.scale.set(0.85, 1.22, 0.85); head.add(skull);
  const faceMat = M(new THREE.MeshLambertMaterial({ map: faceTex, color: 0x6a665c, emissive: 0x222018, emissiveMap: faceTex, emissiveIntensity: 0.12 }));
  const faceGeo = new THREE.PlaneGeometry(0.36, 0.48, 12, 12);
  const fp = faceGeo.attributes.position;
  for (let i = 0; i < fp.count; i++) { const x = fp.getX(i), y = fp.getY(i); fp.setZ(i, -(x * x) * 1.6 - (y * y) * 0.5); }
  faceGeo.computeVertexNormals();
  const face = new THREE.Mesh(faceGeo, faceMat); face.position.set(0, 0, 0.15); head.add(face);
  const eyeMat = M(new THREE.MeshBasicMaterial({ color: 0xfff4e0 }));
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 8, 6), eyeMat);
    e.position.set(sx * 0.043, 0.034, 0.165); head.add(e);
  }

  // armen met lange vingers
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sx * 0.27, 1.93, 0.04); g.add(arm);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 1.2, 8), cloth);
    up.position.y = -0.6; arm.add(up);
    const hand = new THREE.Group(); hand.position.y = -1.22; arm.add(hand);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin); palm.scale.set(1, 1.4, 0.5); hand.add(palm);
    for (let f = 0; f < 4; f++) {
      const fg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.004, 0.3, 5), skin);
      fg.position.set((f - 1.5) * 0.022, -0.17, 0.0); fg.rotation.z = (f - 1.5) * 0.08; hand.add(fg);
    }
    arm.rotation.z = sx * 0.06; arm.rotation.x = -0.12;
    arms.push(arm);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { group: g, head, arms, mats };
}

export function setOpacity(ent, a) {
  for (const m of ent.mats) { m.opacity = a; m.depthWrite = a > 0.98; }
  ent.group.visible = a > 0.01;
}
