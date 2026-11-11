"use client";

/**
 * Halftone Mono
 * Black ink on off-white paper. Newsprint with a tide running under it.
 *
 * A single file with no dependencies beyond React. Drop it in, give the parent
 * a height, and it fills it.
 *
 *   <HalftoneMono className="absolute inset-0 -z-10" />
 *
 * It pauses itself when scrolled out of view and holds a still frame for
 * visitors who ask for reduced motion.
 */

import { useEffect, useRef } from "react";

const PERIOD = 20;
const SEED = 10;

/**
 * Post-process blur radius as a fraction of height. 0 skips the whole
 * offscreen path. A fraction rather than pixels so the effect looks the same
 * at every size the component is rendered at.
 */
const BLUR = 0;

const VERTEX_SHADER = `#version 300 es
void main() {
  float x = float((gl_VertexID & 1) << 2);
  float y = float((gl_VertexID & 2) << 1);
  gl_Position = vec4(x - 1.0, y - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

/* Halftone Mono — Scrolltide */

uniform vec2  u_resolution;
uniform float u_time;
uniform float u_progress;
uniform float u_period;
uniform float u_seed;

out vec4 fragColor;

/* ---- parameters ---- */
#define PAL_0 vec3(0.968627, 0.960784, 0.945098)
#define PAL_1 vec3(0.925490, 0.913725, 0.890196)
#define PAL_2 vec3(0.066667, 0.066667, 0.066667)
#define PAL_3 vec3(0.239216, 0.239216, 0.239216)
#define PAL_4 vec3(0.603922, 0.603922, 0.603922)
#define SCALE 1.15
#define LOOP_RADIUS 0.65
#define DOT 9.0
#define DOT_SIZE 1.35
#define ANGLE 0.26
#define OCTAVES 4
#define WARP 1.40
#define FIELD_GAIN 1.45
#define HILIGHT 0.82
#define HILIGHT_GAIN 0.55
#define SATURATION 1.00
#define CONTRAST 1.02
#define VIGNETTE_ON 0
#define VIGNETTE 0.18
#define VIGNETTE_SOFT 0.60
#define GRAIN 0.030
#define GRAIN_SCALE 1.0

/* ---- shared library ---- */
/* =========================================================================
   Scrolltide shader library — shared chunk.

   Inlined into every compiled shader, so anything here ships to the customer
   inside the one file they paste. Keep it dependency-free and keep it short.

   The one non-obvious thing in here is \`fbmL\`. Animated noise does not loop:
   drift it along a line and it never returns, so the MP4 visibly jumps at the
   seam. The fix is to travel a *circle* through two extra noise dimensions,
   which is why the noise below is 4D and not 3D. After one period the sample
   point lands exactly where it started, so frame N is frame 0 and the loop is
   seamless with no crossfade and no ghosting.
   ========================================================================= */

#define PI  3.141592653589793
#define TAU 6.283185307179586

/* ---- hashing ---------------------------------------------------------- */

/* Integer hashes, not the float ones everybody copies.

   The usual \`fract(p * 0.1031)\` family is fine at shader-toy coordinates and
   visibly degenerate at ours. fbm offsets by 19.19 per octave, so the fourth
   octave indexes the lattice past 140, and that hash finishes on
   \`fract(a * b)\` with the product near 18000 — where a 32-bit float has about
   three decimal digits left. Neighbouring cells collide, and value noise with
   colliding corners is not soft noise: it is hard-edged rectangles where a
   whole cell picks up its neighbour's value. They survive the warp, so the
   whole frame carries square seams.

   Every point we hash is a lattice corner, which is to say an integer. Hashing
   it as one costs nothing and the failure mode disappears. */

uint hashU(uvec4 v) {
  uint h = v.x * 0x9E3779B1u;
  h ^= v.y + 0x85EBCA6Bu + (h << 6) + (h >> 2);
  h ^= v.z + 0xC2B2AE35u + (h << 6) + (h >> 2);
  h ^= v.w + 0x27D4EB2Fu + (h << 6) + (h >> 2);
  h ^= h >> 15; h *= 0x2C1B3C6Du;
  h ^= h >> 12; h *= 0x297A2D39u;
  h ^= h >> 15;
  return h;
}

/* 0x8000 keeps negative lattice indices out of the int-to-uint conversion.
   The wrap would be well defined without it, but a bias is cheaper to read
   than the spec paragraph that says so. */
float hash41(vec4 p) {
  return float(hashU(uvec4(ivec4(p) + 0x8000))) * (1.0 / 4294967296.0);
}

/* Takes *whole numbers*. The conversion truncates, so hash21(vec2(0.2, 0.0))
   and hash21(vec2(0.9, 0.0)) return the same value — fine for a pixel index or
   a loop counter, silently wrong for anything fractional. Quantise first
   (floor(p * 8192.0) or similar) if you need to hash a continuous value. */
float hash21(vec2 p) {
  return float(hashU(uvec4(ivec4(vec4(p, 0.0, 0.0)) + 0x8000))) * (1.0 / 4294967296.0);
}

/* ---- 4D value noise --------------------------------------------------- */
/* Sixteen corners, quintic interpolation. Returns roughly -1..1.
   Value noise rather than simplex because it is half the code, and at four
   or more octaves nobody can tell the difference in a background. */

float vnoise4(vec4 x) {
  vec4 i = floor(x);
  vec4 f = fract(x);
  vec4 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  float n0000 = hash41(i + vec4(0.0, 0.0, 0.0, 0.0));
  float n1000 = hash41(i + vec4(1.0, 0.0, 0.0, 0.0));
  float n0100 = hash41(i + vec4(0.0, 1.0, 0.0, 0.0));
  float n1100 = hash41(i + vec4(1.0, 1.0, 0.0, 0.0));
  float n0010 = hash41(i + vec4(0.0, 0.0, 1.0, 0.0));
  float n1010 = hash41(i + vec4(1.0, 0.0, 1.0, 0.0));
  float n0110 = hash41(i + vec4(0.0, 1.0, 1.0, 0.0));
  float n1110 = hash41(i + vec4(1.0, 1.0, 1.0, 0.0));
  float n0001 = hash41(i + vec4(0.0, 0.0, 0.0, 1.0));
  float n1001 = hash41(i + vec4(1.0, 0.0, 0.0, 1.0));
  float n0101 = hash41(i + vec4(0.0, 1.0, 0.0, 1.0));
  float n1101 = hash41(i + vec4(1.0, 1.0, 0.0, 1.0));
  float n0011 = hash41(i + vec4(0.0, 0.0, 1.0, 1.0));
  float n1011 = hash41(i + vec4(1.0, 0.0, 1.0, 1.0));
  float n0111 = hash41(i + vec4(0.0, 1.0, 1.0, 1.0));
  float n1111 = hash41(i + vec4(1.0, 1.0, 1.0, 1.0));

  float a0 = mix(n0000, n1000, u.x);
  float a1 = mix(n0100, n1100, u.x);
  float a2 = mix(n0010, n1010, u.x);
  float a3 = mix(n0110, n1110, u.x);
  float b0 = mix(n0001, n1001, u.x);
  float b1 = mix(n0101, n1101, u.x);
  float b2 = mix(n0011, n1011, u.x);
  float b3 = mix(n0111, n1111, u.x);

  float c0 = mix(a0, a1, u.y);
  float c1 = mix(a2, a3, u.y);
  float d0 = mix(b0, b1, u.y);
  float d1 = mix(b2, b3, u.y);

  return mix(mix(c0, c1, u.z), mix(d0, d1, u.z), u.w) * 2.0 - 1.0;
}

/* ---- fractal noise ---------------------------------------------------- */
/* The per-octave offset keeps the octaves from lining up on the axes, which
   otherwise shows as a faint grid. Scaling and offsetting the loop dimensions
   along with everything else leaves them a circle, so looping survives. */

/* Rotating the plane between octaves is what stops value noise looking like
   value noise. Every octave shares one axis-aligned lattice otherwise, and
   they stack into a visible grid no amount of warping fully hides. An
   irrational-ish angle keeps the octaves from ever re-aligning. */
const mat2 FBM_ROT = mat2(0.80, 0.60, -0.60, 0.80);

float fbm4(vec4 p, int octaves, float lacunarity, float gain) {
  float amp = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * vnoise4(p);
    norm += amp;
    // Only the xy plane turns. zw carry the loop circle, and rotating those
    // would still loop but would drift the two axes out of phase with the
    // pattern, which reads as a wobble rather than a flow.
    p = vec4(FBM_ROT * p.xy, p.zw) * lacunarity + 19.19;
    amp *= gain;
  }
  return sum / max(norm, 1e-5);
}

/* The circle this frame sits on. \`radius\` is how far the pattern travels over
   one loop — bigger means more change, and past about 1.5 the motion starts to
   read as boiling rather than flowing. */
vec2 loopAxis(float progress, float radius) {
  /* fract() so progress 1 lands on bit-identical values to progress 0.
     TAU*1 and TAU*0 are the same angle but not the same float, and cos(TAU)
     is not exactly cos(0) — a discrepancy of about 1e-7 that inverse-distance
     weighting happily amplifies into a visible 8-bit difference at the seam. */
  float a = TAU * fract(progress);
  return vec2(cos(a), sin(a)) * radius;
}

/* Looping fractal noise. \`loop\` comes from loopAxis(). */
float fbmL(vec2 p, vec2 loop, int octaves) {
  return fbm4(vec4(p, loop), octaves, 2.0, 0.5);
}

/* ---- colour ----------------------------------------------------------- */

/* Five-stop ramp. Stops are the midpoints of each blend, so s1 < s2 < s3 < s4
   and each colour peaks at its own stop. */
vec3 ramp5(float t, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4,
           float s1, float s2, float s3, float s4) {
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(c0, c1, smoothstep(0.0, s1, t));
  c = mix(c, c2, smoothstep(s1, s2, t));
  c = mix(c, c3, smoothstep(s2, s3, t));
  c = mix(c, c4, smoothstep(s3, s4, t));
  return c;
}

vec3 saturation(vec3 c, float amount) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, amount);
}

vec3 contrast(vec3 c, float amount) {
  return clamp((c - 0.5) * amount + 0.5, 0.0, 1.0);
}

vec3 vignette(vec3 c, vec2 uv, float amount, float softness) {
  float d = length(uv - 0.5) * 1.41421356;
  return c * (1.0 - amount * smoothstep(1.0 - softness, 1.0, d));
}

/* ---- grain and dither ------------------------------------------------- */
/* Both are deliberately static — no u_time anywhere. Grain that changes every
   frame is the worst case there is for H.264: it is high-frequency detail that
   never repeats, so the encoder spends its whole bitrate on it and the file
   either balloons or turns to mush. Static grain reads as film stock, costs
   almost nothing to encode, and looks the same to the eye. */

/* The wrap before the square is load-bearing, not tidiness.

   The usual form of this trick is \`fract(x/2 + y*y*0.75)\`, which is fine in a
   shader toy at 600px and quietly wrong at 1080p: by y = 1000 the y*y term is
   past 750000, where a 32-bit float can no longer resolve the fractions that
   fract() is there to extract. The dither value then goes flat across whole
   bands of the frame and the result is hard-edged rectangular blocks — which
   look exactly like a broken encoder, and survive into every still and every
   MP4 the factory produces.

   The pattern repeats every two pixels anyway, so wrapping first is exact. */
float bayer2(vec2 a) {
  a = mod(floor(a), 2.0);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}
#define bayer4(a) (bayer2(0.5 * (a)) * 0.25 + bayer2(a))
#define bayer8(a) (bayer4(0.5 * (a)) * 0.25 + bayer2(a))

/* Ordered dither. This is the visible crosshatch that makes a smooth gradient
   read as deliberate rather than as a compression artefact, and it is the one
   effect doing the most work in this whole library. Fewer levels means a more
   obvious pattern. */
vec3 ditherTo(vec3 c, vec2 fragCoord, float levels, float scale) {
  float d = bayer8(fragCoord / max(scale, 0.001)) - 0.5;
  return clamp(floor(c * levels + d + 0.5) / levels, 0.0, 1.0);
}

vec3 addGrain(vec3 c, vec2 fragCoord, float amount, float scale) {
  float g = hash21(floor(fragCoord / max(scale, 0.001))) - 0.5;
  return clamp(c + g * amount, 0.0, 1.0);
}

/* ---- misc ------------------------------------------------------------- */

mat2 rot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

/* A point travelling a circle, for anything that has to return to where it
   started after one loop: a drifting colour spot, a metaball, an orbit. This
   is the same trick as loopAxis, in the image plane rather than in noise. */
vec2 orbit(float progress, float phase, float radius, float lobes) {
  // Wrapped for the same reason as loopAxis: exactness at the seam.
  float a = TAU * fract(progress * lobes + phase);
  return vec2(cos(a), sin(a)) * radius;
}

/* Aspect-corrected coordinates, centred on zero, height normalised to 1. */
vec2 aspectUV(vec2 fragCoord, vec2 res) {
  return (fragCoord - 0.5 * res) / res.y;
}

/* ---- shader ---- */
/* =========================================================================
   Halftone Tide — a flowing field printed as dots.

   Retro screen print, the way a press actually does it: a rotated grid of dots
   whose radius follows the tone underneath. The grid is turned off the axes
   because an upright halftone reads as a screen-door artefact, while the same
   dots at fifteen degrees or so read as print.

   The tone is sampled at the centre of each cell, not per pixel. Sampling per
   pixel would make each dot a tiny smear of the field rather than one solid
   dot of a single size, which is precisely the thing that stops looking like
   halftone.
   ========================================================================= */

float tide(vec2 q, vec2 loop) {
  vec2 w = vec2(
    fbmL(q, loop, 2),
    fbmL(q + vec2(6.30, 2.70), loop, 2)
  );
  return fbmL(q + WARP * w, loop, OCTAVES) * FIELD_GAIN + 0.5;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / u_resolution;
  vec2 loop = loopAxis(u_progress, LOOP_RADIUS);

  mat2 R = rot(ANGLE);

  /* Grid space: one unit per dot cell, rotated off the pixel axes. */
  vec2 g = (R * fragCoord) / DOT;
  vec2 cell = fract(g) - 0.5;

  /* Back to pixel space at the centre of this cell, so every pixel in the cell
     samples the same tone and the dot comes out round and uniform. */
  vec2 centrePx = transpose(R) * ((floor(g) + 0.5) * DOT);
  vec2 q = ((centrePx - 0.5 * u_resolution) / u_resolution.y) * SCALE;
  q += vec2(u_seed * 5.51, u_seed * 3.19);

  float tone = clamp(tide(q, loop), 0.0, 1.0);

  /* sqrt so dot *area* tracks tone. Using the radius directly makes midtones
     read far too light, which is the same reason presses work in area. */
  float r = sqrt(tone) * 0.5 * DOT_SIZE;

  /* One pixel of softening, expressed in grid units. */
  float aa = max(1.5 / DOT, 0.001);
  float ink = smoothstep(r, r - aa, length(cell));

  /* The paper tint drifts with the tone as well, so large pale areas are not
     dead flat. */
  vec3 paper = mix(PAL_0, PAL_1, tone);
  vec3 inkCol = mix(PAL_2, PAL_3, tone);

  vec3 col = mix(paper, inkCol, ink);
  col = mix(col, PAL_4, smoothstep(HILIGHT, 1.0, tone) * HILIGHT_GAIN);

  col = saturation(col, SATURATION);
  col = contrast(col, CONTRAST);

#if VIGNETTE_ON
  col = vignette(col, uv, VIGNETTE, VIGNETTE_SOFT);
#endif

  /* Grain only. An ordered dither on top of a halftone grid is two regular
     patterns fighting, and the interference reads as moire. */
  col = addGrain(col, fragCoord, GRAIN, GRAIN_SCALE);

  fragColor = vec4(col, 1.0);
}

void main() { mainImage(fragColor, gl_FragCoord.xy); }
`;

