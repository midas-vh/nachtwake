// Materialen voor de kathedraal (triplanair, want de GLB heeft geen UV's) en de natte spiegelvloer.
import * as THREE from 'three';

export const U = {               // gedeelde uniforms
  uTime: { value: 0 },
  uGlow: { value: 0.22 },        // helderheid van de ramen (maanlicht; bliksem zet hem hoog)
  uRefl: { value: 4.0 },
};

const triCommon = /* glsl */`
varying vec3 vWPos; varying vec3 vWNrm;
uniform sampler2D tAlb; uniform sampler2D tWet; uniform float uScale;
vec4 tri(sampler2D t, vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-5);
  return texture2D(t, p.zy * uScale) * w.x + texture2D(t, p.xz * uScale) * w.y + texture2D(t, p.xy * uScale) * w.z;
}
`;
function patchVertex(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
    .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * normal);');
}

export function stoneMaterial(tex, { tint = 0xffffff, wetBase = 0.12, scale = 0.5, rough = 0.88, bright = 1.6 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness: rough, metalness: 0, envMapIntensity: 0.05 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tAlb: { value: tex.albedo }, tWet: { value: tex.wet }, uScale: { value: scale },
      uWetBase: { value: wetBase }, uBright: { value: bright } });
    patchVertex(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + triCommon + 'uniform float uWetBase; uniform float uBright;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 nW = normalize(vWNrm);
        vec4 alb = tri(tAlb, vWPos, nW);
        vec4 wt = tri(tWet, vWPos, nW);
        float wet = clamp(wt.r * 0.95 + smoothstep(2.6, 0.0, vWPos.y) * 0.55 + uWetBase, 0.0, 1.0);
        diffuseColor.rgb *= alb.rgb * uBright * mix(1.0, 0.45, wet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, wet);`);
  };
  return m;
}

export function glassMaterial(tex, strength = 1, scale = 0.9) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tAlb: { value: tex }, tWet: { value: tex }, uScale: { value: scale }, uGlow: U.uGlow,
      uStr: { value: strength } });
    patchVertex(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + triCommon + 'uniform float uGlow; uniform float uStr;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec4 gl = tri(tAlb, vWPos, normalize(vWNrm));
        diffuseColor.rgb *= gl.rgb * uGlow * uStr;`);
  };
  return m;
}

export function floorMaterial(tex, puddle, mirror) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, envMapIntensity: 0.05 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tAlb: { value: tex.albedo }, tWet: { value: tex.wet }, uScale: { value: 0.5 },
      tPud: { value: puddle }, tRefl: { value: mirror.rt.texture }, uTexMat: { value: mirror.texMat },
      uTime: U.uTime, uRefl: U.uRefl });
    patchVertex(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + triCommon +
        'uniform sampler2D tPud; uniform sampler2D tRefl; uniform mat4 uTexMat; uniform float uTime; uniform float uRefl; float gPud;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 fp = vWPos.xz / 0.8;
        float chk = mod(floor(fp.x) + floor(fp.y), 2.0);
        vec3 base = mix(vec3(0.40, 0.40, 0.38), vec3(0.016, 0.02, 0.028), chk);
        vec4 grime = texture2D(tAlb, vWPos.xz * 0.21);
        float pudN = texture2D(tPud, vWPos.xz * 0.045).r;
        gPud = smoothstep(0.50, 0.58, pudN);
        diffuseColor.rgb = base * (0.6 + 0.9 * grime.g) * mix(1.0, 0.3, gPud);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.34, 0.02, gPud);`)
      .replace('#include <opaque_fragment>', `
        vec2 rip = texture2D(tPud, vWPos.xz * 0.6 + vec2(uTime * 0.013, -uTime * 0.009)).gb - 0.5;
        vec4 rp = uTexMat * vec4(vWPos, 1.0);
        rp.xy += rip * 0.05 * rp.w * (1.0 - 0.75 * gPud);
        vec3 refl = texture2DProj(tRefl, rp).rgb;
        float cosV = clamp(dot(normalize(cameraPosition - vWPos), vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
        float fres = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
        outgoingLight += refl * uRefl * mix(0.08 + 0.45 * fres, 0.6 + 0.4 * fres, gPud);
        #include <opaque_fragment>`);
  };
  return m;
}

// Spiegelcamera voor de natte vloer (vlak y = 0), zoals three's Reflector
export class Mirror {
  constructor(scale = 0.5) {
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    this.cam = new THREE.PerspectiveCamera();
    this.texMat = new THREE.Matrix4();
    this.scale = scale;
    this._p = new THREE.Vector3(); this._d = new THREE.Vector3(); this._t = new THREE.Vector3(); this._u = new THREE.Vector3();
  }
  resize(w, h) { this.rt.setSize(Math.max(4, Math.floor(w * this.scale)), Math.max(4, Math.floor(h * this.scale))); }
  render(renderer, scene, camera, hide) {
    const c = this.cam;
    c.fov = camera.fov; c.aspect = camera.aspect; c.near = camera.near; c.far = camera.far; c.updateProjectionMatrix();
    const p = camera.getWorldPosition(this._p), d = camera.getWorldDirection(this._d);
    c.position.set(p.x, -p.y, p.z);
    const t = this._t.copy(p).add(d); t.y = -t.y;
    const up = this._u.set(0, 1, 0).applyQuaternion(camera.quaternion); up.y = -up.y;
    c.up.copy(up); c.lookAt(t); c.updateMatrixWorld();
    this.texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
    for (const o of hide) o.visible = false;
    const old = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt); renderer.clear(); renderer.render(scene, c); renderer.setRenderTarget(old);
    for (const o of hide) o.visible = true;
  }
}

export const HorrorShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFear: { value: 0 }, uFlash: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uFear; uniform float uFlash; varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv; vec2 c = uv - 0.5;
      uv.x += sin(uv.y * 38.0 + uTime * 23.0) * 0.0022 * uFear * uFear;
      float ab = 0.0012 + 0.009 * uFear;
      vec3 col = vec3(texture2D(tDiffuse, uv + c * ab).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ab).b);
      float vig = smoothstep(0.86, 0.22 - 0.12 * uFear, length(c * vec2(1.15, 1.0)));
      col *= mix(0.18, 1.0, vig);
      col = mix(col, col * vec3(1.2, 0.72, 0.7), uFear * 0.45);
      float g = h(floor(uv * vec2(960.0, 540.0)) + fract(uTime * 7.0) * 91.0) - 0.5;
      col += g * (0.03 + 0.07 * uFear) * (0.25 + col);
      col += vec3(uFlash);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};
