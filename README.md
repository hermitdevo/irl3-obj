# IRL3 Objects

**Create objects and scan the world with your camera.** Point your camera at anything around you: IRL3 Objects recognizes what it is and its colour, draws it as line art and keeps it in your own Object Library.

This is the local edition of the object scanner from [irl3.tech](https://irl3.tech). It runs entirely on your own computer, in your own browser: no account, no server, no database, no tracking.

![IRL3 Objects](docs/irl3-obj.gif)

## What it does

- **Scan the World**: a live camera view. Brackets find the object in front of you, and once the scanner knows what it is (its kind and colour) it locks on and shows whether that object is already in your library. One tap creates it.
- **Create an object**: a guided scan of a single object. You turn it slowly in front of the camera; the scanner names it (with its three best guesses to choose from, or type your own), finds its colour and draws it. Save it to your library.
- **Object Library**: every object you created, with its drawing, kind and colour. Download an object as a file, import objects from files, or delete them. IRL3's pink banana is there as a demo.

An object is known by its **kind and colour**: an orange lighter and a blue lighter are two different objects; two orange lighters are the same one.

## Requirements

- [Node.js](https://nodejs.org) 20.9 or newer
- A recent Chrome, Edge, Safari or Firefox. WebGPU makes scanning much faster; without it the scanner runs on the CPU.
- A camera. On a computer without one, use your phone on the same Wi-Fi (see below).

## Quick start

```bash
git clone https://github.com/hermitdevo/irl3-obj.git
cd irl3-obj
npm install
npm run dev
```

Open http://localhost:3000 and allow the camera. The first visit downloads the recognition models (about 100 MB); after that they come from your browser's cache.

For a faster, optimized build:

```bash
npm run build
npm start
```

### Use your phone's camera

Cameras only work on secure pages. To open the app from a phone on the same Wi-Fi:

```bash
npm run dev:lan
```

It prints an `https://` address for your local network. Open it on your phone and accept the certificate warning once (the certificate is generated on your computer with OpenSSL, which must be installed). Your phone then talks only to your own computer.

## Using it

### Scan the World

1. Open the app: the camera starts by itself.
2. Point it at an object and hold it inside the view. The status at the top says what the scanner is doing.
3. When it locks on, a card on the object shows its kind and colour, and whether it is in your library.
4. Tap **Create object** to add it: its drawing is made from the live picture.

The button at the bottom left opens your library; the one at the bottom right switches between the front and back cameras.

### Create an object

1. Go to **Object Library** and tap **Create new object**.
2. Centre the object and tap **Scan**, then turn the object slowly when asked.
3. Check the result: the drawing, the colour and the kind. Pick another guess if the first one is wrong, or type what it is.
4. Tap **Save**.

### Object Library

- **Download** an object as a small JSON file (its kind, colour and drawing).
- **Import** object files to restore them or to move them to another browser.
- **Delete** an object you no longer want.

Objects are kept in your browser's storage (localStorage) for this address. Clearing the site's data deletes them: download them first if you want to keep them.

## Privacy

- Camera images are processed in your browser and never leave your device.
- There is no server-side code, no database and no analytics. Your library stays in your browser.
- The only downloads are the app's own files and, on first use, the recognition models (from Hugging Face) and the ONNX runtime (from jsDelivr). After that they come from your browser's cache.

## Tips for good scans

- Use good, even light and keep the object inside the view.
- One object at a time, on a plain background if you can.
- Hold it in your hand or put it on a table; the scanner cuts it out from its surroundings and from the hand holding it.
- Shiny, transparent or very dark objects are harder to read.

## Under the hood

| Step | What runs |
| --- | --- |
| Finding the object | DINOv2-small (ONNX) through transformers.js, on WebGPU or WebAssembly |
| Isolation | SlimSAM on computers, GrabCut (OpenCV.js) on phones: the object is cut out from its surroundings and the hand holding it |
| Kind | MobileCLIP-S0 zero-shot recognition against a precomputed table of object kinds (`public/models/object-kinds.*`) |
| Colour | The object's main colour cluster in Lab space, skin excluded, voted over several views |
| Drawing | Line art from the object's outline and shading |

```
src/
  app/                 pages: Scan the World (/), Object Library (/library), new object (/library/new)
  components/scan/     the live scanner
  components/library/  the library and the guided object scan
  lib/vision/          recognition, isolation, kind, colour, line art
  lib/objects/         the object kinds and the library store
scripts/
  copy-vendor.mjs            copies OpenCV.js and the ONNX runtime into public/vendor
  dev-lan.mjs                HTTPS dev server for phones on your network
  build-kind-embeddings.ts   rebuilds the object kinds table
```

### Adding object kinds

The kinds the scanner can name are listed in `src/lib/objects/object-kinds.ts`. After editing the list, rebuild the table:

```bash
npm run kinds
```

## Development

```bash
npm test        # unit tests: colour and mask clean-up
npm run lint
```

## License

[MIT](LICENSE). Made by [IRL3](https://irl3.tech).
