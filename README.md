# Away — Paper Studio

A dual-screen away display arranged as an editable print. Open **Edit poster** for three tabs: Scene, Message, and Display.

## Scenes and materials

Botanical print pairs an original two-ink flower illustration with a textured sheet. Paper cut moves overlapping cut shapes slowly across the page. Overprint shifts two translucent plates against one another. Blank sheet leaves room for typography alone.

Choose cotton rag, laid paper, or kraft. Change the wash color and its strength independently from the lettering and both printing inks. The paper artwork and stock tiles ship with the site and work without WebGL. The scene library also contains the 17 retained motion backgrounds. A browser without WebGL displays a color gradient for those scenes.

## Display

Messages, paper, ink, scene, motion, marquee, and return timers synchronize between same-origin windows in one browser profile. Use **Display → Open on other screen**, move that window to the right monitor, then fullscreen each window. Hardware rendering quality is local to each screen. The second display occupies the right side of the shared print.

M opens the editor. F toggles fullscreen, C pauses motion, and Space changes marquee direction. Direct message editing and the Message tab both support multiline text. Reduced-motion preferences pause motion on first use.

## Run and verify

Use Node 20.19+ or 22.12+. Run `npm ci`, `npm run dev`, `npm test`, and `npm run build`. Vercel serves the generated dist directory.

## Design references

- MoMA describes Matisse arranging cut shapes from sheets of painted paper. This informed the independently colored silhouettes in Paper cut. [Matisse’s cut-outs](https://www.moma.org/magazine/articles/1156)
- Letterform Archive documents Amos Kennedy Jr.’s variable overprinting on chipboard. This informed the interaction between the two inks and the stock in Overprint. [Amos Kennedy Jr.](https://letterformarchive.org/news/amos-kennedy-jr/)
