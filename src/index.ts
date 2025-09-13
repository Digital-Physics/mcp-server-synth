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
  name: "sample-synth",
  version: "1.3.0",
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

function mixBuffers(buffers: Float32Array[], offsets: number[]): Float32Array {
  const length = Math.max(...buffers.map((b, i) => b.length + offsets[i]));
  const track = new Float32Array(length);

  buffers.forEach((buf, i) => {
    const offset = offsets[i];
    for (let j = 0; j < buf.length; j++) {
      track[offset + j] += buf[j];
    }
  });

  let max = 0;
  for (let i = 0; i < track.length; i++) {
    const absVal = Math.abs(track[i]);
    if (absVal > max) max = absVal;
  }
  if (max > 1) for (let i = 0; i < track.length; i++) track[i] /= max;

  return track;
}

// --- Utility to list files in a subfolder ---
function getSamplesFromFolder(folderName: string): string[] {
  const dir = path.resolve(__dirname, "../samples", folderName);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".wav"))
    .map(f => path.join(folderName, f)); // relative to samples root
}

// --- Generate sequence dynamically ---
function getSampleSequence(tone: string, repeats = 8) {
  const kicks = getSamplesFromFolder("kick");
  const snares = getSamplesFromFolder("snare");
  const basses = getSamplesFromFolder("bass");
  const chords = getSamplesFromFolder("chord");

  const sequence: { sample: string; time: number }[] = [];

  for (let r = 0; r < repeats; r++) {
    const offset = r * 1.0; // 1 second per repeat

    // kick (random each bar)
    if (kicks.length > 0) {
      const kick = kicks[Math.floor(Math.random() * kicks.length)];
      sequence.push({ sample: kick, time: offset });
    }

    // snare (backbeat)
    if (snares.length > 0) {
      const snare = snares[Math.floor(Math.random() * snares.length)];
      sequence.push({ sample: snare, time: offset + 0.5 });
    }

    // bass (optional every beat)
    if (basses.length > 0) {
      const bass = basses[Math.floor(Math.random() * basses.length)];
      sequence.push({ sample: bass, time: offset });
      sequence.push({ sample: bass, time: offset + 0.5 });
    }

    // chord (longer sustain, once per bar)
    if (chords.length > 0) {
      const chord = chords[Math.floor(Math.random() * chords.length)];
      sequence.push({ sample: chord, time: offset });
    }
  }

  return sequence;
}

// --- Generate WAV track ---
async function generateSampledTrackFile(tone: string): Promise<string> {
  const sampleRate = 44100;
  const sampleFolder = path.resolve(__dirname, "../samples");
  const sequence = getSampleSequence(tone, 8);

  const buffers: Float32Array[] = [];
  const offsets: number[] = [];

  for (const event of sequence) {
    const samplePath = path.join(sampleFolder, event.sample);
    if (!fs.existsSync(samplePath)) {
      console.warn(`Missing sample ${event.sample}, skipping.`);
      continue;
    }
    const sampleBuffer = await loadSample(samplePath, sampleRate);
    buffers.push(sampleBuffer);
    offsets.push(Math.floor(event.time * sampleRate));
  }

  const trackBuffer = mixBuffers(buffers, offsets);
  const audioData = { sampleRate, channelData: [trackBuffer] };
  const wav = await WavEncoder.encode(audioData);

  const filePath = path.join(os.tmpdir(), `sampled_${tone}_${Date.now()}.wav`);
  fs.writeFileSync(filePath, Buffer.from(wav));
  return filePath;
}

// --- Play audio asynchronously ---
function playAudioAsync(filePath: string) {
  const playerCmd = process.platform === "darwin" ? "afplay" : "mpg123";
  const child = spawn(playerCmd, [filePath], { stdio: "ignore", detached: true });
  child.unref();
}

// --- MCP Tool ---
server.tool(
  "play_sampled_music",
  "Play sampled music while LLM types",
  {
    tone: z.string().describe("Tone of the track (happy, dark, mysterious)"),
  },
  async ({ tone }) => {
    try {
      const filePath = await generateSampledTrackFile(tone);
      playAudioAsync(filePath);
      return {
        content: [{ type: "text", text: `Playing '${tone}' track with random samples...` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to play sampled track: ${err}` }],
      };
    }
  }
);

// --- Main Entrypoint ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🎵 Sample Synth MCP Server running on stdio with dynamic samples");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
