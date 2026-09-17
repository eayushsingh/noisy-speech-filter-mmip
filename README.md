# MMIP Noisy Speech Filter Lab (Low-Pass & High-Pass Signal Processing)

An interactive, production-grade **Multimedia Information Processing (MMIP)** web application for speech noise filtering, spectral analysis, Short-Time Fourier Transform (STFT) spectrograms, and Butterworth low-pass / high-pass filter design.

![MMIP Speech Filter Lab](https://img.shields.io/badge/MMIP-DSP%20Signal%20Processing-00f2fe)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

---

## ✨ Features

- **Multi-Source Speech Input**:
  - **Formant Speech Synthesizer**: Generates acoustic speech formants ($F_1, F_2, F_3$).
  - **Text-to-Speech Engine**: Synthesizes speech from custom text prompts.
  - **Live Microphone Recorder**: Capture speech with live REC timer and real-time audio VU meter.
  - **File Uploader**: Load `.wav` or `.mp3` audio files.

- **Noise Modeling**:
  - **High-Frequency Hiss (> 4 kHz)**: Tape hiss & thermal noise (removed via **Low-Pass Filter**).
  - **Mains Hum (50 Hz / 60 Hz)**: Electrical grid hum (removed via **High-Pass Filter**).
  - **Additive White Gaussian Noise (AWGN)**: Wideband background noise.

- **Digital Filter Architectures**:
  - **Modes**: Low-Pass (LPF), High-Pass (HPF), Band-Pass (BPF 300–3400 Hz), Notch / Band-Stop Filter.
  - **Topologies**: Butterworth IIR ($1^{\text{st}}$ to $8^{\text{th}}$ Order cascaded Biquads), Ideal FFT Cutoff, and Gaussian.
  - **Interactive Bode Response Plot**: Real-time magnitude response curve $|H(f)|$ in dB vs Hz.

- **Dual Time & Frequency Visual Analytics**:
  - **Time-Domain Waveform $x(t)$**: Amplitude vs Time ($s$) comparing Clean, Noisy/Recorded, and Filtered signals.
  - **DFT / FFT Frequency Spectrum $|X(f)|$**: Magnitude ($dB$) vs Frequency ($Hz$) showing cutoff lines.
  - **STFT Spectrogram**: Time-Frequency heatmap (Inferno palette) displaying noise suppression over time.
  - **SNR & Attenuation Metrics**: Input SNR, Output SNR, SNR Gain (+dB), and Noise Attenuation percentage.

- **Audio Player & WAV Export**:
  - A/B audio playback (Filtered vs Noisy vs Clean).
  - 16-bit PCM WAV exporter.

---

## 🛠️ Tech Stack

- **Frontend**: HTML5, Vanilla CSS3 (Dark Glassmorphism UI design), JavaScript (ES6+).
- **DSP Engine**: Web Audio API, Custom Butterworth Biquad IIR filters, Radix-2 FFT / IFFT, STFT Spectrogram engine.
- **Icons & Fonts**: Lucide Icons, Google Fonts (Inter & Fira Code).

---

## 🚀 Quick Start

Host statically using any web server or static host (GitHub Pages, Vercel, Netlify, Nginx, or Python):

```bash
# Clone repository
git clone https://github.com/eayushsingh/noisy-speech-filter-mmip.git
cd noisy-speech-filter-mmip

# Run local HTTP server
python3 -m http.server 8080
```

Open `http://localhost:8080` in your web browser.

---

## 📜 License

MIT License. Free for educational, research, and commercial use.
