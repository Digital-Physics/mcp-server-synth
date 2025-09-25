import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import os from "os";
import { spawn } from "child_process";
// let currentPlayer: import('child_process').ChildProcess | null = null;
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
// @ts-ignore
import * as WavEncoder from "wav-encoder";
// @ts-ignore
import WavDecoder from "wav-decoder";
// --- Setup ---
// `createRequire` is used to create a `require` function for an ES module, allowing access to CommonJS modules like `midi-writer-js`.
const require = createRequire(import.meta.url);
const MidiWriter = require("midi-writer-js");
// process ID (PID) for killing any songs currently playing
// let currentPlayerPid: number | null = null;
let currentPlayerPid = null;
// --- ESM __dirname hack ---
// These lines are a common pattern in ES modules to replicate the behavior of the CommonJS variables `__filename` and `__dirname`.
// ECMAScript Modules (ES modules or ESM) are the official, standardized system for organizing and reusing JavaScript code.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// --- MCP Server ---
// Initializes the Model Context Protocol (MCP) server, which allows this code to be exposed as a tool to a language model.
const server = new McpServer({
    name: "retrowave-ambient-synth",
    version: "6.0.0",
});
const SCALES = {
    cMinor: ["C", "D", "D#", "F", "G", "G#", "A#"],
    aMinor: ["A", "B", "C", "D", "E", "F", "G"],
    cDorian: ["C", "D", "D#", "F", "G", "A", "A#"],
    cMajor: ["C", "D", "E", "F", "G", "A", "B"],
    eMinor: ["E", "F#", "G", "A", "B", "C", "D"],
};
const CHORD_PROGRESSIONS = {
    // Defines common chord progressions by Roman numeral analysis.
    // Lowercase 'i' indicates a minor chord, uppercase 'I' a major chord.
    synthwave: ["vi", "IV", "I", "V"],
    retro: ["i", "VI", "III", "VII"],
    pop: ["I", "V", "vi", "IV"],
    dark: ["i", "v", "iv", "i"],
    jazzy: ["ii", "V", "I", "IV"],
    emotional: ["i", "VII", "VI", "V"],
};
// MIDI program numbers for synth sounds
const LEAD_SYNTHS = [80, 81, 82, 85];
const BASS_SYNTHS = [38, 39, 34];
const PAD_SYNTHS = [88, 89, 90, 91];
// Plus Nature sounds are available
const NATURE_SAMPLES = ["rain.wav", "crickets.wav", "water.wav", "wind.wav"];
// Defines common song structures as templates.
function generateSongStructure() {
    const templates = [
        [{ name: "intro", length: 4 }, { name: "verse", length: 8 }, { name: "chorus", length: 8 }, { name: "verse", length: 8 }, { name: "chorus", length: 8 }, { name: "outro", length: 4 }],
        [{ name: "intro", length: 2 }, { name: "verse", length: 4 }, { name: "chorus", length: 4 }, { name: "outro", length: 2 }],
        [{ name: "intro", length: 4 }, { name: "verse", length: 8 }, { name: "chorus", length: 8 }, { name: "bridge", length: 4 }, { name: "chorus", length: 8 }, { name: "outro", length: 4 }]
    ];
    return randomChoice(templates);
}
// A generic utility function to select a random item from an array.
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
// Reads a WAV file from the filesystem and uses `WavDecoder` to parse its audio data.
async function loadWavFile(filePath) {
    const buffer = fs.readFileSync(filePath);
    return await WavDecoder.decode(buffer);
}
// A function to combine two audio buffers by adding their sample values.
// It loops the `natureBuffer` to match the length of the `musicBuffer`.
function mixAudio(musicBuffer, natureBuffer, natureVolume) {
    const musicLength = musicBuffer.length;
    const natureLength = natureBuffer.length;
    const mixed = new Float32Array(musicLength);
    for (let i = 0; i < musicLength; i++) {
        // Loop the nature sound
        const natureSample = natureBuffer[i % natureLength] * natureVolume;
        mixed[i] = musicBuffer[i] + natureSample;
    }
    // Normalize to prevent clipping (when audio levels exceed the maximum).
    // This scales all samples down if the combined audio is too loud.
    let max = 0;
    for (let i = 0; i < musicLength; i++) {
        const absVal = Math.abs(mixed[i]);
        if (absVal > max)
            max = absVal;
    }
    if (max > 1.0) {
        for (let i = 0; i < musicLength; i++)
            mixed[i] /= max;
    }
    return mixed;
}
function getChords(progression, scale, octave) {
    // Translates a Roman numeral chord progression into actual note names based on a scale.
    const degreeMap = { 'i': 0, 'ii': 1, 'iii': 2, 'iv': 3, 'v': 4, 'vi': 5, 'vii': 6 };
    const getNote = (index) => {
        const notesInScale = scale.length;
        const noteIndex = index % notesInScale;
        const octaveChange = Math.floor(index / notesInScale);
        return `${scale[noteIndex]}${octave + octaveChange}`;
    };
    return progression.map(degree => {
        const baseIndex = degreeMap[degree.toLowerCase()];
        // The '+ 2' and '+ 4' logic constructs a major/minor triad (a three-note chord) from the scale.
        return [getNote(baseIndex), getNote(baseIndex + 2), getNote(baseIndex + 4)];
    });
}
// --- Track Generation (MIDI) ---
const DRUM_PATTERNS = {
    intro: (track) => { track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10, repeat: 4 })); },
    verse_A: (track) => { track.addEvent([new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10, velocity: 100 }), new MidiWriter.NoteEvent({ pitch: ['F#1'], duration: '4', channel: 10, velocity: 70 }), new MidiWriter.NoteEvent({ pitch: ['D1'], duration: '4', channel: 10, velocity: 90 }), new MidiWriter.NoteEvent({ pitch: ['F#1'], duration: '4', channel: 10, velocity: 70 }),], (event, index) => ({ startTick: index * 128 })); },
    verse_B: (track) => { track.addEvent([new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '8', channel: 10, velocity: 100 }), new MidiWriter.NoteEvent({ pitch: ['F#1'], duration: '8', channel: 10, velocity: 70 }), new MidiWriter.NoteEvent({ pitch: ['G1'], duration: '8', channel: 10, velocity: 80, wait: '8' }), new MidiWriter.NoteEvent({ pitch: ['F#1'], duration: '4', channel: 10, velocity: 90 }),], (event, index) => ({ startTick: index * 64 })); },
    chorus_A: (track) => { track.addEvent([new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10, velocity: 110 }), new MidiWriter.NoteEvent({ pitch: ['G#1'], duration: '8', channel: 10, velocity: 80 }), new MidiWriter.NoteEvent({ pitch: ['D1'], duration: '4', channel: 10, velocity: 100 }), new MidiWriter.NoteEvent({ pitch: ['G#1'], duration: '8', channel: 10, velocity: 80 }),], (event, index) => ({ startTick: index * 128 })); },
    chorus_B: (track) => { for (let i = 0; i < 4; i++) {
        track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '8', channel: 10, velocity: 110 }));
        track.addEvent(new MidiWriter.NoteEvent({ pitch: ['F#1'], duration: '8', channel: 10, velocity: 80 }));
    } },
    bridge: (track) => { track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '1', channel: 10, velocity: 80 })); },
    fill: (track) => { for (let i = 0; i < 4; i++) {
        track.addEvent(new MidiWriter.NoteEvent({ pitch: ['D1'], duration: '16', channel: 10, velocity: 80 + i * 10, startTick: i * 32 }));
    } },
    outro: (track) => { track.addEvent(new MidiWriter.NoteEvent({ pitch: ['C1'], duration: '4', channel: 10, repeat: 4 })); },
};
function generateDrumTrack(structure) {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.NoteOnEvent({ channel: 10 }));
    for (let i = 0; i < structure.length; i++) {
        const section = structure[i];
        const isLastMeasureOfSection = (m) => m === section.length - 1;
        const needsFill = i < structure.length - 1 && structure[i + 1].name !== 'outro';
        for (let measure = 0; measure < section.length; measure++) {
            track.setTempo(120, measure * 4 * 128);
            if (isLastMeasureOfSection(measure) && needsFill) {
                DRUM_PATTERNS.fill(track);
            }
            else {
                let pattern;
                switch (section.name) {
                    case 'verse':
                        pattern = randomChoice([DRUM_PATTERNS.verse_A, DRUM_PATTERNS.verse_B]);
                        break;
                    case 'chorus':
                        pattern = randomChoice([DRUM_PATTERNS.chorus_A, DRUM_PATTERNS.chorus_B]);
                        break;
                    case 'bridge':
                        pattern = DRUM_PATTERNS.bridge;
                        break; // Add this line
                    default: pattern = DRUM_PATTERNS[section.name] || DRUM_PATTERNS.verse_A;
                }
                pattern(track);
            }
        }
    }
    return track;
}
const BASS_PATTERNS = {
    root_notes: (track, rootNote) => { track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '2', velocity: 100, repeat: 2 })); },
    eighth_notes: (track, rootNote) => { for (let i = 0; i < 4; i++)
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', velocity: 100 })); },
    syncopated: (track, rootNote) => { track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', wait: '16', velocity: 100 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '8', wait: '16', velocity: 100 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [rootNote], duration: '4', velocity: 100 })); }
};
function generateBassTrack(structure, chords, instrument) {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument }));
    structure.forEach(section => {
        if (section.name === 'intro' || section.name === 'outro')
            return;
        const sectionChords = section.name === 'chorus' ? chords.chorus : chords.verse;
        const pattern = randomChoice(Object.values(BASS_PATTERNS));
        for (let i = 0; i < section.length; i++) {
            const rootNote = sectionChords[i % sectionChords.length][0];
            pattern(track, rootNote);
        }
    });
    return track;
}
const ARP_PATTERNS = {
    // Defines arpeggio patterns (playing the notes of a chord one after another).
    up: (track, chord) => { for (let j = 0; j < 4; j++)
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[j % 3]], duration: '16', velocity: 80 })); },
    down: (track, chord) => { for (let j = 0; j < 4; j++)
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[(3 - j) % 3]], duration: '16', velocity: 80 })); },
    up_down: (track, chord) => { track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[0]], duration: '16', velocity: 80 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[1]], duration: '16', velocity: 80 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[2]], duration: '16', velocity: 80 })); track.addEvent(new MidiWriter.NoteEvent({ pitch: [chord[1]], duration: '16', velocity: 80 })); },
};
function generateArpeggioTrack(structure, chords, instrument) {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument }));
    structure.forEach(section => {
        if (section.name !== 'chorus' && section.name !== 'bridge')
            return;
        const sectionChords = section.name === 'chorus' ? chords.chorus : chords.verse;
        for (let i = 0; i < section.length; i++) {
            const chord = sectionChords[i % sectionChords.length];
            const pattern = randomChoice(Object.values(ARP_PATTERNS));
            for (let j = 0; j < 4; j++)
                pattern(track, chord);
        }
    });
    return track;
}
function generatePadTrack(structure, chords, instrument) {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument }));
    structure.forEach(section => {
        if (section.name === 'outro')
            return;
        const sectionChords = section.name === 'chorus' ? chords.chorus : chords.verse;
        for (let i = 0; i < section.length; i++) {
            const chord = sectionChords[i % sectionChords.length];
            track.addEvent(new MidiWriter.NoteEvent({ pitch: chord, duration: '1', velocity: 60 }));
        }
    });
    return track;
}
function generateMelodyTrack(structure, chords, instrument, scale) {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument }));
    structure.forEach(section => {
        // if (section.name !== 'verse' && section.name !== 'bridge') return;
        const sectionChords = section.name === 'verse' ? chords.verse : chords.chorus;
        for (let i = 0; i < section.length; i++) {
            const chord = sectionChords[i % sectionChords.length];
            const melodyNotes = Array.from({ length: 4 }, () => randomChoice(scale));
            for (let j = 0; j < melodyNotes.length; j++) {
                track.addEvent(new MidiWriter.NoteEvent({ pitch: [`${melodyNotes[j]}5`], duration: '4', velocity: 90 }));
            }
        }
    });
    return track;
}
// --- Main Composition & File Handling ---
function generateSongMIDI(tone) {
    // This is the core function that orchestrates the music generation process.
    // It chooses a random structure, scale, and progressions, then generates MIDI tracks.
    const structure = generateSongStructure();
    let scale = [];
    let verseProgression = [];
    let chorusProgression = [];
    if (tone === 'dark') {
        scale = randomChoice([SCALES.cMinor, SCALES.aMinor, SCALES.eMinor]);
        verseProgression = CHORD_PROGRESSIONS.dark;
        chorusProgression = CHORD_PROGRESSIONS.retro;
    }
    else if (tone === 'jazzy') {
        scale = SCALES.cDorian;
        verseProgression = CHORD_PROGRESSIONS.jazzy;
        chorusProgression = CHORD_PROGRESSIONS.jazzy;
    }
    else if (tone === 'emotional') {
        scale = randomChoice([SCALES.cMinor, SCALES.aMinor]);
        verseProgression = CHORD_PROGRESSIONS.emotional;
        chorusProgression = CHORD_PROGRESSIONS.emotional;
    }
    else if (tone === 'synthwave') {
        scale = randomChoice([SCALES.eMinor, SCALES.aMinor]);
        verseProgression = CHORD_PROGRESSIONS.emotional;
        chorusProgression = CHORD_PROGRESSIONS.synthwave;
    }
    else if (tone === 'retro') {
        scale = randomChoice([SCALES.eMinor, SCALES.aMinor]);
        verseProgression = CHORD_PROGRESSIONS.retro;
        chorusProgression = CHORD_PROGRESSIONS.retro;
    }
    else if (tone === 'pop') {
        scale = randomChoice([SCALES.cMinor, SCALES.eMinor]);
        verseProgression = CHORD_PROGRESSIONS.pop;
        chorusProgression = CHORD_PROGRESSIONS.pop;
    }
    else {
        scale = randomChoice(Object.values(SCALES));
        verseProgression = randomChoice(Object.values(CHORD_PROGRESSIONS));
        chorusProgression = randomChoice(Object.values(CHORD_PROGRESSIONS).filter(p => p !== verseProgression));
    }
    const leadSynth = randomChoice(LEAD_SYNTHS);
    const bassSynth = randomChoice(BASS_SYNTHS);
    const padSynth = randomChoice(PAD_SYNTHS);
    const chords = {
        verse: getChords(verseProgression, scale, 4),
        chorus: getChords(chorusProgression, scale, 4),
    };
    const tracks = [
        generateDrumTrack(structure),
        generatePadTrack(structure, chords, padSynth),
        generateBassTrack(structure, chords, bassSynth),
        generateArpeggioTrack(structure, chords, leadSynth),
        generateMelodyTrack(structure, chords, randomChoice(LEAD_SYNTHS), scale)
    ];
    const writer = new MidiWriter.Writer(tracks);
    const midiFile = path.join(os.tmpdir(), `ambient_pro_${Date.now()}.mid`);
    fs.writeFileSync(midiFile, writer.buildFile());
    const scaleName = Object.keys(SCALES).find(k => SCALES[k] === scale);
    const description = `Structure: ${structure.map(s => s.name).join(' -> ')}. Scale: ${scaleName}.`;
    return { midiFile, description };
}
function midiToWav(midiFile) {
    // This function uses the `timidity` command-line tool to render a MIDI file to a WAV audio file.
    // Timidity acts as a software synthesizer, interpreting the MIDI instructions and creating sound.
    return new Promise((resolve, reject) => {
        const wavFile = midiFile.replace(/\.mid$/, ".wav");
        const timidity = spawn("timidity", [midiFile, "-Ow", "-o", wavFile, "-A", "100a"]);
        let stderr = '';
        timidity.stderr.on('data', (data) => { stderr += data; });
        timidity.on("close", (code) => {
            if (code === 0)
                resolve(wavFile);
            else
                reject(new Error(`Timidity failed with code ${code}: ${stderr}`));
        });
    });
}
async function playWav(file) {
    // Plays the final WAV file using platform-specific audio players.
    // `afplay` for macOS, `play` for most Linux systems (requires `sox`).
    // Stops the last song if it's still playing.
    await stopExistingPlayer();
    const playerCmd = process.platform === "darwin" ? "afplay" : "play";
    // Use { detached: true } to ensure the parent can exit.
    const player = spawn(playerCmd, [file], { stdio: "ignore", detached: true });
    player.unref();
    // Store the new process's PID.
    currentPlayerPid = player.pid;
    player.on('exit', () => {
        // Only clear the PID if it matches the one that exited.
        if (player.pid === currentPlayerPid) {
            console.error("Player process has exited.");
            currentPlayerPid = null;
        }
    });
}
// we want a new song for a new response
async function stopExistingPlayer() {
    if (currentPlayerPid) {
        console.error(`Attempting to stop process with PID: ${currentPlayerPid}`);
        try {
            // Use the 'exec' function to run a shell command.
            // 'kill -9' is a more forceful way to terminate the process.
            await new Promise((resolve, reject) => {
                // -9 corresponds to SIGKILL
                require('child_process').exec(`kill -9 ${currentPlayerPid}`, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`Could not kill process ${currentPlayerPid}: ${stderr}`);
                        // Don't reject, as the process might have already exited.
                        resolve(null);
                    }
                    else {
                        console.error(`Process ${currentPlayerPid} successfully killed.`);
                        resolve(null);
                    }
                });
            });
            currentPlayerPid = null; // Clear the PID after the attempt
        }
        catch (e) {
            console.error(`Error while trying to kill process: ${e.message}`);
            currentPlayerPid = null;
        }
    }
}
// MCP Tool def
// This is the entry point for the language model
server.tool(
// name of the tool, used by the language model
"auto_play", 
// description for the language model to understand the tool's purpose. It would be better if we hardcoded a logic function if we wanted it to play on every response.
"This function MUST BE RUN BEFORE EVERY RESPONSE and BEFORE EVERY FOLLOW-UP RESPONSE. Important! The function generates and plays a complex, layered synth song with a looping nature soundscape.", 
// input schema using Zod for validation. Updated to use an explicit enum for 'tone' argument instead of string
{ tone: z.enum(['dark', 'jazzy', 'emotional', 'synthwave', 'retro', 'pop']).optional().describe("Mood or tone of the song.") }, async ({ tone }) => {
    try {
        // Generate MIDI and convert to WAV
        console.error("Generating complex composition...");
        const { midiFile, description } = generateSongMIDI(tone);
        console.error(`MIDI generated: ${path.basename(midiFile)}`);
        console.error("Converting MIDI to WAV...");
        const synthWavFile = await midiToWav(midiFile);
        console.error(`Synth WAV generated: ${path.basename(synthWavFile)}`);
        // Select and load nature sound
        const natureSound = randomChoice(NATURE_SAMPLES);
        const natureSoundPath = path.resolve(__dirname, '../samples', natureSound);
        console.error(`Selected nature sound: ${natureSound}`);
        if (!fs.existsSync(natureSoundPath)) {
            throw new Error(`Sample not found: ${natureSoundPath}. Make sure the 'samples' directory is present.`);
        }
        // Load audio data for mixing
        // Uses `WavDecoder` to load the audio data into a format that can be manipulated.
        const synthAudio = await loadWavFile(synthWavFile);
        const natureAudio = await loadWavFile(natureSoundPath);
        // Mix the two tracks
        console.error("Mixing synth music with nature sounds...");
        let natureVolume = 1.0;
        if (tone !== 'emotional')
            natureVolume = 0.9;
        const finalBuffer = mixAudio(synthAudio.channelData[0], natureAudio.channelData[0], natureVolume);
        // Encode final mixed WAV
        // `WavEncoder` takes the mixed audio data and turns it back into a WAV file buffer.
        const finalAudioData = { sampleRate: synthAudio.sampleRate, channelData: [finalBuffer] };
        const wavToEncode = await WavEncoder.encode(finalAudioData);
        const finalWavPath = path.join(os.tmpdir(), `final_mix_${Date.now()}.wav`);
        fs.writeFileSync(finalWavPath, Buffer.from(wavToEncode));
        console.error(`Final mixed WAV created: ${path.basename(finalWavPath)}`);
        // Play the result
        await playWav(finalWavPath);
        // Message will display in the LLM window
        return {
            content: [{ type: "text", text: `🎹 Playing a new track with ${natureSound}. ${description}` }],
        };
    }
    catch (err) {
        console.error(`Error in tool execution: ${err.message}`);
        return {
            content: [{ type: "text", text: `Failed to generate or play song: ${err.message}` }],
        };
    }
});
// --- Main Server Entrypoint ---
async function main() {
    // `StdioServerTransport` enables the server to communicate over standard input/output, which is how the language model talks to the tool.
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🎵 Ambient Nature Synth MCP Server is running");
}
main().catch((err) => {
    console.error("Fatal server error:", err);
    process.exit(1);
});
