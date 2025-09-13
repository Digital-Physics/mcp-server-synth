import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
// @ts-ignore
import * as WavEncoder from "wav-encoder";
// @ts-ignore
import WavDecoder from "wav-decoder";
import { fileURLToPath } from "url";
// --- ESM __dirname hack ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// --- MCP Server ---
const server = new McpServer({
    name: "sample-synth",
    version: "1.2.0",
});
// --- Helper Functions ---
async function loadSample(filePath, targetSampleRate) {
    if (!fs.existsSync(filePath))
        throw new Error(`Sample not found: ${filePath}`);
    const buffer = fs.readFileSync(filePath);
    const audioData = await WavDecoder.decode(buffer);
    const channelData = audioData.channelData[0];
    const resampled = new Float32Array(Math.floor(channelData.length * targetSampleRate / audioData.sampleRate));
    for (let i = 0; i < resampled.length; i++) {
        resampled[i] = channelData[Math.floor(i * audioData.sampleRate / targetSampleRate)];
    }
    return resampled;
}
function mixBuffers(buffers, offsets) {
    const length = Math.max(...buffers.map((b, i) => b.length + offsets[i]));
    const track = new Float32Array(length);
    buffers.forEach((buf, i) => {
        const offset = offsets[i];
        for (let j = 0; j < buf.length; j++) {
            track[offset + j] += buf[j];
        }
    });
    let max = 0;
    for (let i = 0; i < track.length; i++) {
        const absVal = Math.abs(track[i]);
        if (absVal > max)
            max = absVal;
    }
    if (max > 1)
        for (let i = 0; i < track.length; i++)
            track[i] /= max;
    return track;
}
// --- Generate sequence with repeats, offsets, and random chords ---
function getSampleSequence(tone, repeats = 8) {
    const drumPattern = [
        { sample: "kick.wav", time: 0 },
        { sample: "snare.wav", time: 0.5 },
    ];
    const bassPattern = [
        { sample: "bass_note_C2.wav", time: 0 },
        { sample: "bass_note_C2.wav", time: 0.5 },
    ];
    // Only use available chord samples to avoid missing files
    const chordOptions = ["Cmaj"]; // replace/add other chords if you have them
    const chordPattern = [];
    for (let i = 0; i < repeats; i++) {
        const chord = chordOptions[Math.floor(Math.random() * chordOptions.length)];
        chordPattern.push({ sample: `synth_chord_${chord}.wav`, time: i * 0.5 });
    }
    const sequence = [];
    for (let r = 0; r < repeats; r++) {
        const offset = r * 1.0; // 1 second per repeat
        drumPattern.forEach((d) => sequence.push({ sample: d.sample, time: d.time + offset }));
        bassPattern.forEach((b) => sequence.push({ sample: b.sample, time: b.time + offset }));
    }
    // Add chords
    sequence.push(...chordPattern);
    return sequence;
}
// --- Generate WAV track ---
async function generateSampledTrackFile(tone) {
    const sampleRate = 44100;
    const sampleFolder = path.resolve(__dirname, "../samples");
    const sequence = getSampleSequence(tone, 8);
    const buffers = [];
    const offsets = [];
    for (const event of sequence) {
        const samplePath = path.join(sampleFolder, event.sample);
        if (!fs.existsSync(samplePath)) {
            console.warn(`Missing sample ${event.sample}, skipping.`);
            continue;
        }
        const sampleBuffer = await loadSample(samplePath, sampleRate);
        buffers.push(sampleBuffer);
        offsets.push(Math.floor(event.time * sampleRate));
    }
    const trackBuffer = mixBuffers(buffers, offsets);
    const audioData = { sampleRate, channelData: [trackBuffer] };
    const wav = await WavEncoder.encode(audioData);
    const filePath = path.join(os.tmpdir(), `sampled_${tone}_${Date.now()}.wav`);
    fs.writeFileSync(filePath, Buffer.from(wav));
    return filePath;
}
// --- Play audio asynchronously ---
function playAudioAsync(filePath) {
    const playerCmd = process.platform === "darwin" ? "afplay" : "mpg123";
    const child = spawn(playerCmd, [filePath], { stdio: "ignore", detached: true });
    child.unref(); // allows MCP tool to return immediately
}
// --- MCP Tool ---
server.tool("play_sampled_music", "Play sampled music while LLM types", {
    tone: z.string().describe("Tone of the track (happy, dark, mysterious)"),
}, async ({ tone }) => {
    try {
        const filePath = await generateSampledTrackFile(tone);
        playAudioAsync(filePath); // play without waiting
        return {
            content: [
                { type: "text", text: `Playing '${tone}' track while typing...` },
            ],
        };
    }
    catch (err) {
        return {
            content: [
                { type: "text", text: `Failed to play sampled track: ${err}` },
            ],
        };
    }
});
// --- Main Entrypoint ---
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🎵 Sample Synth MCP Server running on stdio");
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
