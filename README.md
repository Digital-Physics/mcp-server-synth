This repository contains a basic demo of an MCP server with tooling to generate synth music that will play to accompany a text response from a Large Language Model. It is meant to be run locally, as it makes calls to the operating system to play the music, rather than sending that info to the frontend to render sound in the browser.

### Initialize a new npm project:
npm init -y

### Install dependencies:
npm install @modelcontextprotocol/sdk zod@3  
npm install -D @types/node typescript  
npm install wav-encoder wav-decoder  

### Build:
npm run build

### Directory:

```
project-root/
    ├─ build/
    │   └─ index.js
    ├─ samples/
    │   ├─ kick/
    │   ├─ snare/
    │   ├─ chord/
    │   └─ bass/
    │   crickets.wav
    │   rain.wav
    │   water.wav
    │   wind.wav
    ├─ src/
    │   └─ index.ts
```

File Note:
The .wav files in the kick, snare, chord, and bass directories aren't used. They are left over from an old version.

[demo](https://vimeo.com/1121887893)

[![demo](./img/screenshot.png)](https://vimeo.com/1121887893)

https://mcp-dj-presentation.onrender.com/

