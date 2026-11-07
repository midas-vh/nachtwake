// Alle geluid wordt live gemaakt met de Web Audio API: geen geluidsbestanden nodig.
export class Sfx {
  constructor() { this.ctx = null; }

  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(ctx.destination);
    // kathedraalgalm: zelfgemaakte impulsrespons van ~6 s
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 900 ? i / 900 : 1); }
    }
    this.reverb.buffer = ir;
    const rg = ctx.createGain(); rg.gain.value = 0.55;
    this.reverb.connect(rg); rg.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }
  get t() { return this.ctx.currentTime; }

  listener(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = cam.position;
    const f = cam.getWorldDirection(this._v || (this._v = cam.position.clone()));
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }

  // Uitgang: optioneel ruimtelijk (pos = THREE.Vector3), met galm-aandeel
  out(pos, reverb = 0.5, gain = 1) {
    const ctx = this.ctx, g = ctx.createGain(); g.gain.value = gain;
    let head = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2.5; p.rolloffFactor = 1.1; p.maxDistance = 90;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); head = p;
    }
    const dry = ctx.createGain(); dry.gain.value = 1 - reverb * 0.5;
    const wet = ctx.createGain(); wet.gain.value = reverb;
    head.connect(dry); head.connect(wet); dry.connect(this.master); wet.connect(this.reverb);
    return g;
  }
  noiseSrc(loop = false) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = loop;
    s.loopStart = Math.random(); s.loopEnd = s.loopStart + 2;
    return s;
  }
  filt(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  env(g, t0, a, peak, d, end = 0.0001) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(end, t0 + a + d);
  }

  // ---- sfeer
  ambience() {
    const ctx = this.ctx, t = this.t;
    // lage dreun
    const dg = this.out(null, 0.6, 0.0); dg.gain.setValueAtTime(0, t); dg.gain.linearRampToValueAtTime(0.11, t + 6);
    const lp = this.filt('lowpass', 170, 3); lp.connect(dg);
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.045; lfoG.gain.value = 70;
    lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
    for (const f of [36.7, 37.1, 55.2]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); }
    // regen buiten (gedempt door de muren) en op het dak
    const rain = this.noiseSrc(true), rb = this.filt('bandpass', 700, 0.5), rg = this.out(null, 0.25, 0.085);
    rain.connect(rb); rb.connect(rg); rain.start();
    const roof = this.noiseSrc(true), rh = this.filt('highpass', 3000), rg2 = this.out(null, 0.7, 0.018);
    roof.connect(rh); rh.connect(rg2); roof.start();
    // wind door kieren
    const wind = this.noiseSrc(true), wb = this.filt('bandpass', 380, 6), wg = this.out(null, 0.9, 0.05);
    const wl = ctx.createOscillator(), wlg = ctx.createGain(); wl.frequency.value = 0.07; wlg.gain.value = 220;
    wl.connect(wlg); wlg.connect(wb.frequency); wl.start();
    wind.connect(wb); wb.connect(wg); wind.start();
    this.droneGain = dg;
  }
  drip(pos) {
    const t = this.t, o = this.ctx.createOscillator(), g = this.out(pos, 0.85, 1);
    const f = 900 + Math.random() * 900;
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.09);
    const e = this.ctx.createGain(); this.env(e, t, 0.002, 0.35, 0.13);
    o.connect(e); e.connect(g); o.start(t); o.stop(t + 0.2);
  }
  step(wet, run, gain = 1, pos = null) {
    const t = this.t, n = this.noiseSrc(), b = this.filt('bandpass', run ? 1100 : 800, 1.2);
    const e = this.ctx.createGain(); this.env(e, t, 0.004, (run ? 0.32 : 0.18) * gain, 0.09);
    n.connect(b); b.connect(e); e.connect(this.out(pos, 0.5)); n.start(t); n.stop(t + 0.2);
    if (wet) {
      const s = this.noiseSrc(), h = this.filt('highpass', 2600), e2 = this.ctx.createGain();
      this.env(e2, t + 0.01, 0.01, (run ? 0.16 : 0.08) * gain, 0.16);
      s.connect(h); h.connect(e2); e2.connect(this.out(pos, 0.4)); s.start(t); s.stop(t + 0.3);
    }
  }
  thunder(strength = 1) {
    const t = this.t, n = this.noiseSrc(), lp = this.filt('lowpass', 1400, 0.7);
    lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(90, t + 4);
    const e = this.ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.9 * strength, t + 0.06);
    e.gain.exponentialRampToValueAtTime(0.35 * strength, t + 0.5);
    e.gain.linearRampToValueAtTime(0.5 * strength, t + 0.9);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
    n.loop = true; n.connect(lp); lp.connect(e); e.connect(this.out(null, 0.5)); n.start(t); n.stop(t + 6);
  }
  whisper(pos, dur = 1.8, gain = 0.5) {
    const ctx = this.ctx, t = this.t, n = this.noiseSrc();
    const f1 = this.filt('bandpass', 700, 9), f2 = this.filt('bandpass', 1300, 11), mix = ctx.createGain();
    for (let k = 0; k < dur * 14; k++) {
      const tt = t + k / 14;
      f1.frequency.setValueAtTime(400 + Math.random() * 700, tt);
      f2.frequency.setValueAtTime(1000 + Math.random() * 1600, tt);
    }
    const e = ctx.createGain(); e.gain.setValueAtTime(0.0001, t);
    for (let k = 0; k < dur * 6; k++) e.gain.linearRampToValueAtTime((Math.random() * 0.8 + 0.2) * gain, t + k / 6 + 0.08);
    e.gain.linearRampToValueAtTime(0.0001, t + dur);
    n.connect(f1); n.connect(f2); f1.connect(mix); f2.connect(mix); mix.connect(e); e.connect(this.out(pos, 0.75, 2.2));
    n.start(t); n.stop(t + dur + 0.1);
  }
  breath(pos, gain = 0.5) {
    const t = this.t;
    for (const [d, f] of [[0, 520], [1.3, 380]]) {
      const n = this.noiseSrc(), b = this.filt('bandpass', f, 2.5), e = this.ctx.createGain();
      e.gain.setValueAtTime(0.0001, t + d); e.gain.linearRampToValueAtTime(gain, t + d + 0.5); e.gain.linearRampToValueAtTime(0.0001, t + d + 1.15);
      n.connect(b); b.connect(e); e.connect(this.out(pos, 0.5, 1.5)); n.start(t + d); n.stop(t + d + 1.3);
    }
  }
  heartbeat(gain) {
    const t = this.t;
    for (const [d, a] of [[0, 1], [0.17, 0.7]]) {
      const o = this.ctx.createOscillator(), e = this.ctx.createGain();
      o.frequency.setValueAtTime(62, t + d); o.frequency.exponentialRampToValueAtTime(38, t + d + 0.14);
      this.env(e, t + d, 0.01, gain * a, 0.16);
      o.connect(e); e.connect(this.out(null, 0.05)); o.start(t + d); o.stop(t + d + 0.25);
    }
  }
  _dist() {
    const ws = this.ctx.createWaveShaper(), c = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = i / 1024 - 1; c[i] = Math.tanh(x * 6); }
    ws.curve = c; return ws;
  }
  scream(gain = 1) {   // dodelijke jumpscare
    const ctx = this.ctx, t = this.t, ws = this._dist(), e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.9 * gain, t + 0.03);
    e.gain.setValueAtTime(0.9 * gain, t + 1.2); e.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    ws.connect(e); e.connect(this.out(null, 0.3));
    for (const [f, d] of [[340, 0], [353, 7], [510, -5], [700, 3]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = d * 10;
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 2.6, t + 0.35);
      o.frequency.exponentialRampToValueAtTime(f * 1.7, t + 2);
      const v = ctx.createOscillator(), vg = ctx.createGain(); v.frequency.value = 13 + Math.random() * 6; vg.gain.value = f * 0.06;
      v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 2.3);
      o.connect(ws); o.start(t); o.stop(t + 2.3);
    }
    const n = this.noiseSrc(), h = this.filt('highpass', 1800); n.connect(h); h.connect(ws); n.start(t); n.stop(t + 2.3);
  }
  stinger(gain = 1) {  // schrikakkoord zonder dood
    const ctx = this.ctx, t = this.t, lp = this.filt('lowpass', 300, 1), e = ctx.createGain();
    lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(5000, t + 0.05); lp.frequency.exponentialRampToValueAtTime(400, t + 2.5);
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.75 * gain, t + 0.02); e.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    lp.connect(e); e.connect(this.out(null, 0.6));
    for (const f of [55, 58.3, 82.4, 116.5, 233, 246.9, 466.2, 493.9]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 30;
      o.connect(lp); o.start(t); o.stop(t + 3);
    }
    const n = this.noiseSrc(), ne = ctx.createGain(); this.env(ne, t, 0.005, 0.6 * gain, 0.4);
    n.connect(ne); ne.connect(this.out(null, 0.5)); n.start(t); n.stop(t + 0.6);
  }
  organ(gain = 0.4) {
    const ctx = this.ctx, t = this.t, lp = this.filt('lowpass', 1800, 0.7), e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(gain, t + 0.25);
    e.gain.setValueAtTime(gain, t + 3.5); e.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    lp.connect(e); e.connect(this.out(null, 0.9));
    for (const f of [36.7, 73.4, 87.3, 103.8, 146.8, 174.6, 207.7, 293.7]) {   // d-klein met overmatige kwart
      for (const [type, m] of [['square', 0.5], ['sawtooth', 1]]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * m; o.connect(lp); o.start(t); o.stop(t + 6.2);
      }
    }
  }
  crash(pos) {
    const ctx = this.ctx, t = this.t, out = this.out(pos, 0.7, 2.5);
    const n = this.noiseSrc(), b = this.filt('bandpass', 2400, 0.6), e = ctx.createGain(); this.env(e, t, 0.005, 0.8, 1.4);
    n.connect(b); b.connect(e); e.connect(out); n.start(t); n.stop(t + 1.6);
    for (let k = 0; k < 14; k++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), d = Math.random() * 0.25;
      o.frequency.value = 700 + Math.random() * 4800; this.env(g, t + d, 0.003, 0.12, 0.4 + Math.random() * 1.6);
      o.connect(g); g.connect(out); o.start(t + d); o.stop(t + d + 2.2);
    }
    const th = ctx.createOscillator(), tg = ctx.createGain();
    th.frequency.setValueAtTime(90, t); th.frequency.exponentialRampToValueAtTime(30, t + 0.4); this.env(tg, t, 0.005, 1, 0.5);
    th.connect(tg); tg.connect(out); th.start(t); th.stop(t + 0.6);
  }
  slam(pos, gain = 1) {
    const ctx = this.ctx, t = this.t, out = this.out(pos, 0.9, 2 * gain);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.3); this.env(g, t, 0.004, 1, 0.45);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.5);
    const n = this.noiseSrc(), l = this.filt('lowpass', 500), e = ctx.createGain(); this.env(e, t, 0.003, 0.6, 0.25);
    n.connect(l); l.connect(e); e.connect(out); n.start(t); n.stop(t + 0.4);
  }
  creak(pos) {
    const ctx = this.ctx, t = this.t, o = ctx.createOscillator(), b = this.filt('bandpass', 900, 4), e = ctx.createGain();
    o.type = 'sawtooth';
    for (let k = 0; k < 40; k++) o.frequency.setValueAtTime(60 + Math.random() * 90 + k * 2, t + k * 0.05);
    e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(0.35, t + 0.3); e.gain.linearRampToValueAtTime(0.0001, t + 2.1);
    o.connect(b); b.connect(e); e.connect(this.out(pos, 0.8, 2)); o.start(t); o.stop(t + 2.2);
  }
  pickup() {   // spookachtig koor
    const ctx = this.ctx, t = this.t, e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.22, t + 0.6); e.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    const f1 = this.filt('bandpass', 750, 6), f2 = this.filt('bandpass', 1150, 7);
    f1.connect(e); f2.connect(e); e.connect(this.out(null, 0.95, 1.6));
    for (const f of [146.8, 174.6, 220, 207.7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const v = ctx.createOscillator(), vg = ctx.createGain(); v.frequency.value = 5 + Math.random(); vg.gain.value = 2.5;
      v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 3.6);
      o.connect(f1); o.connect(f2); o.start(t); o.stop(t + 3.6);
    }
  }
  puff(pos) {
    const t = this.t, n = this.noiseSrc(), l = this.filt('lowpass', 900), e = this.ctx.createGain();
    this.env(e, t, 0.01, 0.25, 0.25); n.connect(l); l.connect(e); e.connect(this.out(pos, 0.5)); n.start(t); n.stop(t + 0.4);
  }
  click() {
    const t = this.t, o = this.ctx.createOscillator(), e = this.ctx.createGain();
    o.frequency.value = 2200; this.env(e, t, 0.001, 0.12, 0.03); o.connect(e); e.connect(this.out(null, 0.1)); o.start(t); o.stop(t + 0.06);
  }
  shriek(pos) {   // het wezen wordt verjaagd
    const ctx = this.ctx, t = this.t, out = this.out(pos, 0.8, 2.2), ws = this._dist(), e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.5, t + 0.05); e.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    ws.connect(e); e.connect(out);
    for (const f of [620, 655, 930]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.35, t + 1.3);
      o.connect(ws); o.start(t); o.stop(t + 1.5);
    }
  }
}
