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
  name: "retrowave-edm-synth-pro",
  version: "5.0.1", // Incremented patch version for the fix
});

// --- Musical Data & Theory ---

const SCALES = {
  cMinor: ["C", "D", "D#", "F", "G", "G#", "A#"],
  aMinor: ["A", "B", "C", "D", "E", "F", "G"],
  cDorian: ["C", "D", "D#", "F", "G", "A", "A#"],
};

const CHORD_PROGRESSIONS = {
  synthwave: ["vi", "IV", "I", "V"],
  retro: ["i", "VI", "III", "VII"],
  pop: ["I", "V", "vi", "IV"],
  dark: ["i", "v", "iv", "i"],
};

// Instrument patches (General MIDI)
const LEAD_SYNTHS = [80, 81, 82, 85]; // Square, Saw, Doctor, Charang
const BASS_SYNTHS = [38, 39]; // Synth Bass 1, 2
const PAD_SYNTHS = [88, 89, 90]; // Pad 1 (new age), Pad 2 (warm), Pad 3 (polysynth)

// --- Song Structure ---
interface Section {
  name: "intro" | "verse" | "chorus" | "outro";
  length: number; // in measures
}

function generateSongStructure(): Section[] {
  const templates: Section[][] = [
    [ { name: "intro", length: 4 }, { name: "verse", length: 8 }, { name: "chorus", length: 8 }, { name: "verse", length: 8 }, { name: "chorus", length: 8 }, { name: "outro", length: 4 } ],
    [ { name: "intro", length: 2 }, { name: "verse", length: 4 }, { name: "chorus", length: 4 }, { name: "outro", length: 2 } ],
  ];
  return randomChoice(templates);
}

// --- Utilities ---
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getChords(progression: string[], scale: string[], octave: number): string[][] {
  const degreeMap: { [key: string]: number } = { 'i': 0, 'ii': 1, 'iii': 2, 'iv': 3, 'v': 4, 'vi': 5, 'vii': 6 };
  return progression.map(degree => {
    const baseIndex = degreeMap[degree.toLowerCase()];
    return [ `${scale[baseIndex]}${octave}`, `${scale[(baseIndex + 2) % 7]}${octave}`, `${scale[(baseIndex + 4) % 7]}${octave + 1}` ]; // Spread chord over 2 octaves
  });
}

// --- Pattern-Based Track Generation ---

// DRUMS
const DRUM_PATTERNS = {
    intro: (track: any) => { // Simple four-on-the-floor
        track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10 }));
    },
    verse: (track: any) => { // Add snare and hi-hats
        track.addEvent([
            new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10, velocity: 100 }), // Kick
            new MidiWriter.NoteEvent({ pitch: ['F#1'], duration: '4', channel: 10, velocity: 70 }), // Closed Hat
            new MidiWriter.NoteEvent({ pitch: ['D1'], duration: '4', channel: 10, velocity: 90 }), // Snare
            new MidiWriter.NoteEvent({ pitch: ['F#1'], duration: '4', channel: 10, velocity: 70 }), // Closed Hat
        ], (event: any, index: number) => ({ startTick: index * 128 }));
    },
    chorus: (track: any) => { // More intense with open hi-hat
         track.addEvent([
            new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10, velocity: 110 }),
            new MidiWriter.NoteEvent({ pitch: ['G#1'], duration: '8', channel: 10, velocity: 80 }), // Open Hat
            new MidiWriter.NoteEvent({ pitch: ['D1'], duration: '4', channel: 10, velocity: 100 }),
            new MidiWriter.NoteEvent({ pitch: ['G#1'], duration: '8', channel: 10, velocity: 80 }),
        ], (event: any, index: number) => ({ startTick: index * 128 }));
    },
    fill: (track: any) => { // Snare roll
        for (let i = 0; i < 4; i++) {
            track.addEvent(new MidiWriter.NoteEvent({ pitch: ['D1'], duration: '16', channel: 10, velocity: 80 + i * 10, startTick: i * 32}));
        }
    },
    // ✅ FIX: Added the missing 'outro' pattern
    outro: (track: any) => { // Same as intro to fade out
        track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10 }));
    },
};

function generateDrumTrack(structure: Section[]): any {
    const track = new MidiWriter.Track();
    for (let i = 0; i < structure.length; i++) {
        const section = structure[i];
        const isLastMeasureOfSection = (m: number) => m === section.length - 1;
        const needsFill = i < structure.length - 1 && structure[i+1].name !== 'outro';

        for (let measure = 0; measure < section.length; measure++) {
            track.setTempo(120, measure * 4 * 128);
            if (isLastMeasureOfSection(measure) && needsFill) {
                DRUM_PATTERNS.fill(track);
            } else {
                const pattern = DRUM_PATTERNS[section.name] || DRUM_PATTERNS.verse;
                pattern(track);
            }
        }
    }
    return track;
}


// BASS
const BASS_PATTERNS = {
    root_notes: (track: any, rootNote: string) => {
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '2', velocity: 100 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '2', velocity: 100 }));
    },
    eighth_notes: (track: any, rootNote: string) => {
        for(let i=0; i<4; i++) track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', velocity: 100 }));
    },
    syncopated: (track: any, rootNote: string) => {
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', wait: '16', velocity: 100 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', wait: '16', velocity: 100 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '4', velocity: 100 }));
    }
};

