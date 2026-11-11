import componentSource from './components/HalftoneMono.tsx?raw';

// The React component is the source of truth. Decode only its template-literal
// escapes, exactly as JavaScript would, without rewriting or reformatting GLSL.
function shaderSource(name) {
  const start = componentSource.indexOf(`const ${name} = \``) + `const ${name} = \``.length;
  const end = componentSource.indexOf('`;', start);
  return componentSource.slice(start, end).replaceAll('\\`', '`');
}

export const vertexSource = shaderSource('VERTEX_SHADER');
export const fragmentSource = shaderSource('FRAGMENT_SHADER');
const period = Number(componentSource.match(/const PERIOD = ([\d.]+);/)[1]);
const seed = Number(componentSource.match(/const SEED = ([\d.]+);/)[1]);

export function createHalftoneStage(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;

  let program = null;
  let vao = null;
  let uniforms = {};
  let lastFrame = '';
  let lost = false;
  let disposed = false;

  function compile(type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to allocate a shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function initialize() {
    const shaders = [];
    try {
      shaders.push(compile(gl.VERTEX_SHADER, vertexSource));
      shaders.push(compile(gl.FRAGMENT_SHADER, fragmentSource));
      program = gl.createProgram();
      if (!program) throw new Error('Unable to allocate a program');
      for (const shader of shaders) gl.attachShader(program, shader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program));
      }
      vao = gl.createVertexArray();
      if (!vao) throw new Error('Unable to allocate a vertex array');
      uniforms = Object.fromEntries(['resolution', 'time', 'progress', 'period', 'seed']
        .map(name => [name, gl.getUniformLocation(program, 'u_' + name)]));
      lastFrame = '';
    } catch (error) {
      if (program) gl.deleteProgram(program);
      program = null;
      throw error;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }

  initialize();

  function contextLost(event) {
    event.preventDefault();
    lost = true;
    canvas.dataset.ready = 'false';
  }
  function contextRestored() {
    try {
      initialize();
      lost = false;
    } catch (error) {
      console.warn('Halftone Mono could not recover', error);
    }
  }
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);

  return {
    draw(time, world, offset, pixelRatio) {
      if (lost || disposed) return;
      const maxSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
      const ratio = Math.min(pixelRatio, maxSize / world.w, maxSize / world.h);
      const width = Math.max(1, Math.round(world.w * ratio));
      const height = Math.max(1, Math.round(world.h * ratio));
      canvas.style.width = world.w + 'px';
      canvas.style.height = world.h + 'px';
      canvas.style.left = -offset + 'px';
      const progress = ((time % period) + period) % period / period;
      const frame = `${width},${height},${progress}`;
      if (frame === lastFrame) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      // Rendering the combined world then clipping it in CSS preserves the
      // original gl_FragCoord grid across monitors without changing the GLSL.
      gl.viewport(0, 0, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindVertexArray(vao);
      gl.useProgram(program);
      gl.uniform2f(uniforms.resolution, width, height);
      gl.uniform1f(uniforms.time, progress * period);
      gl.uniform1f(uniforms.progress, progress);
      gl.uniform1f(uniforms.period, period);
      gl.uniform1f(uniforms.seed, seed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.dataset.ready = 'true';
      lastFrame = frame;
    },
    dispose() {
      disposed = true;
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    },
  };
}
