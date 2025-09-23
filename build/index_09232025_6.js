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
    name: "layered-ambient-synth",
    version: "3.0.0",
});
function generateSongStructure() {
    const templates = [
        [{ name: "intro", length: 4 }, { name: "verse", length: 8 }, { name: "chorus", length: 8 }, { name: "outro", length: 4 }],
        [{ name: "ambient_intro", length: 6 }, { name: "verse", length: 8 }, { name: "chorus", length: 10 }, { name: "ambient_outro", length: 6 }],
        [{ name: "verse", length: 8 }, { name: "chorus", length: 8 }, { name: "bridge", length: 4 }, { name: "chorus", length: 8 }],
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}
// --- Utilities ---
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
const ambientScales = {
    CmajPentatonic: ["C4", "D4", "E4", "G4", "A4"],
    Cminor: ["C4", "D#4", "F4", "G4", "A#4"],
    Clydian: ["C4", "D4", "E4", "F#4", "G4", "A4", "B4"]
};
function randomScale() {
    const keys = Object.keys(ambientScales);
    return ambientScales[randomChoice(keys)];
}
// --- Melody Track ---
function generateMelodyTrack(length) {
    const track = new MidiWriter.Track();
    const lead = randomChoice([81, 82, 83, 85, 86]); // random lead synth
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: lead, channel: 1 }));
    const scale = randomScale();
    for (let i = 0; i < length; i++) {
        const chordSize = Math.random() > 0.6 ? randomChoice([1, 2, 3]) : 1;
        const pitches = [];
        for (let j = 0; j < chordSize; j++)
            pitches.push(randomChoice(scale));
        track.addEvent(new MidiWriter.NoteEvent({
            pitch: pitches,
            duration: randomChoice(["4", "8", "2"]),
            velocity: Math.floor(Math.random() * 20) + 80,
            channel: 1,
        }));
    }
    return track;
}
// --- Bass Track ---
function generateBassTrack(length) {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 38, channel: 2 })); // Synth Bass
    const scale = ["C2", "D2", "E2", "G2", "A2"];
    for (let i = 0; i < length; i++) {
        const note = randomChoice(scale);
        const duration = Math.random() > 0.7 ? "2" : "4";
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [note], duration, velocity: Math.floor(Math.random() * 20) + 70, channel: 2 }));
    }
    return track;
}
// --- Pad Track ---
function generatePadTrack(length) {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 89, channel: 3 })); // New Age Pad
    const scale = randomScale();
    for (let i = 0; i < length; i++) {
        const chord = [randomChoice(scale), randomChoice(scale)];
        track.addEvent(new MidiWriter.NoteEvent({
            pitch: chord,
            duration: "2",
            velocity: 50,
            channel: 3,
        }));
    }
    return track;
}
// --- Drum Track ---
function generateDrumTrack(length) {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ channel: 10 })); // Channel 10 = percussion
    const kick = 36, snare = 38, hihat = 42;
    for (let i = 0; i < length; i++) {
        if (Math.random() > 0.5)
            track.addEvent(new MidiWriter.NoteEvent({ pitch: [kick], duration: "4", channel: 10 }));
        if (Math.random() > 0.7)
            track.addEvent(new MidiWriter.NoteEvent({ pitch: [snare], duration: "4", channel: 10 }));
        if (Math.random() > 0.3)
            track.addEvent(new MidiWriter.NoteEvent({ pitch: [hihat], duration: randomChoice(["8", "16"]), channel: 10 }));
    }
    return track;
}
// --- Generate full song MIDI ---
function generateSongMIDI(structure) {
    const tracks = [];
    for (const section of structure) {
        tracks.push(generateMelodyTrack(section.length));
        tracks.push(generateBassTrack(section.length));
        tracks.push(generatePadTrack(section.length));
        tracks.push(generateDrumTrack(section.length));
    }
    const writer = new MidiWriter.Writer(tracks);
    const midiFilename = path.join(os.tmpdir(), `ambient_synth_song_${Date.now()}.mid`);
    fs.writeFileSync(midiFilename, writer.buildFile());
    return midiFilename;
}
// --- Convert MIDI to WAV ---
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
server.tool("play_synth_song", "Generate and play a layered ambient synth song.", { tone: z.string().optional().describe("Mood or tone of the track") }, async ({ tone }) => {
    try {
        const structure = generateSongStructure();
        const midiFile = generateSongMIDI(structure);
        const wavFile = await midiToWav(midiFile);
        playWav(wavFile);
        return {
            content: [{ type: "text", text: `🎹 Playing layered ambient synth song: ${structure.map(s => s.name).join(" -> ")}` }],
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
