import * as THREE from 'three';

// Saturn and its presentation pass extracted from the supplied Nightjar stage.
// Preserve the model, lighting, camera, and print constants from that reference.
const CELLS = 190;
const CURVE = new THREE.Vector4(0.1, 0.78, 0.1, 0.92);
const SHADOW_TONE = 0.72;
const INK = new THREE.Color(0.086, 0.086, 0.08);
const SPIN = 0.42;
const ELEV = 0.36;
const DIST = 8.5;
const HALF_SPAN = 2.6;
const GROUND_Y = -1.36;

const PRESENT_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PRESENT_FRAG = /* glsl */ `
uniform sampler2D uScene;
uniform float uPitch;   // device px per cell; the dot fills the whole cell
uniform vec2 uGrid;     // cells
uniform vec3 uInk;
uniform float uTime;
uniform float uJitter;  // per-cell shimmer, stronger mid-morph
uniform vec4 uCurve;    // luminance lo, luminance hi, tone at hi (lit), tone at lo (shadow)
uniform float uShadow;  // ground-shadow tone at full shadow
out highp vec4 fragColor; // GLSL3 ShaderMaterial: three.js does not provide gl_FragColor

const int BAYER[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
bool isObject(vec4 s) { return s.a > 0.995 && !(s.b > 0.5 && s.r < 0.3); }

void main() {
  ivec2 cell = ivec2(floor((gl_FragCoord.xy - 0.5) / uPitch));
  if (cell.x >= int(uGrid.x) || cell.y >= int(uGrid.y)) discard;
  vec4 s = texelFetch(uScene, cell, 0);
  float tick = floor(uTime * 12.0);

  bool ink;
  if (s.b > 0.5 && s.r < 0.3 && s.a > 0.5) {
    ink = true;                                                     // dust / glyph
  } else {
    float tone;
    if (s.a > 0.995) {
      // Two-tone ramp: lit facets go sparse, shadowed facets go near-solid, little in between.
      tone = mix(uCurve.w, uCurve.z, smoothstep(uCurve.x, uCurve.y, s.r));
      tone += (hash12(vec2(cell) + tick * 17.0) - 0.5) * uJitter;
    } else {
      tone = s.a / 0.9 * uShadow;
      // Stray cells hugging the silhouette, so the edge reads as live.
      if (s.a < 0.01) {
        ivec2 m = ivec2(uGrid) - 1;
        bool near = isObject(texelFetch(uScene, clamp(cell + ivec2(1, 0), ivec2(0), m), 0)) ||
                    isObject(texelFetch(uScene, clamp(cell - ivec2(1, 0), ivec2(0), m), 0)) ||
                    isObject(texelFetch(uScene, clamp(cell + ivec2(0, 1), ivec2(0), m), 0)) ||
                    isObject(texelFetch(uScene, clamp(cell - ivec2(0, 1), ivec2(0), m), 0));
        if (near && hash12(vec2(cell) * 0.71 + tick * 3.3) < 0.06 + uJitter * 0.5) tone = 1.0;
      }
    }
    float threshold = (float(BAYER[(cell.y & 3) * 4 + (cell.x & 3)]) + 0.5) / 16.0;
    ink = tone > threshold;
  }
  if (!ink) discard;
  fragColor = vec4(uInk, 1.0);
}`;

function material(albedo, {smooth = false, double = false, map = null, shine = 28} = {}) {
  return new THREE.MeshPhongMaterial({
    color: new THREE.Color(albedo, albedo, albedo),
    flatShading: !smooth,
    side: double ? THREE.DoubleSide : THREE.FrontSide,
    map,
    specular: new THREE.Color(0.22, 0.22, 0.22),
    shininess: shine,
  });
}

function buildSaturn() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  let previous = 0;
  for (const [until, value] of [[0.2,0.62],[0.32,0.9],[0.4,0.7],[0.47,0.98],[0.53,0.82],[0.6,0.98],[0.68,0.7],[0.8,0.92],[1,0.66]]) {
    const gray = Math.round(value * 255);
    context.fillStyle = `rgb(${gray},${gray},${gray})`;
    context.fillRect(0, Math.round((1 - until) * canvas.height), canvas.width, Math.ceil((until - previous) * canvas.height) + 1);
    previous = until;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  const planet = new THREE.Mesh(new THREE.SphereGeometry(0.66, 36, 24), material(1, {smooth:true, map:texture, shine:18}));
  const inner = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.14, 72, 1), material(0.98, {double:true}));
  const outer = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.42, 72, 1), material(0.72, {double:true}));
  const rings = new THREE.Group();
  rings.add(inner, outer);
  rings.rotation.x = -Math.PI / 2;
  const tilt = new THREE.Group();
  tilt.add(planet, rings);
  tilt.rotation.set(0.42, 0, 0.38);

  const model = new THREE.Group();
  model.add(tilt);
  model.updateMatrixWorld(true);
  const center = new THREE.Box3().setFromObject(model, true).getCenter(new THREE.Vector3());
  const vertex = new THREE.Vector3();
  let farthest = 0;
  model.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      farthest = Math.max(farthest, vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).distanceTo(center));
    }
  });
  const scale = 1.36 / farthest;
  model.scale.setScalar(scale);
  model.position.copy(center).multiplyScalar(-scale);
  return model;
}

