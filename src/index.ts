import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
// @ts-ignore
import * as WavEncoder from "wav-encoder";
// @ts-ignore
import WavDecoder from "wav-decoder";

// --- Setup ---
const require = createRequire(import.meta.url);
const MidiWriter = require("midi-writer-js");

// --- ESM __dirname hack ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- MCP Server ---
const server = new McpServer({
  name: "retrowave-ambient-synth",
  version: "6.0.0",
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

const LEAD_SYNTHS = [80, 81, 82, 85];
const BASS_SYNTHS = [38, 39];
const PAD_SYNTHS = [88, 89, 90];
const NATURE_SAMPLES = ["rain.wav", "crickets.wav", "water.wav", "wind.wav"];

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

// --- Utilities & Audio Processing ---
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function loadWavFile(filePath: string): Promise<any> {
    const buffer = fs.readFileSync(filePath);
    return await WavDecoder.decode(buffer);
}

function mixAudio(musicBuffer: Float32Array, natureBuffer: Float32Array, natureVolume: number): Float32Array {
    const musicLength = musicBuffer.length;
    const natureLength = natureBuffer.length;
    const mixed = new Float32Array(musicLength);

    for (let i = 0; i < musicLength; i++) {
        // Loop the nature sound
        const natureSample = natureBuffer[i % natureLength] * natureVolume;
        mixed[i] = musicBuffer[i] + natureSample;
    }

    // Normalize to prevent clipping
    let max = 0;
    for (let i = 0; i < musicLength; i++) {
        const absVal = Math.abs(mixed[i]);
        if (absVal > max) max = absVal;
    }
    if (max > 1.0) {
        for (let i = 0; i < musicLength; i++) mixed[i] /= max;
    }

    return mixed;
}

function getChords(progression: string[], scale: string[], octave: number): string[][] {
  const degreeMap: { [key: string]: number } = { 'i': 0, 'ii': 1, 'iii': 2, 'iv': 3, 'v': 4, 'vi': 5, 'vii': 6 };
  return progression.map(degree => {
    const baseIndex = degreeMap[degree.toLowerCase()];
    return [ `${scale[baseIndex]}${octave}`, `${scale[(baseIndex + 2) % 7]}${octave}`, `${scale[(baseIndex + 4) % 7]}${octave + 1}` ];
  });
}

// --- Track Generation (MIDI) --- (Functions unchanged from previous version)

const DRUM_PATTERNS = {
    intro: (track: any) => { track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10, repeat: 4 })); },
    verse: (track: any) => { track.addEvent([ new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10, velocity: 100 }), new MidiWriter.NoteEvent({ pitch: ['F#1'], duration: '4', channel: 10, velocity: 70 }), new MidiWriter.NoteEvent({ pitch: ['D1'], duration: '4', channel: 10, velocity: 90 }), new MidiWriter.NoteEvent({ pitch: ['F#1'], duration: '4', channel: 10, velocity: 70 }), ], (event: any, index: number) => ({ startTick: index * 128 })); },
    chorus: (track: any) => { track.addEvent([ new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10, velocity: 110 }), new MidiWriter.NoteEvent({ pitch: ['G#1'], duration: '8', channel: 10, velocity: 80 }), new MidiWriter.NoteEvent({ pitch: ['D1'], duration: '4', channel: 10, velocity: 100 }), new MidiWriter.NoteEvent({ pitch: ['G#1'], duration: '8', channel: 10, velocity: 80 }), ], (event: any, index: number) => ({ startTick: index * 128 })); },
    fill: (track: any) => { for (let i = 0; i < 4; i++) { track.addEvent(new MidiWriter.NoteEvent({ pitch: ['D1'], duration: '16', channel: 10, velocity: 80 + i * 10, startTick: i * 32})); } },
    outro: (track: any) => { track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10, repeat: 4 })); },
};

function generateDrumTrack(structure: Section[]): any { /* ... unchanged ... */
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
const BASS_PATTERNS = {
    root_notes: (track: any, rootNote: string) => { track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '2', velocity: 100, repeat: 2 })); },
    eighth_notes: (track: any, rootNote: string) => { for(let i=0; i<4; i++) track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', velocity: 100 })); },
    syncopated: (track: any, rootNote: string) => { track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', wait: '16', velocity: 100 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', wait: '16', velocity: 100 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '4', velocity: 100 })); }
};

function generateBassTrack(structure: Section[], chords: { [key: string]: string[][] }, instrument: number): any { /* ... unchanged ... */
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument }));
    structure.forEach(section => {
        const sectionChords = section.name === 'chorus' ? chords.chorus : chords.verse;
        const pattern = section.name === 'chorus' ? BASS_PATTERNS.eighth_notes : BASS_PATTERNS.syncopated;
        if (section.name === 'intro' || section.name === 'outro') return;
        for (let i = 0; i < section.length; i++) {
            const rootNote = sectionChords[i % sectionChords.length][0].slice(0, -1) + '2';
            pattern(track, rootNote);
        }
    });
    return track;
}
const ARP_PATTERNS = {
    up: (track: any, chord: string[]) => { track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[0]], duration: '16', velocity: 80 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[1]], duration: '16', velocity: 80 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[2]], duration: '16', velocity: 80 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[1]], duration: '16', velocity: 80 })); },
    down: (track: any, chord: string[]) => { track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[2]], duration: '16', velocity: 80 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[1]], duration: '16', velocity: 80 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[0]], duration: '16', velocity: 80 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[1]], duration: '16', velocity: 80 })); }
}

