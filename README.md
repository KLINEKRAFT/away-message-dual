# Away / Motion Studio

A full-screen, desktop-first away display with synchronized dual-monitor backgrounds and marquee text.

## What's included

- 34 backgrounds: the original 18, 12 new procedural shaders, and 4 Three.js scenes.
- 24 palettes, 24 ready-made looks, a saved personal look, and Shuffle with Undo.
- 25 type animation choices (including Still): letter waves, bounce, echo, outline, elastic type, and 4 dimensional treatments.
- Pause/resume, continuous motion speed, timed background cycling, and three rendering quality levels.
- Editable multiline messages, quick break messages, return timers, fullscreen, and the existing microphone pulse / particle modes.
- A four-tab studio with keyboard controls. The interface fades out after 4.5 seconds of inactivity.
- Animated-gradient fallback when WebGL is unavailable; the message, clock, and controls remain usable.

## Run

Node 20.19+ or 22.12+ is required by Vite. Use `npm ci`, then `npm run dev`. `npm run build` produces `dist/`; the included Vercel configuration selects this output. Three.js is bundled locally and loaded on demand. Google Fonts remain optional; system typefaces work if font downloads fail.

## Desktop controls

Open **Edit look** to access Looks, Scene, Type, and Setup. Use **Setup → Open on other screen** and move the second window to the right-hand monitor; fullscreen each window independently. Messages, colors, backgrounds, motion, timers, and particle settings synchronize between windows on the same origin. This is window synchronization within one browser profile, not cross-device cloud sync.

| Key | Action |
| --- | --- |
| M | Studio |
| F | Fullscreen |
| R / Z | Shuffle / undo |
| C | Pause / resume motion |
| P / B / N / T | Next preset / background / animation / typeface |
| X | Next particle mode |
| S | Cycle backgrounds |
| Space | Cycle scrolling direction |
| Left / right | Adjust marquee speed |
| L | Lock direct text editing |
| Escape | Close studio |

Shortcuts yield to focused inputs and buttons. Pause defaults on when the operating system requests reduced motion. Quality is local to each screen so a laptop can run a lower resolution while another display uses High.

Dimensional type is centered per monitor. Scrolling uses the normal marquee layer. Sculpture uses the bundled geometric font; other dimensional effects use the chosen typeface. Non-ASCII messages retain readable canvas type. Microphone access is requested only when Audio pulse is explicitly enabled.

## Verification

`npm test` runs 11 DOM integration and clock regression tests, including no-GPU initialization, every preset, message edits, native keyboard input, Shuffle/Undo, saved settings, timers, and the dual-window message protocol.

Optional Linux graphics validation requires EGL with a surfaceless OpenGL ES 2 implementation and Python Pillow:

```sh
node tests/export-shaders.mjs /tmp/away-qa
python tests/render-shaders.py /tmp/away-qa
```

This compiles and links 36 programs, renders the 30 procedural backgrounds plus the four 3D underlays, and produces a contact sheet. It does **not** render the Three.js meshes or validate a real browser GPU. The shipped thumbnails are actual captures of the procedural shaders using the Acid Punch palette.

Validation in the authoring environment: production build and all 11 integration tests passed; all 36 graphics programs compiled and linked with Mesa llvmpipe. The browser could inspect the original public app, where unavailable WebGL caused a startup crash. Access to the local browser preview was blocked, so desktop browser visual QA and actual Three.js scene rendering remain unverified. Check those on a hardware-accelerated desktop browser before merging.

## Research and implementation

New shaders are original implementations. References that informed the direction:

- [Codrops: rotating twisted 3D typography](https://tympanus.net/codrops/2023/01/20/rotating-twisted-3d-typography-with-three-js-and-shaders/) — vertex deformation and dimensional type.
- [Three.js ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html) — custom GPU text deformation.
- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) — repeated confetti geometry with fewer draw calls.
- [Three.js examples](https://threejs.org/examples/) — procedural color, particles, and geometry experiments.

Three.js and its example font are distributed through the pinned npm dependency under its included license. Existing branding and the original display features are retained.
