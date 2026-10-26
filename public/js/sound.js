// ── HeyWork: Zero-Asset Web Audio Ambient Synthesizer ──
const AmbientAudio = {
  ctx: null,
  activeSource: null,
  activeType: null,
  gainNode: null,

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  play(type) {
    this.init();
    if (!this.ctx) return;
    this.stop();

    if (type === 'none') {
      this.activeType = null;
      return;
    }

    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds looping buffer
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let lastOut = 0.0;
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      if (type === 'white') {
        data[i] = white * 0.15;
      } else if (type === 'brown') {
        // Brown noise (integrated white noise)
        lastOut = (lastOut + (0.02 * white)) / 1.02;
        data[i] = lastOut * 1.5;
      } else if (type === 'rain') {
        // Pink noise base with gentle filtering
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        data[i] = pink * 0.08;
      }
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.setValueAtTime(0.3, this.ctx.currentTime);

    if (type === 'rain') {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, this.ctx.currentTime);
      source.connect(filter);
      filter.connect(this.gainNode);
    } else {
      source.connect(this.gainNode);
    }

    this.gainNode.connect(this.ctx.destination);
    source.start();
    this.activeSource = source;
    this.activeType = type;
  },

  stop() {
    if (this.activeSource) {
      try {
        this.activeSource.stop();
        this.activeSource.disconnect();
      } catch {}
      this.activeSource = null;
    }
    this.activeType = null;
  },

  // Play a gentle meditation bell chime on focus timer completion
  playChime() {
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(528, t); // Solfeggio 528Hz love/clarity frequency
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1056, t);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 3.0);
    osc2.stop(t + 3.0);
  }
};
