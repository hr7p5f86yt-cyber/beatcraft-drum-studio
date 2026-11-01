// e2e-samples.js 用の試験音(合成した短い wav)を out/wav に作る。  使い方: node test/make-wavs.js
const D = require("../src/drumsynth.js"), fs = require("fs");
fs.mkdirSync("out/wav", { recursive: true });
function wav(f, x, sr) { const b = Buffer.alloc(44 + x.length * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(x.length * 2, 40); for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + 2 * i); fs.writeFileSync(f, b); }
[0, 1, 2].forEach(l => wav(`out/wav/hihat_closed_${l + 1}.wav`, D.synthDrum("hh_close", l, 0, 44100), 44100));
wav("out/wav/crash_1.wav", D.synthDrum("crash", 1, 0, 44100), 44100); wav("out/wav/mystery.wav", D.synthDrum("kick", 1, 0, 44100), 44100);
