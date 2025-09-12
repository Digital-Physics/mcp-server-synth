import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import { exec } from "child_process";
// @ts-ignore (suppress type checking; this comment tells TS to treat it as any and compile anyway)
import * as WavEncoder from "wav-encoder";
import os from "os";
import path from "path";

const server = new McpServer({
  name: "retro-synth",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// --- Retro Synth Helper Functions ---

// Generate a simple sine wave melody
function generateRetroWave(notes: number[], durationSec = 2, sampleRate = 44100): Float32Array {
  const totalSamples = durationSec * sampleRate;
  const buffer = new Float32Array(totalSamples);

  notes.forEach((freq, idx) => {
    const start = Math.floor((idx * totalSamples) / notes.length);
    const end = Math.floor(((idx + 1) * totalSamples) / notes.length);

    for (let i = start; i < end; i++) {
      buffer[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.3;
    }
  });

  return buffer;
}

async function synthesizeRetroTrack(tone: string, filename: string): Promise<string> {
  // Pick frequencies by mood
  const tones: Record<string, number[]> = {
    happy: [262, 330, 392, 494],      // C4, E4, G4, B4
    dark: [131, 156, 196, 233],       // C3, Eb3, G3, Bb3
    mysterious: [262, 311, 370, 440], // C4, D#4, F#4, A4
  };

  const notes = tones[tone] || tones["mysterious"];

  const audioData = {
    sampleRate: 44100,
    channelData: [generateRetroWave(notes)],
  };

  const wav = await WavEncoder.encode(audioData);

  // Always save inside system temp directory
  const filePath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(filePath, Buffer.from(wav));

  return filePath;
}

let lastTrack = "";

// --- MCP Tools ---

server.tool(
  "synthesize_music",
  "Generate retro synth music based on tone",
  {
    tone: z.string().describe("Tone of the track (happy, dark, mysterious)"),
  },
  async ({ tone }) => {
    lastTrack = await synthesizeRetroTrack(tone, `retro_${tone}.wav`);
    return {
      content: [
        {
          type: "text",
          text: `Generated retro synth track '${tone}' at ${lastTrack}`,
        },
      ],
    };
  },
);

server.tool(
  "play_music",
  "Play the last generated retro synth track",
  {},
  async () => {
    if (!lastTrack || !fs.existsSync(lastTrack)) {
      return {
        content: [
          { type: "text", text: "No track yet. Run synthesize_music first." },
        ],
      };
    }

    // Cross-platform audio playback
    const player = process.platform === "darwin" ? "afplay" : "mpg123";
    exec(`${player} "${lastTrack}"`, (err) => {
      if (err) console.error("Error playing track:", err);
    });

    return {
      content: [{ type: "text", text: `Playing ${lastTrack}...` }],
    };
  },
);

// --- Main Entrypoint ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🎵 Retro Synth MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