function generateBassTrack(structure: Section[], chords: { [key: string]: string[][] }, instrument: number): any {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument }));
    
    structure.forEach(section => {
        const sectionChords = section.name === 'chorus' ? chords.chorus : chords.verse;
        const pattern = section.name === 'chorus' ? BASS_PATTERNS.eighth_notes : BASS_PATTERNS.syncopated;
        if (section.name === 'intro' || section.name === 'outro') return;

        for (let i = 0; i < section.length; i++) {
            const rootNote = sectionChords[i % sectionChords.length][0].slice(0, -1) + '2'; // Get root note in octave 2
            pattern(track, rootNote);
        }
    });
    return track;
}


// ARPEGGIO
const ARP_PATTERNS = {
    up: (track: any, chord: string[]) => {
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[0]], duration: '16', velocity: 80 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[1]], duration: '16', velocity: 80 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[2]], duration: '16', velocity: 80 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[1]], duration: '16', velocity: 80 }));
    },
    down: (track: any, chord: string[]) => {
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[2]], duration: '16', velocity: 80 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[1]], duration: '16', velocity: 80 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[0]], duration: '16', velocity: 80 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[1]], duration: '16', velocity: 80 }));
    }
}

function generateArpeggioTrack(structure: Section[], chords: { [key: string]: string[][] }, instrument: number): any {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument }));

    structure.forEach(section => {
        if (section.name !== 'chorus') return; // Only play arpeggio in chorus for impact
        
        const sectionChords = chords.chorus;
        for (let i = 0; i < section.length; i++) {
            const chord = sectionChords[i % sectionChords.length];
            const pattern = randomChoice([ARP_PATTERNS.up, ARP_PATTERNS.down]);
            for(let j=0; j<4; j++) pattern(track, chord); // Repeat pattern for the whole measure
        }
    });
    return track;
}


// PADS
function generatePadTrack(structure: Section[], chords: { [key: string]: string[][] }, instrument: number): any {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument }));

    structure.forEach(section => {
        if (section.name === 'outro') return;
        const sectionChords = section.name === 'chorus' ? chords.chorus : chords.verse;
        for (let i = 0; i < section.length; i++) {
            const chord = sectionChords[i % sectionChords.length];
            track.addEvent(new MidiWriter.NoteEvent({ pitch: chord, duration: '1', velocity: 60 }));
        }
    });
    return track;
}


// --- Main Composition & File Handling ---

function generateSongMIDI(): { midiFile: string; description: string } {
  // 1. Select musical elements
  const structure = generateSongStructure();
  const scale = randomChoice(Object.values(SCALES));
  const verseProgression = randomChoice(Object.values(CHORD_PROGRESSIONS));
  const chorusProgression = randomChoice(Object.values(CHORD_PROGRESSIONS).filter(p => p !== verseProgression));
  const leadSynth = randomChoice(LEAD_SYNTHS);
  const bassSynth = randomChoice(BASS_SYNTHS);
  const padSynth = randomChoice(PAD_SYNTHS);

  // 2. Generate chord progressions for each section
  const chords = {
    verse: getChords(verseProgression, scale, 4),
    chorus: getChords(chorusProgression, scale, 4),
  };

  // 3. Generate each track based on the structure and chords
  const tracks = [
    generateDrumTrack(structure),
    generatePadTrack(structure, chords, padSynth),
    generateBassTrack(structure, chords, bassSynth),
    generateArpeggioTrack(structure, chords, leadSynth),
  ];

  // 4. Write to MIDI file
  const writer = new MidiWriter.Writer(tracks);
  const midiFile = path.join(os.tmpdir(), `retrowave_pro_${Date.now()}.mid`);
  fs.writeFileSync(midiFile, writer.buildFile());

  const description = `Structure: ${structure.map(s => s.name).join(' -> ')}. Scale: ${Object.keys(SCALES).find(k => SCALES[k as keyof typeof SCALES] === scale)}.`;
  return { midiFile, description };
}

function midiToWav(midiFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const wavFile = midiFile.replace(/\.mid$/, ".wav");
    const timidity = spawn("timidity", [midiFile, "-Ow", "-o", wavFile, "-A", "100a"]); // Use better anti-aliasing
    let stderr = '';
    timidity.stderr.on('data', (data) => { stderr += data; });
    timidity.on("close", (code) => {
      if (code === 0) resolve(wavFile);
      else reject(new Error(`Timidity failed with code ${code}: ${stderr}`));
    });
  });
}

function playWav(file: string) {
  const playerCmd = process.platform === "darwin" ? "afplay" : "play";
  spawn(playerCmd, [file], { stdio: "ignore", detached: true }).unref();
}


// --- MCP Tool Definition ---
server.tool(
  "play_retrowave_song_pro",
  "Generates and plays a complex, layered retro-ambient EDM synth song with dynamic structure.",
  { tone: z.string().optional().describe("Mood or tone (aesthetic only).") },
  async ({ tone }) => {
    try {
      console.error("Generating complex composition...");
      const { midiFile, description } = generateSongMIDI();
      console.error(`MIDI generated: ${path.basename(midiFile)}`);
      console.error(` > ${description}`);

      console.error("Converting MIDI to WAV...");
      const wavFile = await midiToWav(midiFile);
      console.error(`WAV generated: ${path.basename(wavFile)}`);
      
      playWav(wavFile);
      
      return {
        content: [{ type: "text", text: `🎹 Playing a new, complex Retrowave track. ${description}` }],
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
  console.error("🎵 Pro Retrowave/EDM Synth MCP Server is running");
}

main().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});