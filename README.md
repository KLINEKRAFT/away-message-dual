# Away — Motion Studio

A dual-screen away display with animated backgrounds. Open **Edit display** for three tabs: Scene, Message, and Display.

## Scenes and materials

Contour Lines is the default. Featured cards preview Halftone Mono, Contour Lines, Topo Glow, Tidal Bands, Light Ribbons, Mesh Gradient, and Silk Flow. The library holds 20 motion scenes and three paper compositions. Featured scenes have static image fallbacks when WebGL is unavailable. Paper scenes still offer cotton rag, laid paper, and kraft with a separate color wash.

Scene names stay in the editor. Share a direct example using a query such as `?scene=Tidal%20Bands`. The text color defaults to a contrasting ink for each composition. Selecting a text color overrides Auto.

## Display

Messages, paper, ink, scene, motion, marquee, and return timers synchronize between same-origin windows in one browser profile. Use **Display → Open on other screen**, move that window to the right monitor, then fullscreen each window. Hardware rendering quality is local to each screen. The second display occupies the right side of the shared print.

M opens the editor. F toggles fullscreen, C pauses motion, and Space changes marquee direction. Direct message editing and the Message tab both support multiline text. Reduced-motion preferences pause motion on first use.

## Run and verify

Use Node 20.19+ or 22.12+. Run `npm ci`, `npm run dev`, `npm test`, and `npm run build`. Vercel serves the generated dist directory.

## Design references

- MoMA describes Matisse arranging cut shapes from sheets of painted paper. This informed the independently colored silhouettes in Paper cut. [Matisse’s cut-outs](https://www.moma.org/magazine/articles/1156)
- Letterform Archive documents Amos Kennedy Jr.’s variable overprinting on chipboard. This informed the interaction between the two inks and the stock in Overprint. [Amos Kennedy Jr.](https://letterformarchive.org/news/amos-kennedy-jr/)

- [Codrops gradient topography](https://tympanus.net/codrops/2018/01/24/gradient-topography-animation/), [Paper Waves](https://shaders.paper.design/waves), and [Paper Mesh Gradient](https://shaders.paper.design/mesh-gradient) informed the featured motion choices.
- The native range inputs use a filled track, visible values, and keyboard navigation. [Carbon slider](https://carbondesignsystem.com/components/slider/usage/) · [Radix slider](https://www.radix-ui.com/primitives/docs/components/slider)

## Halftone Mono

The supplied React component lives in `components/HalftoneMono.tsx`. The existing vanilla-JavaScript application loads its vertex and fragment shader strings directly through a small WebGL2 adapter. The shader has its original fixed monochrome palette, static grain, seed 10, zero blur, and 20-second period at speed 1. Background color grading is disabled for this scene to preserve its appearance. Speed and pause use the shared studio clock. Reduced motion fixes the shader at frame zero. Both monitors draw the same full-world pixel grid and crop their own portion. WebGL2 failures show a captured still, and context restoration recreates the GPU resources.
