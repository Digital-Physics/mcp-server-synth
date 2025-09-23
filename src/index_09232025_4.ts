import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import path from "path";
// import MidiWriter from "midi-writer-js";
// @ts-ignore
// const MidiWriter = require("midi-writer-js");

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const MidiWriter = require("midi-writer-js");

// --- MCP Server ---
const server = new McpServer({
  name: "layered-synth",
  version: "2.0.0",
});

// --- Song Structure ---
interface Section {
  name: string;
  length: number; // in beats
}

function generateSongStructure(): Section[] {
  const templates: Section[][] = [
    [{ name: "intro", length: 4 }, { name: "verse", length: 8 }, { name: "chorus", length: 8 }, { name: "outro", length: 4 }],
    [{ name: "verse", length: 8 }, { name: "chorus", length: 8 }, { name: "bridge", length: 4 }, { name: "chorus", length: 8 }],
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

// --- MIDI Generation Utilities ---
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate a random melody track
function generateMelodyTrack(length: number) {
  const track = new MidiWriter.Track();
  track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 1 })); // Acoustic piano
  const scale = ["C4", "D4", "E4", "G4", "A4"];
  for (let i = 0; i < length; i++) {
    track.addEvent(new MidiWriter.NoteEvent({
      pitch: [randomChoice(scale)],
      duration: randomChoice(["4", "8"]), // quarter or eighth
    }));
  }
  return track;
}

// Generate a simple bass track
function generateBassTrack(length: number) {
  const track = new MidiWriter.Track();
  track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 33 })); // Electric Bass
  const scale = ["C2", "E2", "G2", "A2"];
  for (let i = 0; i < length; i++) {
    track.addEvent(new MidiWriter.NoteEvent({
      pitch: [randomChoice(scale)],
      duration: "4",
    }));
  }
  return track;
}

// Generate a simple drum track
function generateDrumTrack(length: number) {
  const track = new MidiWriter.Track();
  track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 0 })); // General MIDI drum channel
  const drums = ["C2", "D2", "E2"]; // kick, snare, hi-hat
  for (let i = 0; i < length; i++) {
    if (Math.random() > 0.3) track.addEvent(new MidiWriter.NoteEvent({ pitch: [drums[0]], duration: "4" })); // kick
    if (Math.random() > 0.6) track.addEvent(new MidiWriter.NoteEvent({ pitch: [drums[1]], duration: "4" })); // snare
    if (Math.random() > 0.5) track.addEvent(new MidiWriter.NoteEvent({ pitch: [drums[2]], duration: "8" })); // hi-hat
  }
  return track;
}

function generateSongMIDI(structure: Section[]): string {
  const tracks: any[] = [];

  for (const section of structure) {
    tracks.push(generateMelodyTrack(section.length));
    tracks.push(generateBassTrack(section.length));
    tracks.push(generateDrumTrack(section.length));
  }

  const writer = new MidiWriter.Writer(tracks); // <-- pass tracks here
  const midiFilename = path.join(os.tmpdir(), `synth_song_${Date.now()}.mid`);
  fs.writeFileSync(midiFilename, writer.buildFile());
  return midiFilename;
}

// --- Convert MIDI to WAV using timidity ---
function midiToWav(midiFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const wavFile = midiFile.replace(/\.mid$/, ".wav");
    const timidity = spawn("timidity", [midiFile, "-Ow", "-o", wavFile]);

    timidity.on("close", (code) => {
      if (code === 0) resolve(wavFile);
      else reject(new Error(`Timidity failed with code ${code}`));
    });
  });
}

// --- Play WAV ---
function playWav(file: string) {
  const playerCmd = process.platform === "darwin" ? "afplay" : "play";
  const player = spawn(playerCmd, [file], { stdio: "ignore", detached: true });
  player.unref();
}

// --- MCP Tool ---
server.tool(
  "play_synth_song",
  "Generate and play a synth song (melody + bass + drums).",
  {
    tone: z.string().describe("Mood or tone of the track (optional)"),
  },
  async ({ tone }) => {
    try {
      const structure = generateSongStructure();
      const midiFile = generateSongMIDI(structure);
      const wavFile = await midiToWav(midiFile);
      playWav(wavFile);
      return {
        content: [{ type: "text", text: `🎹 Playing synth song with structure: ${structure.map(s => s.name).join(" -> ")}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to generate or play song: ${err}` }],
      };
    }
  }
);

// --- Main Entrypoint ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🎵 Synth MIDI MCP Server running");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
