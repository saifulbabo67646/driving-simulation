// Small WebAudio sound set + Japanese voice instructions (speechSynthesis).

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.voice = true;
    this.jaVoice = null;
    if ('speechSynthesis' in window) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this.jaVoice = vs.find((v) => /ja[-_]JP/i.test(v.lang)) || null;
        this.enVoice = vs.find((v) => /en[-_]/i.test(v.lang)) || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    }
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(c.destination);
    // engine: two detuned saws through a low-pass
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    this.engLp = lp;
    this.osc1 = c.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = c.createOscillator(); this.osc2.type = 'square';
    this.osc1.connect(lp); this.osc2.connect(lp);
    lp.connect(this.engGain); this.engGain.connect(this.master);
    this.osc1.start(); this.osc2.start();
    // road noise
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = c.createBufferSource();
    this.noise.buffer = buf; this.noise.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 600;
    this.noiseGain = c.createGain(); this.noiseGain.gain.value = 0;
    this.noise.connect(nf); nf.connect(this.noiseGain); this.noiseGain.connect(this.master);
    this.noise.start();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  engine(speedKmh, throttle, running) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = 750 + speedKmh * 38 + throttle * 900;
    const f = rpm / 60 * 2;
    this.osc1.frequency.setTargetAtTime(f, t, 0.08);
    this.osc2.frequency.setTargetAtTime(f * 0.5 + 1.3, t, 0.08);
    this.engLp.frequency.setTargetAtTime(300 + throttle * 600 + speedKmh * 6, t, 0.1);
    this.engGain.gain.setTargetAtTime(this.enabled && running ? 0.05 + throttle * 0.05 : 0, t, 0.1);
    this.noiseGain.gain.setTargetAtTime(this.enabled ? Math.min(0.12, speedKmh / 400) : 0, t, 0.2);
  }

  click(high = true) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = high ? 2400 : 1700;
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.04);
  }

  chime(bad = true) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    [0, 0.16].forEach((dt, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = bad ? (i ? 440 : 554) : (i ? 880 : 660);
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.25, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.35);
      o.connect(g); g.connect(this.master);
      o.start(t + dt); o.stop(t + dt + 0.4);
    });
  }

  bump() {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.22);
  }

  speak(ja, en, lang = 'ja') {
    if (!this.voice || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const useJa = lang !== 'en' && (this.jaVoice || lang === 'ja');
    const u = new SpeechSynthesisUtterance(useJa ? ja : en);
    u.lang = useJa ? 'ja-JP' : 'en-US';
    if (useJa && this.jaVoice) u.voice = this.jaVoice;
    if (!useJa && this.enVoice) u.voice = this.enVoice;
    u.rate = 1.0;
    speechSynthesis.speak(u);
  }
}
