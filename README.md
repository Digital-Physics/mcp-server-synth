This repository contains a basic demo of an MCP server with tooling to generate synth music and play it to accompany a text response. 


### Initialize a new npm project
npm init -y

### Install dependencies
npm install @modelcontextprotocol/sdk zod@3  
npm install -D @types/node typescript  
npm install wav-encoder wav-decoder  

### Build
npm run build

```
project-root/
    ├─ build/
    │   └─ index.js
    ├─ img/
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

![pic](./img/screenshot.png)

You can download and play the demo.mp4 file if you want.

[Demo Video](./img/demo.mp4)
[Demo Video](./img/demo2.mp4)

<video src="./img/demo.mp4" width="320" height="240" controls></video>
