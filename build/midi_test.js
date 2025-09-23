import fs from "fs";
import { spawn } from "child_process";
import MidiWriter from "midi-writer-js";

// 1. Generate a random melody track
function generateRandomMelody() {
  const track = new MidiWriter.Track();
  track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 1 })); // Piano

  // Simple random melody (16 notes)
  for (let i = 0; i < 16; i++) {
    const pitch = ["C4", "D4", "E4", "G4", "A4"][Math.floor(Math.random() * 5)];
    const duration = ["4", "8"][Math.floor(Math.random() * 2)]; // quarter or eighth note
    track.addEvent(new MidiWriter.NoteEvent({ pitch: [pitch], duration }));
  }

  return new MidiWriter.Writer(track);
}

// 2. Save MIDI file
const melody = generateRandomMelody();
const midiFilename = "output.mid";
fs.writeFileSync(midiFilename, melody.buildFile());

// 3. Convert MIDI → WAV with timidity
const wavFilename = "output.wav";
const timidity = spawn("timidity", [midiFilename, "-Ow", "-o", wavFilename]);

timidity.stdout.on("data", (data) => {
  console.log(`timidity: ${data}`);
});

timidity.stderr.on("data", (data) => {
  console.error(`timidity error: ${data}`);
});

timidity.on("close", (code) => {
  console.log(`timidity finished with code ${code}`);

  if (code === 0) {
    // 4. Play the wav file
    const playerCmd = process.platform === "darwin" ? "afplay" : "play"; // Mac vs Linux
    const player = spawn(playerCmd, [wavFilename]);

    player.on("close", () => {
      console.log("Playback finished.");
    });
  }
});