export function createSaturnStage(canvas) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias:false, alpha:true, powerPreference:'high-performance'});
  renderer.setPixelRatio(1);
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 40);
  const spinner = new THREE.Group();
  spinner.add(buildSaturn());
  scene.add(spinner);

  const key = new THREE.DirectionalLight(0xffffff, 3.1);
  key.position.set(-4.4, 3.3, 1.5);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(4, -1.2, 2.4);
  const ambient = new THREE.AmbientLight(0xffffff, 0.3);
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.position.set(-0.8, 7, 0.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0006;
  Object.assign(sun.shadow.camera, {left:-2.6, right:2.6, top:2.6, bottom:-2.6, near:2, far:12});
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(key, fill, ambient, sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({color:0x000000, opacity:0.9}));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  ground.receiveShadow = true;
  scene.add(ground);

  const target = new THREE.WebGLRenderTarget(1, 1, {minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:true});
  const present = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: PRESENT_VERT,
    fragmentShader: PRESENT_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uScene:{value:target.texture}, uPitch:{value:3}, uGrid:{value:new THREE.Vector2(1,1)},
      uInk:{value:new THREE.Vector3(INK.r,INK.g,INK.b)}, uTime:{value:0},
      uJitter:{value:0.035}, uCurve:{value:CURVE}, uShadow:{value:SHADOW_TONE},
    },
  });
  const presentScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), present);
  quad.frustumCulled = false;
  presentScene.add(quad);
  const presentCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  let lastFrame = '';
  let lost = false;
  let disposed = false;
  let width = 0;
  let height = 0;

  function contextLost(event) {
    event.preventDefault();
    lost = true;
    canvas.dataset.ready = 'false';
  }
  function contextRestored() {
    lost = false;
    lastFrame = '';
  }
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);

  return {
    draw(time, world, offset, pixelRatio, reduced = false) {
      if (lost || disposed) return;
      const w = Math.max(2, Math.round(world.w * pixelRatio));
      const h = Math.max(2, Math.round(world.h * pixelRatio));
      canvas.style.width = world.w + 'px';
      canvas.style.height = world.h + 'px';
      canvas.style.left = -offset + 'px';
      const now = reduced ? 0 : time;
      const frame = `${w},${h},${now}`;
      if (frame === lastFrame) return;
      if (w !== width || h !== height) {
        width = w;
        height = h;
        renderer.setSize(w,h,false);
        const pitch = Math.max(3,Math.round(Math.min(w,h)/CELLS));
        const cx = Math.ceil(w/pitch);
        const cy = Math.ceil(h/pitch);
        target.setSize(cx,cy);
        present.uniforms.uPitch.value = pitch;
        present.uniforms.uGrid.value.set(cx,cy);
        const aspect = cx/cy;
        const halfV = aspect >= 1 ? HALF_SPAN : HALF_SPAN/aspect;
        camera.aspect = aspect;
        camera.fov = THREE.MathUtils.radToDeg(2*Math.atan(halfV/DIST));
        camera.position.set(0,Math.sin(ELEV)*DIST,Math.cos(ELEV)*DIST);
        camera.lookAt(0,-0.22,0);
        camera.updateProjectionMatrix();
      }
      spinner.rotation.set(reduced ? 0 : 0.1*Math.sin(now*0.55), (now*SPIN)%(Math.PI*2), 0);
      spinner.position.y = reduced ? 0 : 0.04*Math.sin(now*1.15);
      present.uniforms.uTime.value = now%1000;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0xffffff,0);
      renderer.clear();
      renderer.render(scene,camera);
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000,0);
      renderer.clear();
      renderer.render(presentScene,presentCamera);
      canvas.dataset.ready = 'true';
      lastFrame = frame;
    },
    dispose() {
      disposed = true;
      canvas.removeEventListener('webglcontextlost',contextLost);
      canvas.removeEventListener('webglcontextrestored',contextRestored);
      scene.traverse(object => {
        object.geometry?.dispose();
        for (const mat of object.material ? [object.material].flat() : []) {
          mat.map?.dispose();
          mat.dispose();
        }
      });
      sun.shadow.dispose();
      quad.geometry.dispose();
      present.dispose();
      target.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