/* Separable gaussian, run twice — horizontal then vertical. Two passes of N
   taps instead of one pass of N squared.

   The tap count scales with the radius, because a fixed kernel only blurs well
   over the range it was tuned for. The loop bound must be constant, so it runs
   97 iterations and skips inactive taps; u_taps is uniform across the frame, so
   that branch costs no texture fetch and a small blur stays cheap. */
const BLUR_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2  u_step;
uniform vec2  u_res_inv;
uniform float u_sigma;
uniform float u_taps;
uniform float u_dither;
float b2(vec2 a) { a = mod(floor(a), 2.0); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
#define b4(a) (b2(0.5 * (a)) * 0.25 + b2(a))
#define b8(a) (b4(0.5 * (a)) * 0.25 + b2(a))
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy * u_res_inv;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -48; i <= 48; i++) {
    float fi = float(i);
    if (abs(fi) > u_taps) continue;
    float w = exp(-0.5 * (fi * fi) / max(u_sigma * u_sigma, 1e-4));
    sum += texture(u_src, uv + u_step * fi) * w;
    wsum += w;
  }
  vec4 c = sum / max(wsum, 1e-5);
  // Re-dither on the way out. The shader dithers before the blur, and the blur
  // averages that pattern away, leaving a smooth gradient quantised to 8 bits
  // — which bands. Final pass only.
  if (u_dither > 0.5) {
    float d = b8(gl_FragCoord.xy) - 0.5;
    c.rgb = clamp(floor(c.rgb * u_dither + d + 0.5) / u_dither, 0.0, 1.0);
  }
  fragColor = c;
}`;

export type HalftoneMonoProps = {
  className?: string;
  style?: React.CSSProperties;
  /** Multiplier on the loop speed. 1 is the speed it was designed at. */
  speed?: number;
  /** Caps the render resolution. 2 matches a retina display; 1 halves the work. */
  maxDpr?: number;
};

export default function HalftoneMono({
  className,
  style,
  speed = 1,
  maxDpr = 2,
}: HalftoneMonoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };

    const link = (fsSource: string) => {
      const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
      const fs = compile(gl.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) return null;
      const p = gl.createProgram();
      if (!p) return null;
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(p));
        return null;
      }
      return p;
    };

    const program = link(FRAGMENT_SHADER);
    if (!program) return;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const uResolution = gl.getUniformLocation(program, "u_resolution");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uProgress = gl.getUniformLocation(program, "u_progress");
    const uPeriod = gl.getUniformLocation(program, "u_period");
    const uSeed = gl.getUniformLocation(program, "u_seed");

    /* ---- offscreen targets, only when blurring ---- */
    const blurProgram = BLUR > 0 ? link(BLUR_SHADER) : null;
    const bu = blurProgram
      ? {
          src: gl.getUniformLocation(blurProgram, "u_src"),
          step: gl.getUniformLocation(blurProgram, "u_step"),
          resInv: gl.getUniformLocation(blurProgram, "u_res_inv"),
          sigma: gl.getUniformLocation(blurProgram, "u_sigma"),
          taps: gl.getUniformLocation(blurProgram, "u_taps"),
          dither: gl.getUniformLocation(blurProgram, "u_dither"),
        }
      : null;
    const tex: (WebGLTexture | null)[] = [null, null];
    const fbo: (WebGLFramebuffer | null)[] = [null, null];

    const makeTarget = (i: number, w: number, h: number) => {
      if (!tex[i]) {
        tex[i] = gl.createTexture();
        fbo[i] = gl.createFramebuffer();
      }
      gl.bindTexture(gl.TEXTURE_2D, tex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // Clamped, or the wrap drags the opposite edge into every border.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex[i], 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let raf = 0;
    let start = performance.now();
    let visible = true;
    let disposed = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        if (blurProgram) {
          makeTarget(0, w, h);
          makeTarget(1, w, h);
        }
      }
    };

    const drawScene = (progress: number) => {
      gl.useProgram(program);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uTime, progress * PERIOD);
      gl.uniform1f(uProgress, progress);
      gl.uniform1f(uPeriod, PERIOD);
      gl.uniform1f(uSeed, SEED);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const draw = (progress: number) => {
      const w = canvas.width;
      const h = canvas.height;
      gl.viewport(0, 0, w, h);

      if (!blurProgram || !bu) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        drawScene(progress);
        return;
      }

      const radius = Math.max(1, BLUR * h);
      const taps = Math.max(4, Math.min(48, Math.ceil(radius / 2)));
      const stepPx = radius / taps;

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[0]);
      drawScene(progress);

      gl.useProgram(blurProgram);
      gl.uniform1i(bu.src, 0);
      gl.uniform2f(bu.resInv, 1 / w, 1 / h);
      gl.uniform1f(bu.sigma, Math.max(0.6, taps / 3));
      gl.uniform1f(bu.taps, taps);
      gl.activeTexture(gl.TEXTURE0);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[1]);
      gl.bindTexture(gl.TEXTURE_2D, tex[0]);
      gl.uniform2f(bu.step, stepPx / w, 0);
      gl.uniform1f(bu.dither, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, tex[1]);
      gl.uniform2f(bu.step, 0, stepPx / h);
      gl.uniform1f(bu.dither, 128);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = (now: number) => {
      if (disposed) return;
      resize();
      const elapsed = ((now - start) / 1000) * speed;
      draw((elapsed % PERIOD) / PERIOD);
      raf = requestAnimationFrame(frame);
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const play = () => {
      if (raf || disposed) return;
      // Rebase the clock so a pause does not jump the animation forward by
      // however long the element spent off screen.
      start = performance.now() - ((performance.now() - start) % (PERIOD * 1000));
      raf = requestAnimationFrame(frame);
    };

    const still = () => {
      stop();
      resize();
      draw(0);
    };

    const update = () => {
      if (motion.matches || !visible) {
        if (motion.matches) still();
        else stop();
      } else {
        play();
      }
    };

    const ro = new ResizeObserver(() => {
      resize();
      if (!raf) draw(0);
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        update();
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    motion.addEventListener("change", update);
    update();

    return () => {
      disposed = true;
      stop();
      ro.disconnect();
      io.disconnect();
      motion.removeEventListener("change", update);
      gl.deleteProgram(program);
      if (blurProgram) gl.deleteProgram(blurProgram);
      gl.deleteVertexArray(vao);
      for (const t of tex) if (t) gl.deleteTexture(t);
      for (const f of fbo) if (f) gl.deleteFramebuffer(f);
    };
  }, [speed, maxDpr]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: "block", width: "100%", height: "100%", ...style }}
      aria-hidden="true"
    />
  );
}
