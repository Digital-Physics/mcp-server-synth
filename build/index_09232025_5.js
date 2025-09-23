import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const MidiWriter = require("midi-writer-js");
// --- MCP Server ---
const server = new McpServer({
    name: "layered-synth",
    version: "2.0.0",
});
function generateSongStructure() {
    const templates = [
        [{ name: "intro", length: 4 }, { name: "verse", length: 8 }, { name: "chorus", length: 8 }, { name: "outro", length: 4 }],
        [{ name: "verse", length: 8 }, { name: "chorus", length: 8 }, { name: "bridge", length: 4 }, { name: "chorus", length: 8 }],
        [{ name: "ambient_intro", length: 6 }, { name: "verse", length: 8 }, { name: "chorus", length: 10 }, { name: "ambient_outro", length: 6 }],
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}
// --- Utilities ---
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
// --- Scales for ambient synths ---
const ambientScales = {
    CmajPentatonic: ["C4", "D4", "E4", "G4", "A4"],
    Cminor: ["C4", "D#4", "F4", "G4", "A#4"],
    Clydian: ["C4", "D4", "E4", "F#4", "G4", "A4", "B4"]
};
// function randomScale() {
//   const keys = Object.keys(ambientScales);
//   return ambientScales[randomChoice(keys)];
// }
function randomScale() {
    const keys = Object.keys(ambientScales);
    return ambientScales[randomChoice(keys)];
}
// --- Melody Track ---
function generateMelodyTrack(length) {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 81 })); // Synth Lead
    const scale = randomScale();
    for (let i = 0; i < length; i++) {
        const chordSize = Math.random() > 0.7 ? 2 : 1; // sometimes 2-note chords
        const pitches = [];
        for (let j = 0; j < chordSize; j++)
            pitches.push(randomChoice(scale));
        track.addEvent(new MidiWriter.NoteEvent({
            pitch: pitches,
            duration: randomChoice(["4", "8", "2"]), // quarter, eighth, half
            velocity: Math.floor(Math.random() * 20) + 80, // subtle dynamic variation
        }));
    }
    return track;
}
// --- Bass Track ---
function generateBassTrack(length) {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 38 })); // Synth Bass
    const scale = ["C2", "D2", "E2", "G2", "A2"];
    for (let i = 0; i < length; i++) {
        const note = randomChoice(scale);
        const duration = Math.random() > 0.7 ? "2" : "4"; // longer bass notes sometimes
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [note], duration, velocity: Math.floor(Math.random() * 20) + 70 }));
    }
    return track;
}
// --- Drum Track ---
function generateDrumTrack(length) {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 0 })); // General MIDI drums
    const drums = ["C2", "D2", "E2"]; // kick, snare, hi-hat
    for (let i = 0; i < length; i++) {
        if (Math.random() > 0.6)
            track.addEvent(new MidiWriter.NoteEvent({ pitch: [drums[0]], duration: "4", velocity: 100 }));
        if (Math.random() > 0.8)
            track.addEvent(new MidiWriter.NoteEvent({ pitch: [drums[1]], duration: "4", velocity: 90 }));
        if (Math.random() > 0.5)
            track.addEvent(new MidiWriter.NoteEvent({ pitch: [drums[2]], duration: randomChoice(["8", "16"]), velocity: 80 }));
    }
    return track;
}
// --- Generate full song MIDI ---
function generateSongMIDI(structure) {
    const tracks = [];
    for (const section of structure) {
        tracks.push(generateMelodyTrack(section.length));
        tracks.push(generateBassTrack(section.length));
        tracks.push(generateDrumTrack(section.length));
    }
    const writer = new MidiWriter.Writer(tracks);
    const midiFilename = path.join(os.tmpdir(), `synth_song_${Date.now()}.mid`);
    fs.writeFileSync(midiFilename, writer.buildFile());
    return midiFilename;
}
// --- Convert MIDI to WAV using timidity ---
function midiToWav(midiFile) {
    return new Promise((resolve, reject) => {
        const wavFile = midiFile.replace(/\.mid$/, ".wav");
        const timidity = spawn("timidity", [midiFile, "-Ow", "-o", wavFile]);
        timidity.on("close", (code) => {
            if (code === 0)
                resolve(wavFile);
            else
                reject(new Error(`Timidity failed with code ${code}`));
        });
    });
}
// --- Play WAV ---
function playWav(file) {
    const playerCmd = process.platform === "darwin" ? "afplay" : "play";
    const player = spawn(playerCmd, [file], { stdio: "ignore", detached: true });
    player.unref();
}
// --- MCP Tool ---
server.tool("play_synth_song", "Generate and play a synth song (melody + bass + drums).", {
    tone: z.string().optional().describe("Mood or tone of the track"),
}, async ({ tone }) => {
    try {
        const structure = generateSongStructure();
        const midiFile = generateSongMIDI(structure);
        const wavFile = await midiToWav(midiFile);
        playWav(wavFile);
        return {
            content: [{ type: "text", text: `🎹 Playing ambient synth song with structure: ${structure.map(s => s.name).join(" -> ")}` }],
        };
    }
    catch (err) {
        return {
            content: [{ type: "text", text: `Failed to generate or play song: ${err}` }],
        };
    }
});
// --- Main Entrypoint ---
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🎵 Ambient Synth MCP Server running");
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
