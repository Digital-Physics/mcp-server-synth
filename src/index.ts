// import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// import { z } from "zod";

// const NWS_API_BASE = "https://api.weather.gov";
// const USER_AGENT = "weather-app/1.0";

// // Create server instance
// const server = new McpServer({
//   name: "weather",
//   version: "1.0.0",
//   capabilities: {
//     resources: {},
//     tools: {},
//   },
// });
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as Tone from "tone";
import fs from "fs";
import { exec } from "child_process";

const server = new McpServer({
  name: "retro-synth",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Simple helper to synthesize retro-style music
async function synthesizeRetroTrack(tone: string, filename: string): Promise<string> {
  // Use Tone.js offline rendering
  const buffer = await Tone.Offline(({ transport }) => {
    const synth = new Tone.MonoSynth({
      oscillator: { type: "square" },
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.2, release: 1 },
    }).toDestination();

    const seqNotes =
      tone === "happy"
        ? ["C4", "E4", "G4", "B4"]
        : tone === "dark"
        ? ["C3", "Eb3", "G3", "Bb2"]
        : ["C4", "D#4", "F4", "A#3"];

    const seq = new Tone.Sequence(
      (time, note) => {
        synth.triggerAttackRelease(note, "8n", time);
      },
      seqNotes,
      "4n",
    );

    seq.start(0);
    transport.start();
  }, 4); // 4 seconds

  const wav = Buffer.from(await buffer.arrayBuffer());
  fs.writeFileSync(filename, wav);
  return filename;
}

let lastTrack = "retro.wav";

// Register tool: synthesize
server.tool(
  "synthesize_music",
  "Generate retro synth music based on tone",
  {
    tone: z.string().describe("Tone of the track (e.g., happy, dark, mysterious)"),
  },
  async ({ tone }) => {
    lastTrack = `retro_${tone}.wav`;
    await synthesizeRetroTrack(tone, lastTrack);

    return {
      content: [
        {
          type: "text",
          text: `Generated retro synth track with tone '${tone}' at ${lastTrack}`,
        },
      ],
    };
  },
);

// Register tool: play
server.tool(
  "play_music",
  "Play the last generated retro synth track",
  {},
  async () => {
    if (!fs.existsSync(lastTrack)) {
      return {
        content: [
          {
            type: "text",
            text: "No track has been generated yet. Call synthesize_music first.",
          },
        ],
      };
    }

    // Cross-platform audio playback
    const player = process.platform === "darwin" ? "afplay" : "mpg123";
    exec(`${player} ${lastTrack}`, (err) => {
      if (err) console.error("Error playing track:", err);
    });

    return {
      content: [
        {
          type: "text",
          text: `Playing ${lastTrack}...`,
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Retro Synth MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
