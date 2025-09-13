import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
// @ts-ignore
import * as WavEncoder from "wav-encoder";
const server = new McpServer({
    name: "retro-synth",
    version: "1.0.0",
});
// --- Synth Helper Functions ---
function generateRichNoteBuffer(freq, noteLength, sampleRate) {
    const totalSamples = Math.floor(noteLength * sampleRate);
    const buffer = new Float32Array(totalSamples);
    if (freq === 0)
        return buffer;
    const tremoloFreq = 5; // Hz
    const vibratoFreq = 6; // Hz
    const vibratoDepth = 5; // Hz
    for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;
        // Frequency modulation (vibrato)
        const modFreq = freq + vibratoDepth * Math.sin(2 * Math.PI * vibratoFreq * t);
        // Layered oscillators with slight detune
        const sine = Math.sin(2 * Math.PI * modFreq * t) + Math.sin(2 * Math.PI * modFreq * 1.002 * t);
        const square = Math.sign(Math.sin(2 * Math.PI * modFreq * t)) + Math.sign(Math.sin(2 * Math.PI * modFreq * 0.998 * t));
        const saw = 2 * (t * modFreq - Math.floor(t * modFreq + 0.5)) + 2 * (t * modFreq * 1.001 - Math.floor(t * modFreq * 1.001 + 0.5));
        // ADSR envelope
        const attackTime = 0.05 + Math.random() * 0.02;
        const decayTime = 0.1;
        const sustainLevel = 0.7;
        const releaseTime = 0.1;
        let env = 1;
        if (t < attackTime)
            env = t / attackTime;
        else if (t < attackTime + decayTime)
            env = 1 - (1 - sustainLevel) * ((t - attackTime) / decayTime);
        else if (t > noteLength - releaseTime)
            env *= (noteLength - t) / releaseTime;
        // Tremolo
        const tremolo = 1 + 0.05 * Math.sin(2 * Math.PI * tremoloFreq * t);
        buffer[i] = 0.2 * env * tremolo * (sine + square + saw);
    }
    return buffer;
}
function combineBuffers(buffers) {
    const length = Math.max(...buffers.map((b) => b.length));
    const out = new Float32Array(length);
    buffers.forEach((buf) => {
        for (let i = 0; i < buf.length; i++) {
            out[i] += buf[i];
        }
    });
    // Normalize safely
    let max = 0;
    for (let i = 0; i < out.length; i++) {
        const absVal = Math.abs(out[i]);
        if (absVal > max)
            max = absVal;
    }
    if (max > 1) {
        for (let i = 0; i < out.length; i++)
            out[i] /= max;
    }
    return out;
}
async function synthesizeAndPlayRetroTrack(tone) {
    const sampleRate = 44100;
    const noteLength = 0.5;
    const patternRepeats = 4;
    const tones = {
        happy: [262, 330, 392, 494],
        dark: [131, 156, 196, 233],
        mysterious: [262, 311, 370, 440],
    };
    const baseNotes = tones[tone] || tones["mysterious"];
    const sequence = [];
    for (let r = 0; r < patternRepeats; r++) {
        for (let n = 0; n < baseNotes.length; n++) {
            sequence.push(baseNotes[n], baseNotes[n] * 2, baseNotes[n] * 0.5, 0);
        }
    }
    const totalSamples = Math.floor(noteLength * sequence.length * sampleRate);
    const trackBuffer = new Float32Array(totalSamples);
    sequence.forEach((freq, idx) => {
        const startSample = Math.floor(idx * noteLength * sampleRate);
        const noteBuffer = generateRichNoteBuffer(freq, noteLength, sampleRate);
        for (let i = 0; i < noteBuffer.length && startSample + i < trackBuffer.length; i++) {
            trackBuffer[startSample + i] += noteBuffer[i];
        }
    });
    const audioData = { sampleRate, channelData: [trackBuffer] };
    const wav = await WavEncoder.encode(audioData);
    const filePath = path.join(os.tmpdir(), `retro_${tone}_${Date.now()}.wav`);
    fs.writeFileSync(filePath, Buffer.from(wav));
    // Playback
    const playerCmd = process.platform === "darwin" ? "afplay" : "mpg123";
    const playerProcess = spawn(playerCmd, [filePath], { stdio: "ignore", detached: true });
    playerProcess.unref();
    return filePath;
}
// --- MCP Tool ---
server.tool("play_retro_music", "Generate and immediately play retro synth music", {
    tone: z.string().describe("Tone of the track (happy, dark, mysterious)"),
}, async ({ tone }) => {
    try {
        const filePath = await synthesizeAndPlayRetroTrack(tone);
        // Persistent playback
        const playerCmd = process.platform === "darwin" ? "afplay" : "mpg123";
        const playerProcess = spawn(playerCmd, [filePath], { stdio: "ignore", detached: true });
        playerProcess.unref();
        return {
            content: [
                { type: "text", text: `Playing retro synth track '${tone}' at ${filePath}...` },
            ],
        };
    }
    catch (err) {
        return {
            content: [
                { type: "text", text: `Failed to play retro synth: ${err}` },
            ],
        };
    }
});
// --- Main Entrypoint ---
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🎵 Retro Synth MCP Server running on stdio");
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
