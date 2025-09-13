import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import { exec } from "child_process";
// @ts-ignore (suppress type checking; this comment tells TS to treat it as any and compile anyway)
import * as WavEncoder from "wav-encoder";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const server = new McpServer({
  name: "retro-synth",
  version: "1.0.0",
});

// --- Synth Helper Functions ---

function generateWaveform(freq: number, lengthSec: number, sampleRate: number, type: "sine" | "square" | "saw" = "sine"): Float32Array {
  const totalSamples = Math.floor(lengthSec * sampleRate);
  const buffer = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    switch (type) {
      case "sine": sample = Math.sin(2 * Math.PI * freq * t); break;
      case "square": sample = Math.sign(Math.sin(2 * Math.PI * freq * t)); break;
      case "saw": sample = 2 * (t * freq - Math.floor(t * freq + 0.5)); break;
    }

    // Simple ADSR envelope (attack/decay)
    const attack = Math.min(0.1, t / 0.1);
    const decay = Math.max(0, 1 - t / lengthSec);
    buffer[i] = sample * attack * decay * 0.2; // scale volume
  }

  return buffer;
}

function combineBuffers(buffers: Float32Array[]): Float32Array {
  const length = Math.max(...buffers.map((b) => b.length));
  const out = new Float32Array(length);

  buffers.forEach((buf) => {
    for (let i = 0; i < buf.length; i++) {
      out[i] += buf[i];
    }
  });

  // normalize
  const max = Math.max(...out.map((v) => Math.abs(v)));
  if (max > 1) {
    for (let i = 0; i < out.length; i++) out[i] /= max;
  }

  return out;
}

function generateNoteBuffer(freq: number, noteLength: number, sampleRate: number): Float32Array {
  const totalSamples = Math.floor(noteLength * sampleRate);
  const buffer = new Float32Array(totalSamples);

  if (freq === 0) return buffer; // rest

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    // layered waveforms
    const sine = Math.sin(2 * Math.PI * freq * t);
    const square = Math.sign(Math.sin(2 * Math.PI * freq * t * 1.01)); // slight detune
    const saw = 2 * (t * freq * 0.99 - Math.floor(t * freq * 0.99 + 0.5));

    // ADSR envelope
    const attack = Math.min(0.1, t / 0.1);
    const decay = Math.max(0, 1 - t / noteLength);

    buffer[i] = (sine + square + saw) * 0.2 * attack * decay;
  }

  return buffer;
}

async function synthesizeAndPlayRetroTrack(tone: string): Promise<string> {
  const sampleRate = 44100;
  const noteLength = 0.5;
  const patternRepeats = 4;

  const tones: Record<string, number[]> = {
    happy: [262, 330, 392, 494],
    dark: [131, 156, 196, 233],
    mysterious: [262, 311, 370, 440],
  };

  const baseNotes = tones[tone] || tones["mysterious"];
  const sequence: number[] = [];

  for (let r = 0; r < patternRepeats; r++) {
    for (let n = 0; n < baseNotes.length; n++) {
      sequence.push(baseNotes[n], baseNotes[n] * 2, baseNotes[n] * 0.5, 0);
    }
  }

  const totalSamples = Math.floor(noteLength * sequence.length * sampleRate);
  const trackBuffer = new Float32Array(totalSamples);

  sequence.forEach((freq, idx) => {
    const startSample = Math.floor(idx * noteLength * sampleRate);
    const noteBuffer = generateNoteBuffer(freq, noteLength, sampleRate);

    for (let i = 0; i < noteBuffer.length && startSample + i < trackBuffer.length; i++) {
      trackBuffer[startSample + i] += noteBuffer[i];
    }
  });

  // normalize once
  // old (stack overflow for large arrays)
  // const max = Math.max(...trackBuffer.map((v) => Math.abs(v)));
  // new (safe)
  let max = 0;
  for (let i = 0; i < trackBuffer.length; i++) {
    const absVal = Math.abs(trackBuffer[i]);
    if (absVal > max) max = absVal;
  }

  if (max > 1) {
    for (let i = 0; i < trackBuffer.length; i++) trackBuffer[i] /= max;
  }

  const audioData = { sampleRate, channelData: [trackBuffer] };
  const wav = await WavEncoder.encode(audioData);

  const filePath = path.join(os.tmpdir(), `retro_${tone}_${Date.now()}.wav`);
  fs.writeFileSync(filePath, Buffer.from(wav));

  const { spawn } = await import("child_process");
  const playerCmd = process.platform === "darwin" ? "afplay" : "mpg123";
  const playerProcess = spawn(playerCmd, [filePath], { stdio: "ignore", detached: true });
  playerProcess.unref();

  return filePath;
}


// --- MCP Tool ---
server.tool(
  "play_retro_music",
  "Generate and immediately play retro synth music",
  {
    tone: z.string().describe("Tone of the track (happy, dark, mysterious)"),
  },
  async ({ tone }) => {
    try {
      const filePath = await synthesizeAndPlayRetroTrack(tone);

      // Persistent playback
      const playerCmd = process.platform === "darwin" ? "afplay" : "mpg123";
      const playerProcess = spawn(playerCmd, [filePath], { stdio: "ignore", detached: true });
      playerProcess.unref();

      return {
        content: [
          { type: "text", text: `Playing retro synth track '${tone}' at ${filePath}...` },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `Failed to play retro synth: ${err}` },
        ],
      };
    }
  }
);


// --- Main Entrypoint ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🎵 Retro Synth MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
