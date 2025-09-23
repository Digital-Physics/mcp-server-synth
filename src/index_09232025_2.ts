import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
// @ts-ignore
import * as WavEncoder from "wav-encoder";
// @ts-ignore
import WavDecoder from "wav-decoder";
import { fileURLToPath } from "url";

// --- ESM __dirname hack ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- MCP Server ---
const server = new McpServer({
  name: "layered-synth",
  version: "2.0.0",
});

// --- Helper Functions ---
async function loadSample(filePath: string, targetSampleRate: number): Promise<Float32Array> {
  if (!fs.existsSync(filePath)) throw new Error(`Sample not found: ${filePath}`);
  const buffer = fs.readFileSync(filePath);
  const audioData = await WavDecoder.decode(buffer);
  const channelData = audioData.channelData[0];
  const resampled = new Float32Array(Math.floor(channelData.length * targetSampleRate / audioData.sampleRate));
  for (let i = 0; i < resampled.length; i++) {
    resampled[i] = channelData[Math.floor(i * audioData.sampleRate / targetSampleRate)];
  }
  return resampled;
}

// --- DSP helpers ---
function pitchShift(buffer: Float32Array, semitones: number): Float32Array {
  const ratio = Math.pow(2, semitones / 12);
  const newLength = Math.floor(buffer.length / ratio);
  const shifted = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    shifted[i] = buffer[Math.floor(i * ratio)];
  }
  return shifted;
}

function reverseBuffer(buffer: Float32Array): Float32Array {
  return Float32Array.from(buffer).reverse();
}

function addDelay(buffer: Float32Array, delaySamples: number, feedback = 0.3): Float32Array {
  const out = new Float32Array(buffer.length + delaySamples);
  for (let i = 0; i < buffer.length; i++) {
    out[i] += buffer[i];
    if (i + delaySamples < out.length) {
      out[i + delaySamples] += buffer[i] * feedback;
    }
  }
  return out;
}

function blendBuffers(a: Float32Array, b: Float32Array, mix = 0.5): Float32Array {
  const length = Math.max(a.length, b.length);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const va = i < a.length ? a[i] : 0;
    const vb = i < b.length ? b[i] : 0;
    out[i] = va * (1 - mix) + vb * mix;
  }
  return out;
}

function maybeMutateBuffer(buffer: Float32Array, sampleRate: number): Float32Array {
  let out = buffer;

  // 25% chance of pitch-shift
  if (Math.random() < 0.25) {
    const semitones = [-5, -3, -2, 2, 3, 5][Math.floor(Math.random() * 6)];
    out = pitchShift(out, semitones);
  }

  // 10% chance of reverse
  if (Math.random() < 0.1) {
    out = reverseBuffer(out);
  }

  // 20% chance of echo
  if (Math.random() < 0.2) {
    const delay = Math.floor(sampleRate * 0.25); // quarter-beat delay
    out = addDelay(out, delay, 0.35);
  }

  return out;
}

function mixBuffers(buffers: Float32Array[], offsets: number[]): Float32Array {
  const length = Math.max(...buffers.map((b, i) => b.length + offsets[i]));
  const track = new Float32Array(length);

  buffers.forEach((buf, i) => {
    const offset = offsets[i];
    for (let j = 0; j < buf.length; j++) {
      track[offset + j] += buf[j];
    }
  });

  // normalize
  let max = 0;
  for (let i = 0; i < track.length; i++) {
    const absVal = Math.abs(track[i]);
    if (absVal > max) max = absVal;
  }
  if (max > 1) {
    for (let i = 0; i < track.length; i++) track[i] /= max;
  }

  return track;
}

function getSamplesFromFolder(folderName: string): string[] {
  const dir = path.resolve(__dirname, "../samples", folderName);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".wav"))
    .map(f => path.join(folderName, f));
}

// --- Music Data Structures ---
interface AudioEvent {
  samplePath: string;
  time: number;
}

interface Track {
  name: string;
  events: AudioEvent[];
}

