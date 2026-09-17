/**
 * MMIP Speech Filter Lab - Production Grade DSP & Interactive UI Engine
 * Multimedia Information Processing (Speech Noise Filtering & Spectral Analytics)
 */

class SpeechFilterEngine {
  constructor() {
    this.sampleRate = 44100;
    this.audioCtx = null;
    
    // Audio Buffers
    this.cleanBuffer = null;     // Float32Array (Original Speech)
    this.noisyBuffer = null;     // Float32Array (Noisy Speech)
    this.filteredBuffer = null;  // Float32Array (Filtered Speech)
    
    // Playback State
    this.activeSourceNode = null;
    this.isPlaying = false;
    this.playbackStartTime = 0;
    this.playbackOffset = 0;
    this.currentPlayMode = 'filtered'; // 'filtered', 'noisy', 'original'
    this.scrubberAnimId = null;

    // Filter Parameters
    this.filterMode = 'lowpass';   // 'lowpass', 'highpass', 'bandpass', 'notch'
    this.filterTopology = 'butterworth'; // 'butterworth', 'ideal', 'gaussian'
    this.filterOrder = 2;
    this.cutoffLow = 3400;         // Fc for LPF/HPF, or Fl for BPF
    this.cutoffHigh = 3400;        // Fh for BPF
    this.filterQ = 0.707;          // Quality factor

    // Noise Generator Parameters
    this.noiseHiss = 0.30;         // High-freq noise (>4kHz)
    this.noiseHum = 0.20;          // 50Hz/60Hz mains hum
    this.noiseWhite = 0.10;        // White noise

    // Mic Recorder State
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.recordingStartTime = 0;
    this.recordingTimerInterval = null;
    this.micStream = null;
    this.micAnalyser = null;
    this.micAnimId = null;

    // Active Visualization View
    this.currentViz = 'dual';  // 'dual' (Time & DFT), 'spectrum', 'waveform', 'spectrogram'

    this.initAudioContext();
    this.setupUIEventListeners();
    
    // Ensure canvas dimensions on startup
    window.addEventListener('resize', () => {
      this.renderBodePlot();
      this.renderVisualizer();
    });

    // Load initial speech sample
    setTimeout(() => {
      this.generateDefaultSample('counting');
    }, 100);
  }

  initAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContextClass({ sampleRate: this.sampleRate });
  }

  ensureAudioContext() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  // ==========================================
  // 1. SPEECH SYNTHESIS & SIGNAL GENERATION
  // ==========================================

  generateDefaultSample(type) {
    const duration = 3.5; // seconds
    const numSamples = Math.floor(this.sampleRate * duration);
    this.cleanBuffer = new Float32Array(numSamples);

    if (type === 'counting') {
      // Synthesize Speech Counting: "1, 2, 3, 4, 5" with vocal formants
      const words = [
        { start: 0.2, end: 0.7, pitch: 130, formants: [700, 1200, 2600] }, // "One"
        { start: 0.9, end: 1.4, pitch: 125, formants: [300, 2200, 3000] }, // "Two"
        { start: 1.6, end: 2.1, pitch: 120, formants: [300, 2300, 3100] }, // "Three"
        { start: 2.3, end: 2.8, pitch: 115, formants: [600, 1000, 2500] }, // "Four"
        { start: 3.0, end: 3.4, pitch: 110, formants: [350, 2000, 2800] }  // "Five"
      ];
      this.synthesizeFormantSpeech(words, numSamples);
    } else if (type === 'sentence') {
      const words = [
        { start: 0.2, end: 0.8, pitch: 140, formants: [500, 1500, 2500] },
        { start: 0.9, end: 1.5, pitch: 135, formants: [300, 2000, 2800] },
        { start: 1.6, end: 2.2, pitch: 130, formants: [700, 1100, 2600] },
        { start: 2.3, end: 3.2, pitch: 125, formants: [400, 1800, 2700] }
      ];
      this.synthesizeFormantSpeech(words, numSamples);
    } else if (type === 'vowel-sweep') {
      for (let i = 0; i < numSamples; i++) {
        const t = i / this.sampleRate;
        const pitch = 120 + 10 * Math.sin(2 * Math.PI * 1.5 * t);
        const f1 = 400 + 300 * Math.sin(2 * Math.PI * 0.8 * t);
        const f2 = 1500 + 700 * Math.cos(2 * Math.PI * 0.8 * t);
        const f3 = 2600;

        const glottal = Math.pow(Math.sin(Math.PI * (t * pitch % 1)), 2);
        const s1 = Math.sin(2 * Math.PI * f1 * t) * 0.5;
        const s2 = Math.sin(2 * Math.PI * f2 * t) * 0.3;
        const s3 = Math.sin(2 * Math.PI * f3 * t) * 0.2;

        const envelope = 0.5 * (1 - Math.cos(2 * Math.PI * t / duration));
        this.cleanBuffer[i] = glottal * (s1 + s2 + s3) * envelope * 0.6;
      }
    }

    this.processAudioPipeline();
  }

  synthesizeFormantSpeech(wordEvents, numSamples) {
    for (let i = 0; i < numSamples; i++) {
      const t = i / this.sampleRate;
      let sample = 0;

      for (const w of wordEvents) {
        if (t >= w.start && t <= w.end) {
          const dt = t - w.start;
          const dur = w.end - w.start;
          const env = Math.sin(Math.PI * (dt / dur));

          const pitch = w.pitch + 5 * Math.sin(2 * Math.PI * 3 * dt);
          const phase = (dt * pitch) % 1;
          const glottalPulse = Math.exp(-phase * 4) * Math.sin(2 * Math.PI * phase);

          const f1 = Math.sin(2 * Math.PI * w.formants[0] * dt) * 0.5;
          const f2 = Math.sin(2 * Math.PI * w.formants[1] * dt) * 0.35;
          const f3 = Math.sin(2 * Math.PI * w.formants[2] * dt) * 0.2;

          let fricative = 0;
          if (dt < 0.08 || dt > dur - 0.08) {
            fricative = (Math.random() * 2 - 1) * 0.25;
          }

          sample += (glottalPulse * (f1 + f2 + f3) + fricative) * env * 0.7;
        }
      }
      this.cleanBuffer[i] = sample;
    }
  }

  synthesizeTextSpeech(text) {
    const duration = Math.max(2.5, text.length * 0.08);
    const numSamples = Math.floor(this.sampleRate * duration);
    this.cleanBuffer = new Float32Array(numSamples);

    const words = text.split(/\s+/).filter(w => w.length > 0);
    const wordDur = (duration - 0.4) / words.length;

    const events = words.map((w, idx) => {
      const start = 0.2 + idx * wordDur;
      const end = start + wordDur * 0.85;
      const pitch = 130 - idx * 2;
      
      const charSum = w.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const f1 = 300 + (charSum % 400);
      const f2 = 1000 + (charSum % 1200);
      const f3 = 2400 + (charSum % 800);

      return { start, end, pitch, formants: [f1, f2, f3] };
    });

    this.synthesizeFormantSpeech(events, numSamples);
    this.processAudioPipeline();
  }

  // ==========================================
  // 2. NOISE GENERATOR ENGINE
  // ==========================================

  applyNoiseEngine() {
    if (!this.cleanBuffer) return;
    const len = this.cleanBuffer.length;
    this.noisyBuffer = new Float32Array(len);

    let hissState = 0;

    for (let i = 0; i < len; i++) {
      const t = i / this.sampleRate;
      const cleanVal = this.cleanBuffer[i];

      // 1. High Frequency Hiss (> 4kHz)
      const rawWhite = (Math.random() * 2 - 1);
      const hissNoise = rawWhite - hissState;
      hissState = rawWhite * 0.5 + hissState * 0.5;

      // 2. Mains Hum (50Hz / 60Hz + harmonics)
      const hum50Hz = Math.sin(2 * Math.PI * 50 * t);
      const hum100Hz = 0.4 * Math.sin(2 * Math.PI * 100 * t);
      const hum150Hz = 0.2 * Math.sin(2 * Math.PI * 150 * t);
      const mainsHum = (hum50Hz + hum100Hz + hum150Hz);

      // 3. Wideband White Noise
      const whiteNoise = (Math.random() * 2 - 1);

      const combinedNoise = 
        (this.noiseHiss * 0.5 * hissNoise) +
        (this.noiseHum * 0.45 * mainsHum) +
        (this.noiseWhite * 0.35 * whiteNoise);

      this.noisyBuffer[i] = cleanVal + combinedNoise;
    }
  }

  // ==========================================
  // 3. DIGITAL FILTER DESIGN & DSP ENGINE
  // ==========================================

  applyFilterEngine() {
    if (!this.noisyBuffer) return;
    const len = this.noisyBuffer.length;
    this.filteredBuffer = new Float32Array(len);

    if (this.filterTopology === 'butterworth') {
      this.applyButterworthIIR();
    } else if (this.filterTopology === 'ideal') {
      this.applyIdealFFTFilter();
    } else if (this.filterTopology === 'gaussian') {
      this.applyGaussianFilter();
    }

    this.computePerformanceMetrics();
  }

  applyButterworthIIR() {
    const fs = this.sampleRate;
    const order = parseInt(this.filterOrder, 10);
    const numSections = Math.ceil(order / 2);
    const biquads = [];

    const fc = Math.min(this.cutoffLow, fs * 0.49);
    const fh = Math.min(this.cutoffHigh, fs * 0.49);

    for (let k = 0; k < numSections; k++) {
      const theta = Math.PI * (2 * k + 1) / (2 * order);
      const Qk = this.filterQ / (2 * Math.sin(theta));

      let biquad;
      if (this.filterMode === 'lowpass') {
        biquad = this.computeBiquadCoeffs('lowpass', fc, fs, Qk);
      } else if (this.filterMode === 'highpass') {
        biquad = this.computeBiquadCoeffs('highpass', fc, fs, Qk);
      } else if (this.filterMode === 'bandpass') {
        const centerFreq = Math.sqrt(fc * fh);
        const bw = Math.max(10, Math.abs(fh - fc));
        const Qb = centerFreq / bw;
        biquad = this.computeBiquadCoeffs('bandpass', centerFreq, fs, Qb);
      } else if (this.filterMode === 'notch') {
        biquad = this.computeBiquadCoeffs('notch', fc, fs, Qk * 2.0);
      }
      biquads.push(biquad);
    }

    let currentSignal = new Float32Array(this.noisyBuffer);
    const len = currentSignal.length;

    for (const bq of biquads) {
      const nextSignal = new Float32Array(len);
      let s1 = 0, s2 = 0;

      for (let i = 0; i < len; i++) {
        const x = currentSignal[i];
        const y = bq.b0 * x + s1;
        s1 = bq.b1 * x - bq.a1 * y + s2;
        s2 = bq.b2 * x - bq.a2 * y;
        nextSignal[i] = y;
      }
      currentSignal = nextSignal;
    }

    this.filteredBuffer = currentSignal;
  }

  computeBiquadCoeffs(type, fc, fs, Q) {
    const w0 = 2 * Math.PI * fc / fs;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = sinw0 / (2 * Q);

    let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

    if (type === 'lowpass') {
      b0 = (1 - cosw0) / 2;
      b1 = 1 - cosw0;
      b2 = (1 - cosw0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cosw0) / 2;
      b1 = -(1 + cosw0);
      b2 = (1 + cosw0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
    } else if (type === 'bandpass') {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
    } else if (type === 'notch') {
      b0 = 1;
      b1 = -2 * cosw0;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
    }

    return {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: a1 / a0,
      a2: a2 / a0
    };
  }

  applyIdealFFTFilter() {
    const blockSize = 2048;
    const hopSize = 1024;
    const numSamples = this.noisyBuffer.length;
    this.filteredBuffer = new Float32Array(numSamples);

    const fc1 = this.cutoffLow;
    const fc2 = this.cutoffHigh;
    const binWidth = this.sampleRate / blockSize;

    for (let pos = 0; pos < numSamples - blockSize; pos += hopSize) {
      const real = new Float32Array(blockSize);
      const imag = new Float32Array(blockSize);

      for (let i = 0; i < blockSize; i++) {
        const win = 0.5 * (1 - Math.cos(2 * Math.PI * i / blockSize));
        real[i] = this.noisyBuffer[pos + i] * win;
      }

      this.fft(real, imag);

      for (let k = 0; k < blockSize / 2; k++) {
        const freq = k * binWidth;
        let pass = false;

        if (this.filterMode === 'lowpass' && freq <= fc1) pass = true;
        else if (this.filterMode === 'highpass' && freq >= fc1) pass = true;
        else if (this.filterMode === 'bandpass' && freq >= fc1 && freq <= fc2) pass = true;
        else if (this.filterMode === 'notch' && (freq < fc1 - 50 || freq > fc1 + 50)) pass = true;

        if (!pass) {
          real[k] = 0; imag[k] = 0;
          real[blockSize - k] = 0; imag[blockSize - k] = 0;
        }
      }

      this.ifft(real, imag);

      for (let i = 0; i < blockSize; i++) {
        this.filteredBuffer[pos + i] += real[i] * 1.5;
      }
    }
  }

  applyGaussianFilter() {
    const fc = this.cutoffLow;
    const sigma = fc / 2.0;
    const len = this.noisyBuffer.length;
    
    const winSize = Math.max(3, Math.floor(this.sampleRate / fc));
    const kernel = new Float32Array(winSize);
    let kSum = 0;
    for (let i = 0; i < winSize; i++) {
      const x = i - winSize / 2;
      kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
      kSum += kernel[i];
    }
    for (let i = 0; i < winSize; i++) kernel[i] /= kSum;

    for (let i = 0; i < len; i++) {
      let sum = 0;
      for (let k = 0; k < winSize; k++) {
        const idx = Math.min(len - 1, Math.max(0, i + k - Math.floor(winSize / 2)));
        sum += this.noisyBuffer[idx] * kernel[k];
      }
      this.filteredBuffer[i] = (this.filterMode === 'highpass') ? this.noisyBuffer[i] - sum : sum;
    }
  }

  fft(real, imag) {
    const n = real.length;
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        let tempR = real[i]; real[i] = real[j]; real[j] = tempR;
        let tempI = imag[i]; imag[i] = imag[j]; imag[j] = tempI;
      }
      let k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }

    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const angle = -2 * Math.PI / len;
      const wStepR = Math.cos(angle);
      const wStepI = Math.sin(angle);

      for (let i = 0; i < n; i += len) {
        let wR = 1, wI = 0;
        for (let k = 0; k < halfLen; k++) {
          const pos = i + k;
          const match = pos + halfLen;

          const uR = real[pos], uI = imag[pos];
          const vR = real[match] * wR - imag[match] * wI;
          const vI = real[match] * wI + imag[match] * wR;

          real[pos] = uR + vR;
          imag[pos] = uI + vI;
          real[match] = uR - vR;
          imag[match] = uI - vI;

          const nextWR = wR * wStepR - wI * wStepI;
          wI = wR * wStepI + wI * wStepR;
          wR = nextWR;
        }
      }
    }
  }

  ifft(real, imag) {
    const n = real.length;
    for (let i = 0; i < n; i++) imag[i] = -imag[i];
    this.fft(real, imag);
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] = -imag[i] / n;
    }
  }

  // ==========================================
  // 4. METRICS & VISUAL ANALYTICS RENDER ENGINE
  // ==========================================

  computePerformanceMetrics() {
    if (!this.cleanBuffer || !this.noisyBuffer || !this.filteredBuffer) return;
    const len = Math.min(this.cleanBuffer.length, this.noisyBuffer.length, this.filteredBuffer.length);

    let pSignal = 0;
    let pNoiseIn = 0;
    let pNoiseOut = 0;

    for (let i = 0; i < len; i++) {
      const s = this.cleanBuffer[i];
      const nin = this.noisyBuffer[i] - s;
      const nout = this.filteredBuffer[i] - s;

      pSignal += s * s;
      pNoiseIn += nin * nin;
      pNoiseOut += nout * nout;
    }

    pSignal /= len;
    pNoiseIn /= len;
    pNoiseOut /= len;

    const snrIn = 10 * Math.log10(Math.max(1e-6, pSignal) / Math.max(1e-6, pNoiseIn));
    const snrOut = 10 * Math.log10(Math.max(1e-6, pSignal) / Math.max(1e-6, pNoiseOut));
    const snrGain = snrOut - snrIn;
    const attenuation = Math.max(0, Math.min(100, (1 - Math.sqrt(pNoiseOut) / Math.sqrt(pNoiseIn)) * 100));

    document.getElementById('metric-snr-in').textContent = (snrIn > 0 ? '+' : '') + snrIn.toFixed(1) + ' dB';
    document.getElementById('metric-snr-out').textContent = (snrOut > 0 ? '+' : '') + snrOut.toFixed(1) + ' dB';
    document.getElementById('metric-snr-gain').textContent = (snrGain > 0 ? '+' : '') + snrGain.toFixed(1) + ' dB';
    document.getElementById('metric-attenuation').textContent = attenuation.toFixed(1) + '%';
    document.getElementById('noise-level-badge').textContent = 'Input SNR: ' + snrIn.toFixed(1) + ' dB';

    // Update total duration time display
    const totalDurationSec = len / this.sampleRate;
    document.getElementById('time-total').textContent = this.formatTimeSec(totalDurationSec);
  }

  processAudioPipeline() {
    this.applyNoiseEngine();
    this.applyFilterEngine();
    this.renderBodePlot();
    this.renderVisualizer();
  }

  // Canvas Helper for High-DPI Resolution
  setupCanvas(canvas) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width || canvas.width || 300;
    const height = rect.height || canvas.height || 150;
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    
    const ctx = canvas.getContext('2d');
    ctx.resetTransform();
    ctx.scale(dpr, dpr);
    return { ctx, width, height };
  }

  // ==========================================
  // 5. CANVAS DRAWING ROUTINES
  // ==========================================

  renderBodePlot() {
    const canvas = document.getElementById('canvas-bode');
    const setup = this.setupCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;

    ctx.clearRect(0, 0, width, height);

    // Grid lines & Axis labels
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;

    for (let db = -40; db <= 10; db += 10) {
      const y = height * (1 - (db + 45) / 55);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '9px monospace';
      ctx.fillText(`${db}dB`, 5, y - 2);
    }

    // Draw Magnitude Response H(f) curve
    ctx.beginPath();
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 2.5;

    const fs = this.sampleRate;
    const fc = this.cutoffLow;
    const fh = this.cutoffHigh;
    const Q = this.filterQ;
    const order = this.filterOrder;

    for (let x = 0; x < width; x++) {
      const freq = 20 * Math.pow(20000 / 20, x / width);
      let mag = 1.0;

      if (this.filterMode === 'lowpass') {
        mag = 1.0 / Math.sqrt(1 + Math.pow(freq / fc, 2 * order));
      } else if (this.filterMode === 'highpass') {
        mag = 1.0 / Math.sqrt(1 + Math.pow(fc / freq, 2 * order));
      } else if (this.filterMode === 'bandpass') {
        const center = Math.sqrt(fc * fh);
        const bw = Math.abs(fh - fc);
        const ratio = (freq * freq - center * center) / (freq * bw);
        mag = 1.0 / Math.sqrt(1 + Math.pow(ratio, 2 * (order / 2)));
      } else if (this.filterMode === 'notch') {
        const ratio = (freq * freq - fc * fc) / (freq * (fc / Q));
        mag = Math.abs(ratio) / Math.sqrt(1 + Math.pow(ratio, 2));
      }

      const db = 20 * Math.log10(Math.max(1e-4, mag));
      const y = height * (1 - (db + 45) / 55);

      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Cutoff frequency vertical marker
    const xCut = width * (Math.log(fc / 20) / Math.log(20000 / 20));
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(xCut, 0);
    ctx.lineTo(xCut, height);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ef4444';
    ctx.font = '10px monospace';
    ctx.fillText(`Fc: ${fc}Hz`, Math.min(width - 70, Math.max(10, xCut + 5)), 15);
  }

  renderVisualizer() {
    const dualContainer = document.getElementById('dual-container');
    const vizCanvas = document.getElementById('viz-canvas');
    const specOverlay = document.getElementById('spectrogram-overlay');
    if (!vizCanvas) return;

    if (this.currentViz === 'dual') {
      if (dualContainer) dualContainer.style.display = 'flex';
      vizCanvas.style.display = 'none';
      if (specOverlay) specOverlay.style.display = 'none';

      // 1. Draw Time-Domain Waveform
      const canvasTime = document.getElementById('canvas-time-domain');
      const setupTime = this.setupCanvas(canvasTime);
      if (setupTime) {
        setupTime.ctx.clearRect(0, 0, setupTime.width, setupTime.height);
        this.drawWaveforms(setupTime.ctx, setupTime.width, setupTime.height);
      }

      // 2. Draw DFT Frequency Spectrum
      const canvasDft = document.getElementById('canvas-dft-spectrum');
      const setupDft = this.setupCanvas(canvasDft);
      if (setupDft) {
        setupDft.ctx.clearRect(0, 0, setupDft.width, setupDft.height);
        this.drawFFTSpectrum(setupDft.ctx, setupDft.width, setupDft.height);
      }
      return;
    } else if (this.currentViz === 'spectrogram') {
      if (dualContainer) dualContainer.style.display = 'none';
      vizCanvas.style.display = 'none';
      if (specOverlay) specOverlay.style.display = 'flex';
      this.renderSpectrograms();
      return;
    } else {
      if (dualContainer) dualContainer.style.display = 'none';
      vizCanvas.style.display = 'block';
      if (specOverlay) specOverlay.style.display = 'none';
    }

    const setup = this.setupCanvas(vizCanvas);
    if (!setup) return;
    const { ctx, width, height } = setup;

    ctx.clearRect(0, 0, width, height);

    if (this.currentViz === 'waveform') {
      this.drawWaveforms(ctx, width, height);
    } else if (this.currentViz === 'spectrum') {
      this.drawFFTSpectrum(ctx, width, height);
    }
  }

  drawWaveforms(ctx, width, height) {
    if (!this.cleanBuffer || !this.noisyBuffer || !this.filteredBuffer) return;

    const len = this.cleanBuffer.length;
    const step = Math.ceil(len / width);
    const centerY = height / 2;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY); ctx.lineTo(width, centerY);
    ctx.stroke();

    const drawSignal = (buffer, color, lineWidth, opacity) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = opacity;

      for (let x = 0; x < width; x++) {
        const idx = Math.min(buffer.length - 1, x * step);
        const val = buffer[idx] || 0;
        const y = centerY - val * (height * 0.4);

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    };

    drawSignal(this.noisyBuffer, '#ef4444', 1.0, 0.45);
    drawSignal(this.cleanBuffer, '#10b981', 1.5, 0.75);
    drawSignal(this.filteredBuffer, '#00f2fe', 2.0, 0.95);
  }

  drawFFTSpectrum(ctx, width, height) {
    if (!this.cleanBuffer || !this.noisyBuffer || !this.filteredBuffer) return;

    const fftSize = 1024;
    const realClean = new Float32Array(fftSize);
    const imagClean = new Float32Array(fftSize);
    const realNoisy = new Float32Array(fftSize);
    const imagNoisy = new Float32Array(fftSize);
    const realFiltered = new Float32Array(fftSize);
    const imagFiltered = new Float32Array(fftSize);

    const startIdx = Math.floor(this.cleanBuffer.length / 3);
    for (let i = 0; i < fftSize; i++) {
      const win = 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize));
      realClean[i] = (this.cleanBuffer[startIdx + i] || 0) * win;
      realNoisy[i] = (this.noisyBuffer[startIdx + i] || 0) * win;
      realFiltered[i] = (this.filteredBuffer[startIdx + i] || 0) * win;
    }

    this.fft(realClean, imagClean);
    this.fft(realNoisy, imagNoisy);
    this.fft(realFiltered, imagFiltered);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let db = -80; db <= 0; db += 20) {
      const y = height * (1 - (db + 90) / 95);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      ctx.fillStyle = '#64748b'; ctx.font = '9px monospace';
      ctx.fillText(`${db}dB`, 5, y - 2);
    }

    const drawSpecLine = (real, imag, color, lineWidth) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;

      for (let x = 0; x < width; x++) {
        const bin = Math.floor((x / width) * (fftSize / 2));
        const mag = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]) / fftSize;
        const db = 20 * Math.log10(Math.max(1e-5, mag));
        const y = height * (1 - (db + 90) / 95);

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawSpecLine(realNoisy, imagNoisy, '#ef4444', 1.2);
    drawSpecLine(realClean, imagClean, '#10b981', 1.8);
    drawSpecLine(realFiltered, imagFiltered, '#00f2fe', 2.2);

    const xCut = (this.cutoffLow / (this.sampleRate / 2)) * width;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#ff9900';
    ctx.beginPath(); ctx.moveTo(xCut, 0); ctx.lineTo(xCut, height); ctx.stroke();
    ctx.setLineDash([]);
  }

  renderSpectrograms() {
    this.renderSingleSpectrogram('canvas-spec-noisy', this.noisyBuffer);
    this.renderSingleSpectrogram('canvas-spec-filtered', this.filteredBuffer);
  }

  renderSingleSpectrogram(canvasId, buffer) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !buffer) return;
    const setup = this.setupCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;

    ctx.clearRect(0, 0, width, height);

    const fftSize = 256;
    const hopSize = Math.max(1, Math.floor(buffer.length / width));
    const numBins = fftSize / 2;

    const imgData = ctx.createImageData(width, height);

    for (let x = 0; x < width; x++) {
      const pos = x * hopSize;
      const real = new Float32Array(fftSize);
      const imag = new Float32Array(fftSize);

      for (let i = 0; i < fftSize; i++) {
        if (pos + i < buffer.length) {
          const win = 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize));
          real[i] = buffer[pos + i] * win;
        }
      }

      this.fft(real, imag);

      for (let y = 0; y < height; y++) {
        const bin = Math.floor((1 - y / height) * numBins);
        const mag = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);
        const norm = Math.min(1.0, Math.max(0, (20 * Math.log10(mag + 1e-4) + 60) / 60));

        const r = Math.floor(Math.pow(norm, 0.8) * 255);
        const g = Math.floor(Math.sin(norm * Math.PI) * 200);
        const b = Math.floor((1 - norm) * 180 + norm * 255);

        const pixelIdx = (y * width + x) * 4;
        imgData.data[pixelIdx] = r;
        imgData.data[pixelIdx + 1] = g;
        imgData.data[pixelIdx + 2] = b;
        imgData.data[pixelIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  // ==========================================
  // 6. AUDIO PLAYBACK, SCRUBBER & WAV EXPORT
  // ==========================================

  playActiveAudio() {
    this.ensureAudioContext();
    this.stopPlayback();

    let targetBufferData;
    if (this.currentPlayMode === 'filtered') targetBufferData = this.filteredBuffer;
    else if (this.currentPlayMode === 'noisy') targetBufferData = this.noisyBuffer;
    else targetBufferData = this.cleanBuffer;

    if (!targetBufferData) return;

    const audioBuf = this.audioCtx.createBuffer(1, targetBufferData.length, this.sampleRate);
    audioBuf.getChannelData(0).set(targetBufferData);

    this.activeSourceNode = this.audioCtx.createBufferSource();
    this.activeSourceNode.buffer = audioBuf;
    this.activeSourceNode.connect(this.audioCtx.destination);

    const totalDur = targetBufferData.length / this.sampleRate;
    this.playbackStartTime = this.audioCtx.currentTime - this.playbackOffset;

    this.activeSourceNode.onended = () => {
      this.isPlaying = false;
      this.playbackOffset = 0;
      this.updatePlayButtonUI();
      document.getElementById('scrubber-bar').value = 0;
      document.getElementById('time-current').textContent = '00:00';
      if (this.scrubberAnimId) cancelAnimationFrame(this.scrubberAnimId);
    };

    const startOffset = Math.min(totalDur, this.playbackOffset);
    this.activeSourceNode.start(0, startOffset);
    this.isPlaying = true;
    this.updatePlayButtonUI();

    this.startScrubberLoop(totalDur);
  }

  startScrubberLoop(totalDur) {
    const updateScrubber = () => {
      if (!this.isPlaying) return;
      const elapsed = Math.min(totalDur, this.audioCtx.currentTime - this.playbackStartTime);
      const pct = (elapsed / totalDur) * 100;
      document.getElementById('scrubber-bar').value = pct;
      document.getElementById('time-current').textContent = this.formatTimeSec(elapsed);

      if (elapsed < totalDur) {
        this.scrubberAnimId = requestAnimationFrame(updateScrubber);
      }
    };
    this.scrubberAnimId = requestAnimationFrame(updateScrubber);
  }

  stopPlayback() {
    if (this.activeSourceNode) {
      try { this.activeSourceNode.stop(); } catch (e) {}
      this.activeSourceNode = null;
    }
    if (this.scrubberAnimId) {
      cancelAnimationFrame(this.scrubberAnimId);
      this.scrubberAnimId = null;
    }
    this.isPlaying = false;
    this.updatePlayButtonUI();
  }

  togglePlayback() {
    if (this.isPlaying) this.stopPlayback();
    else this.playActiveAudio();
  }

  updatePlayButtonUI() {
    const btn = document.getElementById('btn-master-play');
    if (!btn) return;
    btn.innerHTML = this.isPlaying ? '<i data-lucide="pause"></i>' : '<i data-lucide="play"></i>';
    lucide.createIcons();
  }

  formatTimeSec(sec) {
    const mins = Math.floor(sec / 60);
    const secs = (sec % 60).toFixed(1);
    const mStr = String(mins).padStart(2, '0');
    const sStr = String(secs).padStart(4, '0');
    return `${mStr}:${sStr}`;
  }

  exportWAVFile() {
    if (!this.filteredBuffer) return;
    const numSamples = this.filteredBuffer.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    this.writeString(view, 8, 'WAVE');

    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, this.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);

    this.writeString(view, 36, 'data');
    view.setUint32(40, numSamples * 2, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, this.filteredBuffer[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `filtered_speech_${this.filterMode}_${this.cutoffLow}Hz.wav`;
    a.click();
    URL.revokeObjectURL(url);
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // ==========================================
  // 7. MICROPHONE RECORDING & LIVE VU METER
  // ==========================================

  startMicRecording() {
    this.ensureAudioContext();

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      this.micStream = stream;
      this.recordedChunks = [];

      // Create live AnalyserNode for live mic visualizer
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.micAnalyser = this.audioCtx.createAnalyser();
      this.micAnalyser.fftSize = 256;
      source.connect(this.micAnalyser);

      // Determine mimeType supported by browser
      let options = {};
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm')) options = { mimeType: 'audio/webm' };
        else if (MediaRecorder.isTypeSupported('audio/ogg')) options = { mimeType: 'audio/ogg' };
      }

      this.mediaRecorder = new MediaRecorder(stream, options);
      this.mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        const blob = new Blob(this.recordedChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
        try {
          const arrayBuf = await blob.arrayBuffer();
          const decodedBuf = await this.audioCtx.decodeAudioData(arrayBuf);
          this.cleanBuffer = decodedBuf.getChannelData(0);
          document.getElementById('mic-status-text').textContent = 'Recording loaded successfully!';
          this.processAudioPipeline();
        } catch (err) {
          console.error('Mic audio decoding error:', err);
          document.getElementById('mic-status-text').textContent = 'Error decoding mic recording.';
        }
      };

      this.mediaRecorder.start(100); // collect 100ms chunks
      this.isRecording = true;
      this.recordingStartTime = Date.now();

      // UI state updates
      document.getElementById('mic-box').classList.add('recording');
      document.getElementById('rec-badge').style.display = 'inline-flex';
      document.getElementById('canvas-mic-live').style.display = 'block';
      document.getElementById('mic-status-text').textContent = 'Recording live speech from microphone...';
      document.getElementById('btn-record-toggle').innerHTML = '<i data-lucide="square"></i> Stop Recording';
      lucide.createIcons();

      // Start Recording Timer Interval (MM:SS.d)
      this.recordingTimerInterval = setInterval(() => {
        const elapsedSec = (Date.now() - this.recordingStartTime) / 1000;
        const mins = Math.floor(elapsedSec / 60);
        const secs = (elapsedSec % 60).toFixed(1);
        const mStr = String(mins).padStart(2, '0');
        const sStr = String(secs).padStart(4, '0');
        document.getElementById('record-timer').textContent = `${mStr}:${sStr}`;
      }, 50);

      // Start Live Mic Canvas Waveform Loop
      this.renderLiveMicCanvas();

    }).catch(err => {
      alert('Microphone access error: ' + err.message);
    });
  }

  stopMicRecording() {
    if (this.isRecording) {
      this.isRecording = false;

      if (this.recordingTimerInterval) {
        clearInterval(this.recordingTimerInterval);
        this.recordingTimerInterval = null;
      }

      if (this.micAnimId) {
        cancelAnimationFrame(this.micAnimId);
        this.micAnimId = null;
      }

      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }

      if (this.micStream) {
        this.micStream.getTracks().forEach(track => track.stop());
        this.micStream = null;
      }

      document.getElementById('mic-box').classList.remove('recording');
      document.getElementById('rec-badge').style.display = 'none';
      document.getElementById('canvas-mic-live').style.display = 'none';
      document.getElementById('btn-record-toggle').innerHTML = '<i data-lucide="mic"></i> Start Recording';
      lucide.createIcons();
    }
  }

  renderLiveMicCanvas() {
    const canvas = document.getElementById('canvas-mic-live');
    if (!canvas || !this.micAnalyser || !this.isRecording) return;

    const setup = this.setupCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;

    const bufferLength = this.micAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const drawLive = () => {
      if (!this.isRecording) return;
      this.micAnalyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(0, 0, width, height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ef4444';
      ctx.beginPath();

      const sliceWidth = width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * (height / 2);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        x += sliceWidth;
      }

      ctx.lineTo(width, height / 2);
      ctx.stroke();

      this.micAnimId = requestAnimationFrame(drawLive);
    };

    drawLive();
  }

  // ==========================================
  // 8. EVENT LISTENERS & UI BINDINGS
  // ==========================================

  setupUIEventListeners() {
    document.getElementById('btn-master-play').addEventListener('click', () => this.togglePlayback());

    document.querySelectorAll('input[name="audio-source"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.currentPlayMode = e.target.value;
        if (this.isPlaying) this.playActiveAudio();
      });
    });

    document.getElementById('preset-total-cancellation').addEventListener('click', () => {
      this.filterMode = 'bandpass';
      this.cutoffLow = 300;
      this.cutoffHigh = 3400;
      this.filterTopology = 'butterworth';
      this.filterOrder = 4;
      this.updateFilterUI();
      this.processAudioPipeline();
    });

    document.getElementById('preset-hiss').addEventListener('click', () => {
      this.filterMode = 'lowpass';
      this.cutoffLow = 3400;
      this.noiseHiss = 0.45;
      this.noiseHum = 0.05;
      this.updateFilterUI();
      this.processAudioPipeline();
    });

    document.getElementById('preset-hum').addEventListener('click', () => {
      this.filterMode = 'highpass';
      this.cutoffLow = 250;
      this.noiseHum = 0.50;
      this.noiseHiss = 0.05;
      this.updateFilterUI();
      this.processAudioPipeline();
    });

    document.getElementById('preset-tele').addEventListener('click', () => {
      this.filterMode = 'bandpass';
      this.cutoffLow = 300;
      this.cutoffHigh = 3400;
      this.noiseHiss = 0.25;
      this.noiseHum = 0.25;
      this.updateFilterUI();
      this.processAudioPipeline();
    });

    document.querySelectorAll('#source-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('#source-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(`tab-${e.target.dataset.tab}`).classList.add('active');
        setTimeout(() => this.renderVisualizer(), 50);
      });
    });

    document.getElementById('btn-generate-synth').addEventListener('click', () => {
      const text = document.getElementById('synth-text').value;
      this.synthesizeTextSpeech(text);
    });

    document.querySelectorAll('.sample-item').forEach(item => {
      item.addEventListener('click', (e) => {
        document.querySelectorAll('.sample-item').forEach(i => i.classList.remove('active'));
        const btn = e.currentTarget;
        btn.classList.add('active');
        this.generateDefaultSample(btn.dataset.sample);
      });
    });

    const bindSlider = (id, targetKey, displayId, isPercent = true) => {
      const slider = document.getElementById(id);
      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this[targetKey] = isPercent ? val / 100 : val;
        document.getElementById(displayId).textContent = isPercent ? `${Math.round(val)}%` : val;
        this.processAudioPipeline();
      });
    };

    bindSlider('noise-hiss', 'noiseHiss', 'val-noise-hiss');
    bindSlider('noise-hum', 'noiseHum', 'val-noise-hum');
    bindSlider('noise-white', 'noiseWhite', 'val-noise-white');

    document.querySelectorAll('.filter-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-mode-btn').forEach(b => b.classList.remove('active'));
        const target = e.currentTarget;
        target.classList.add('active');
        this.filterMode = target.dataset.mode;
        this.updateFilterUI();
        this.processAudioPipeline();
      });
    });

    document.getElementById('filter-topology').addEventListener('change', (e) => {
      this.filterTopology = e.target.value;
      this.processAudioPipeline();
    });

    document.getElementById('filter-order').addEventListener('change', (e) => {
      this.filterOrder = parseInt(e.target.value, 10);
      this.processAudioPipeline();
    });

    document.getElementById('cutoff-freq').addEventListener('input', (e) => {
      this.cutoffLow = parseFloat(e.target.value);
      document.getElementById('val-cutoff-freq').textContent = `${this.cutoffLow} Hz`;
      this.processAudioPipeline();
    });

    document.getElementById('cutoff-high').addEventListener('input', (e) => {
      this.cutoffHigh = parseFloat(e.target.value);
      document.getElementById('val-cutoff-high').textContent = `${this.cutoffHigh} Hz`;
      this.processAudioPipeline();
    });

    document.getElementById('filter-q').addEventListener('input', (e) => {
      this.filterQ = parseFloat(e.target.value);
      document.getElementById('val-filter-q').textContent = `${this.filterQ.toFixed(2)}`;
      this.processAudioPipeline();
    });

    document.querySelectorAll('#viz-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('#viz-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.currentViz = e.target.dataset.viz;
        this.renderVisualizer();
      });
    });

    document.getElementById('btn-record-toggle').addEventListener('click', () => {
      if (this.isRecording) this.stopMicRecording();
      else this.startMicRecording();
    });

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => this.handleFileUpload(e.target.files[0]));

    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = '#00f2fe'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'rgba(0, 242, 254, 0.3)'; });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'rgba(0, 242, 254, 0.3)';
      if (e.dataTransfer.files.length > 0) this.handleFileUpload(e.dataTransfer.files[0]);
    });

    document.getElementById('scrubber-bar').addEventListener('input', (e) => {
      if (this.filteredBuffer) {
        const totalDur = this.filteredBuffer.length / this.sampleRate;
        const pct = parseFloat(e.target.value) / 100;
        this.playbackOffset = pct * totalDur;
        document.getElementById('time-current').textContent = this.formatTimeSec(this.playbackOffset);
        if (this.isPlaying) this.playActiveAudio();
      }
    });

    document.getElementById('btn-export-wav').addEventListener('click', () => this.exportWAVFile());
  }

  updateFilterUI() {
    const isBandpass = this.filterMode === 'bandpass';
    document.getElementById('group-cutoff2').style.display = isBandpass ? 'block' : 'none';
    document.getElementById('filter-mode-badge').textContent = this.filterMode.toUpperCase() + ' FILTER';

    const statusText = isBandpass 
      ? `Passband: ${this.cutoffLow} Hz - ${this.cutoffHigh} Hz` 
      : (this.filterMode === 'lowpass' ? `Passband: 0 - ${this.cutoffLow} Hz` : `Passband: > ${this.cutoffLow} Hz`);
    document.getElementById('response-status').textContent = statusText;

    const cutoffSlider = document.getElementById('cutoff-freq');
    if (cutoffSlider) cutoffSlider.value = this.cutoffLow;
    document.getElementById('val-cutoff-freq').textContent = `${this.cutoffLow} Hz`;
  }

  handleFileUpload(file) {
    if (!file) return;
    document.getElementById('file-info').style.display = 'flex';
    document.getElementById('file-name').textContent = file.name;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.ensureAudioContext();
      this.audioCtx.decodeAudioData(e.target.result, (decodedBuf) => {
        const monoData = decodedBuf.getChannelData(0);
        this.cleanBuffer = new Float32Array(monoData);
        this.processAudioPipeline();
      });
    };
    reader.readAsArrayBuffer(file);
  }
}

// Global App Initialization
window.addEventListener('DOMContentLoaded', () => {
  window.app = new SpeechFilterEngine();
});