function generateArpeggioTrack(structure: Section[], chords: { [key: string]: string[][] }, instrument: number): any { /* ... unchanged ... */
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument }));
    structure.forEach(section => {
        if (section.name !== 'chorus') return;
        const sectionChords = chords.chorus;
        for (let i = 0; i < section.length; i++) {
            const chord = sectionChords[i % sectionChords.length];
            const pattern = randomChoice([ARP_PATTERNS.up, ARP_PATTERNS.down]);
            for(let j=0; j<4; j++) pattern(track, chord);
        }
    });
    return track;
}
function generatePadTrack(structure: Section[], chords: { [key: string]: string[][] }, instrument: number): any { /* ... unchanged ... */
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
  const structure = generateSongStructure();
  const scale = randomChoice(Object.values(SCALES));
  const verseProgression = randomChoice(Object.values(CHORD_PROGRESSIONS));
  const chorusProgression = randomChoice(Object.values(CHORD_PROGRESSIONS).filter(p => p !== verseProgression));
  const leadSynth = randomChoice(LEAD_SYNTHS);
  const bassSynth = randomChoice(BASS_SYNTHS);
  const padSynth = randomChoice(PAD_SYNTHS);

  const chords = {
    verse: getChords(verseProgression, scale, 4),
    chorus: getChords(chorusProgression, scale, 4),
  };
  const tracks = [ generateDrumTrack(structure), generatePadTrack(structure, chords, padSynth), generateBassTrack(structure, chords, bassSynth), generateArpeggioTrack(structure, chords, leadSynth), ];

  const writer = new MidiWriter.Writer(tracks);
  const midiFile = path.join(os.tmpdir(), `ambient_pro_${Date.now()}.mid`);
  fs.writeFileSync(midiFile, writer.buildFile());

  const description = `Structure: ${structure.map(s => s.name).join(' -> ')}. Scale: ${Object.keys(SCALES).find(k => SCALES[k as keyof typeof SCALES] === scale)}.`;
  return { midiFile, description };
}

function midiToWav(midiFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const wavFile = midiFile.replace(/\.mid$/, ".wav");
    const timidity = spawn("timidity", [midiFile, "-Ow", "-o", wavFile, "-A", "100a"]);
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
  "play_ambient_retrowave_song",
  "Generates and plays a complex, layered retro-ambient EDM synth song with a looping nature soundscape.",
  { tone: z.string().optional().describe("Mood or tone (aesthetic only).") },
  async ({ tone }) => {
    try {
      // 1. Generate MIDI and convert to WAV
      console.error("Generating complex composition...");
      const { midiFile, description } = generateSongMIDI();
      console.error(`MIDI generated: ${path.basename(midiFile)}`);
      console.error("Converting MIDI to WAV...");
      const synthWavFile = await midiToWav(midiFile);
      console.error(`Synth WAV generated: ${path.basename(synthWavFile)}`);
      
      // 2. Select and load nature sound
      const natureSound = randomChoice(NATURE_SAMPLES);
      const natureSoundPath = path.resolve(__dirname, '../samples', natureSound);
      console.error(`Selected nature sound: ${natureSound}`);
      
      if (!fs.existsSync(natureSoundPath)) {
          throw new Error(`Sample not found: ${natureSoundPath}. Make sure the 'samples' directory is present.`);
      }

      // 3. Load audio data for mixing
      const synthAudio = await loadWavFile(synthWavFile);
      const natureAudio = await loadWavFile(natureSoundPath);
      
      // 4. Mix the two tracks
      console.error("Mixing synth music with nature sounds...");
      const finalBuffer = mixAudio(synthAudio.channelData[0], natureAudio.channelData[0], 0.4);

      // 5. Encode final mixed WAV
      const finalAudioData = { sampleRate: synthAudio.sampleRate, channelData: [finalBuffer] };
      const wavToEncode = await WavEncoder.encode(finalAudioData);
      const finalWavPath = path.join(os.tmpdir(), `final_mix_${Date.now()}.wav`);
      fs.writeFileSync(finalWavPath, Buffer.from(wavToEncode));
      console.error(`Final mixed WAV created: ${path.basename(finalWavPath)}`);

      // 6. Play the result
      playWav(finalWavPath);
      
      return {
        content: [{ type: "text", text: `🎹 Playing a new Retrowave track with ${natureSound}. ${description}` }],
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
  console.error("🎵 Ambient Retrowave Synth MCP Server is running");
}

main().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});