// --- Composition Logic ---
function getComposition(tone: string, repeats = 32): Track[] {
  const allSamples = {
    kicks: getSamplesFromFolder("kick"),
    snares: getSamplesFromFolder("snare"),
    hihats: getSamplesFromFolder("hihat"),
    basses: getSamplesFromFolder("bass"),
    chords: getSamplesFromFolder("chord"),
  };

  const tracks: Track[] = [];
  const swing = 0.05; // 5% delay on off-beats

  // Track 1: Drums
  if (allSamples.kicks.length > 0 || allSamples.snares.length > 0) {
    const drumTrack: AudioEvent[] = [];
    for (let r = 0; r < repeats; r++) {
      const offset = r * 1.0;

      // Kicks
      if (allSamples.kicks.length > 0) {
        const kick = allSamples.kicks[Math.floor(Math.random() * allSamples.kicks.length)];
        drumTrack.push({ samplePath: kick, time: offset });
        if (Math.random() > 0.7) {
          drumTrack.push({ samplePath: kick, time: offset + 0.25 });
        }
      }

      // Snares
      if (allSamples.snares.length > 0) {
        const snare = allSamples.snares[Math.floor(Math.random() * allSamples.snares.length)];
        drumTrack.push({ samplePath: snare, time: offset + 0.5 + (Math.random() > 0.5 ? swing : 0) });
      }

      // Hi-hats with swing
      if (allSamples.hihats.length > 0) {
        for (let step = 0.25; step < 1.0; step += 0.25) {
          if (Math.random() > 0.4) {
            const hihat = allSamples.hihats[Math.floor(Math.random() * allSamples.hihats.length)];
            const time = offset + step + ((step === 0.25 || step === 0.75) ? swing : 0);
            drumTrack.push({ samplePath: hihat, time });
          }
        }
      }
    }
    tracks.push({ name: "drums", events: drumTrack });
  }

  // Track 2: Bass
  if (allSamples.basses.length > 0) {
    const bassTrack: AudioEvent[] = [];
    for (let r = 0; r < repeats; r++) {
      const offset = r * 1.0;
      const bass = allSamples.basses[Math.floor(Math.random() * allSamples.basses.length)];
      bassTrack.push({ samplePath: bass, time: offset });
      if (Math.random() > 0.6) {
        bassTrack.push({ samplePath: bass, time: offset + 0.5 });
      }
    }
    tracks.push({ name: "bass", events: bassTrack });
  }

  // Track 3: Chords
  if (allSamples.chords.length > 0) {
    const chordTrack: AudioEvent[] = [];
    for (let r = 0; r < repeats; r += Math.floor(2 + Math.random() * 2)) {
      const offset = r * 1.0;
      const chord = allSamples.chords[Math.floor(Math.random() * allSamples.chords.length)];
      chordTrack.push({ samplePath: chord, time: offset });
      if (Math.random() > 0.7) {
        chordTrack.push({ samplePath: chord, time: offset + 0.5 });
      }
    }
    tracks.push({ name: "chords", events: chordTrack });
  }

  return tracks;
}

// --- Generate WAV track ---
async function generateLayeredTrackFile(tone: string): Promise<string> {
  const sampleRate = 44100;
  const sampleFolder = path.resolve(__dirname, "../samples");
  const tracks = getComposition(tone, 32);

  const buffers: Float32Array[] = [];
  const offsets: number[] = [];

  for (const track of tracks) {
    for (const event of track.events) {
      const samplePath = path.join(sampleFolder, event.samplePath);
      if (!fs.existsSync(samplePath)) {
        console.warn(`Missing sample ${event.samplePath}, skipping.`);
        continue;
      }
      let sampleBuffer = await loadSample(samplePath, sampleRate);

      // Random processing
      sampleBuffer = maybeMutateBuffer(sampleBuffer, sampleRate);

      // Occasionally blend two samples of the same type
      if (Math.random() < 0.15) {
        const folder = path.dirname(event.samplePath);
        const candidates = getSamplesFromFolder(path.basename(folder));
        if (candidates.length > 1) {
          const otherPath = path.join(sampleFolder, candidates[Math.floor(Math.random() * candidates.length)]);
          if (fs.existsSync(otherPath)) {
            const otherBuffer = await loadSample(otherPath, sampleRate);
            sampleBuffer = blendBuffers(sampleBuffer, otherBuffer, 0.5);
          }
        }
      }

      buffers.push(sampleBuffer);
      offsets.push(Math.floor(event.time * sampleRate));
    }
  }

  const trackBuffer = mixBuffers(buffers, offsets);
  const audioData = { sampleRate, channelData: [trackBuffer] };
  const wav = await WavEncoder.encode(audioData);

  const filePath = path.join(os.tmpdir(), `layered_${tone}_${Date.now()}.wav`);
  fs.writeFileSync(filePath, Buffer.from(wav));
  return filePath;
}

// --- Play audio async ---
function playAudioAsync(filePath: string) {
  const playerCmd = process.platform === "darwin" ? "afplay" : "mpg123";
  const child = spawn(playerCmd, [filePath], { stdio: "ignore", detached: true });
  child.unref();
}

// --- MCP Tool ---
server.tool(
  "play_layered_music",
  "Play music with multiple layered tracks, effects, and variation.",
  {
    tone: z.string().describe("Tone of the track (e.g., happy, dark, mysterious, etc.)"),
  },
  async ({ tone }) => {
    try {
      const filePath = await generateLayeredTrackFile(tone);
      playAudioAsync(filePath);
      return {
        content: [{ type: "text", text: `🎶 Playing '${tone}' track with pitch, effects, and layering...` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to play track: ${err}` }],
      };
    }
  }
);

// --- Main Entrypoint ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🎵 Layered Synth MCP Server running with new effects & variation");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
