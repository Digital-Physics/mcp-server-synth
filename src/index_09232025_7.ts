import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import path from "path";
import { createRequire } from "module";

// --- Setup ---
const require = createRequire(import.meta.url);
const MidiWriter = require("midi-writer-js");

// --- MCP Server ---
const server = new McpServer({
  name: "retrowave-edm-synth",
  version: "4.0.0",
});

// --- Musical Data & Theory ---

const SCALES = {
  //                  C    D    E    F    G    A    B
  cMinor:   ["C", "D", "D#", "F", "G", "G#", "A#"],
  cMajor:   ["C", "D", "E", "F", "G", "A", "B"],
  cDorian:  ["C", "D", "D#", "F", "G", "A", "A#"],
  cPhrygian:["C", "C#", "D#", "F", "G", "G#", "A#"]
};

const CHORD_PROGRESSIONS = {
  // Using degree notation (I, II, III, etc.)
  pachelbel: ["I", "V", "vi", "iii", "IV", "I", "IV", "V"],
  retro:     ["I", "IV", "V", "I"],
  synthwave: ["vi", "IV", "I", "V"],
  ambient:   ["I", "vi", "IV", "V"],
};

// --- Utilities ---

/**
 * Picks a random element from an array.
 * @template T
 * @param {T[]} arr The array to pick from.
 * @returns {T} A random element from the array.
 */
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Translates a chord progression from degrees to actual notes.
 * @param {string[]} progression - An array of chord degrees (e.g., "I", "V").
 * @param {string[]} scale - The scale to use for the translation.
 * @param {number} octave - The starting octave.
 * @returns {string[][]} An array of chords, where each chord is an array of notes.
 */
function getChordsFromProgression(progression: string[], scale: string[], octave: number): string[][] {
  const degreeMap: { [key: string]: number } = { 'i': 0, 'ii': 1, 'iii': 2, 'iv': 3, 'v': 4, 'vi': 5, 'vii': 6 };
  return progression.map(degree => {
    const baseIndex = degreeMap[degree.toLowerCase()];
    // Simple triad chord (root, third, fifth)
    return [
      `${scale[baseIndex]}${octave}`,
      `${scale[(baseIndex + 2) % 7]}${octave}`,
      `${scale[(baseIndex + 4) % 7]}${octave}`
    ];
  });
}

// --- Track Generation ---

/**
 * Generates a classic EDM/Synthwave drum track.
 * @param {number} totalBeats - The total number of beats for the track.
 * @returns {any} A MidiWriter.Track object.
 */
function generateDrumTrack(totalBeats: number): any {
  const track = new MidiWriter.Track();
  track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 25 })); // Steel Guitar for percussion channel
  const KICK = 'C1'; // Bass Drum 1
  const SNARE = 'D1'; // Snare
  const HIHAT_CLOSED = 'F#1'; // Closed Hi-hat
  const HIHAT_OPEN = 'G#1'; // Open Hi-hat

  for (let beat = 0; beat < totalBeats; beat++) {
    // Four-on-the-floor kick
    track.addEvent(new MidiWriter.NoteEvent({ pitch: [KICK], duration: '4', velocity: 100, channel: 10 }));

    // Snare on beats 2 and 4
    if (beat % 2 === 1) {
      track.addEvent(new MidiWriter.NoteEvent({ pitch: [SNARE], duration: '4', velocity: 90, channel: 10, startTick: beat * 128 }));
    }

    // Off-beat open hi-hat for syncopation
    if ((beat * 4) % 4 === 2) {
       track.addEvent(new MidiWriter.NoteEvent({ pitch: [HIHAT_OPEN], duration: '8', velocity: 60, channel: 10, startTick: (beat * 128) + 64}));
    }

    // Consistent closed hi-hats
    for (let sub = 0; sub < 4; sub++) {
      track.addEvent(new MidiWriter.NoteEvent({ pitch: [HIHAT_CLOSED], duration: '16', velocity: 70, channel: 10, startTick: (beat * 128) + (sub * 32)}));
    }
  }
  return track;
}

/**
 * Generates a rhythmic, driving bassline.
 * @param {string[][]} chords - The chord progression to follow.
 * @param {number} octave - The octave for the bassline.
 * @returns {any} A MidiWriter.Track object.
 */
function generateBassTrack(chords: string[][], octave: number): any {
  const track = new MidiWriter.Track();
  track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 38 })); // Synth Bass 1
  
  chords.forEach(chord => {
    const rootNote = chord[0].replace(/\d+$/, '') + octave; // Get root note at the correct octave
    // Create a simple rhythmic pattern (e.g., two eighth notes)
    track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', velocity: 95 }));
    track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', velocity: 95 }));
    track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', velocity: 95 }));
    track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', velocity: 95 }));
  });
  return track;
}

/**
 * Generates an arpeggiated synth lead.
 * @param {string[][]} chords - The chord progression for the arpeggio.
 * @returns {any} A MidiWriter.Track object.
 */
function generateArpeggioTrack(chords: string[][]): any {
  const track = new MidiWriter.Track();
  track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 81 })); // Saw Lead

  chords.forEach(chord => {
    // Upward arpeggio pattern
    track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[0]], duration: '16', velocity: 80 }));
    track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[1]], duration: '16', velocity: 80 }));
    track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[2]], duration: '16', velocity: 80 }));
    track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[1]], duration: '16', velocity: 80 }));
  });
  return track;
}

/**
 * Generates atmospheric synth pads.
 * @param {string[][]} chords - The chord progression for the pads.
 * @returns {any} A MidiWriter.Track object.
 */
function generatePadTrack(chords: string[][]): any {
  const track = new MidiWriter.Track();
  track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 89 })); // New Age Pad

  chords.forEach(chord => {
    track.addEvent(new MidiWriter.NoteEvent({ pitch: chord, duration: '1', velocity: 60 }));
  });
  return track;
}

// --- Main Composition & File Handling ---

/**
 * Generates a complete song and saves it as a MIDI file.
 * @returns {string} The file path to the generated MIDI file.
 */
function generateSongMIDI(): string {
  const scale = randomChoice(Object.values(SCALES));
  const progression = randomChoice(Object.values(CHORD_PROGRESSIONS));
  const repeats = 4; // Repeat the progression for a fuller song
  
  let fullProgression: string[] = [];
  for(let i=0; i < repeats; i++) {
    fullProgression = fullProgression.concat(progression);
  }

  const padChords = getChordsFromProgression(fullProgression, scale, 4);
  const arpChords = getChordsFromProgression(fullProgression, scale, 5);
  
  const totalBeats = fullProgression.length;

  const tracks = [
    generateDrumTrack(totalBeats),
    generateBassTrack(padChords, 2),
    generatePadTrack(padChords),
    generateArpeggioTrack(arpChords),
  ];

  const writer = new MidiWriter.Writer(tracks);
  const midiFilename = path.join(os.tmpdir(), `retrowave_synth_${Date.now()}.mid`);
  fs.writeFileSync(midiFilename, writer.buildFile());
  return midiFilename;
}

/**
 * Converts a MIDI file to a WAV file using Timidity.
 * @param {string} midiFile - Path to the MIDI file.
 * @returns {Promise<string>} A promise that resolves with the path to the WAV file.
 */
function midiToWav(midiFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const wavFile = midiFile.replace(/\.mid$/, ".wav");
    // Use the '-A' flag for anti-aliasing to get a better sound
    const timidity = spawn("timidity", [midiFile, "-Ow", "-o", wavFile, "-A", "100"]);
    
    let stderr = '';
    timidity.stderr.on('data', (data) => {
      stderr += data;
    });

    timidity.on("close", (code) => {
      if (code === 0) {
        resolve(wavFile);
      } else {
        // Check for common Timidity error (config not found)
        if (stderr.includes("No such file or directory: /etc/timidity/timidity.cfg")) {
           reject(new Error("Timidity configuration not found. Please install a soundfont (e.g., `sudo apt-get install fluid-soundfont-gm`)."));
        } else {
           reject(new Error(`Timidity failed with code ${code}: ${stderr}`));
        }
      }
    });
  });
}

/**
 * Plays a WAV file asynchronously.
 * @param {string} file - Path to the WAV file.
 */
function playWav(file: string) {
  const playerCmd = process.platform === "darwin" ? "afplay" : "play";
  const player = spawn(playerCmd, [file], { stdio: "ignore", detached: true });
  player.unref();
}

// --- MCP Tool Definition ---

server.tool(
  "play_retrowave_song",
  "Generates and plays a layered retro-ambient EDM synth song.",
  {
    tone: z.string().optional().describe("Mood or tone of the track (note: currently aesthetic only, does not alter generation).")
  },
  async ({ tone }) => {
    try {
      console.error("Generating MIDI composition...");
      const midiFile = generateSongMIDI();
      console.error(`MIDI generated at: ${midiFile}`);

      console.error("Converting MIDI to WAV with Timidity...");
      const wavFile = await midiToWav(midiFile);
      console.error(`WAV generated at: ${wavFile}`);
      
      playWav(wavFile);
      
      return {
        content: [{ type: "text", text: `🎹 Playing a new Retrowave/EDM track...` }],
      };
    } catch (err: any) {
      console.error(`Error in tool execution: ${err.message}`);
      return {
        content: [{ type: "text", text: `Failed to generate or play song: ${err.message}` }],
      };
    }
  }
);

// --- Main Server Entrypoint ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🎵 Retrowave/EDM Synth MCP Server is running");
}

main().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});