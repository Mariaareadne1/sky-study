import type { Atmosphere } from '../atmosphere/timeOfDay';
import { type Camera, createCamera } from './camera';
import { type Program, type Target, GLError, createProgram, createTarget, deleteTarget, withCommon } from './gl';
import { SLOT_DIMS } from '../clouds/shape';
import fullscreenVert from './shaders/fullscreen.vert?raw';
import commonGlsl from './shaders/common.glsl?raw';
import skyLutFrag from './shaders/skyLut.frag?raw';
import noiseFrag from './shaders/noise.frag?raw';
import sceneFrag from './shaders/scene.frag?raw';
import accumulateFrag from './shaders/accumulate.frag?raw';
import presentFrag from './shaders/present.frag?raw';

export const MAX_CLOUDS = 16;
const SKY_LUT_SIZE = [256, 144] as const;
const SHAPE_NOISE_SIZE = 128;
const DETAIL_NOISE_SIZE = 32;
const CAMERA_LIGHT_ALTITUDE = 1.0;
const GROUND_ALBEDO = 0.1;
/** History length kept through gradual changes (blend weight ≈ 1/(n+1)). */
const SOFT_HISTORY_FRAMES = 2;

export type Quality = 'reduced' | 'balanced' | 'high';
const QUALITY_INDEX: Record<Quality, number> = { reduced: 0, balanced: 1, high: 2 };
/** Render-target scale relative to device pixels. */
export const QUALITY_SCALE: Record<Quality, number> = { reduced: 0.36, balanced: 0.5, high: 0.72 };

export interface RenderCloud {
  readonly id: string;
  /** Key of the baked envelope; a new key re-uploads the volume. */
  readonly shapeKey: string;
  readonly envelope: () => Uint8Array;
  readonly position: readonly [number, number, number];
  readonly scale: number;
  readonly yaw: number;
  readonly half: readonly [number, number, number];
  readonly growth: number;
  readonly seed: number;
  readonly density: number;
}

export interface FrameInput {
  readonly clouds: readonly RenderCloud[];
  readonly atmosphere: Atmosphere;
  /** True when something visible changed in a way that invalidates accumulated frames. */
  readonly changed: boolean;
  /** A gradual change (formation, light transition): keep a short temporal blend instead of resetting. */
  readonly softChange?: boolean;
  readonly time: number;
}

export interface RenderStats {
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly accumulated: number;
  readonly quality: Quality;
}

const halton = (i: number, b: number) => {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
};

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly vao: WebGLVertexArrayObject;
  private readonly sceneProg: Program;
  private readonly skyProg: Program;
  private readonly accumProg: Program;
  private readonly presentProg: Program;
  private readonly noiseShape: WebGLTexture;
  private readonly noiseDetail: WebGLTexture;
  private readonly atlas: WebGLTexture;
  private readonly skyLut: Target;
  private readonly hdrInternal: number;
  private readonly hdrType: number;
  private current: Target | null = null;
  private history: [Target | null, Target | null] = [null, null];
  private historyIndex = 0;
  private accumulated = 0;
  private frame = 0;
  private slots = new Map<string, { slot: number; key: string }>();
  private freeSlots: number[] = [];
  private skyKey = '';
  private lastAtmosphere: Atmosphere | null = null;
  quality: Quality;
  /** Internal render resolution relative to the output (device) pixels. */
  renderScale: number;
  camera: Camera;

  constructor(canvas: HTMLCanvasElement, quality: Quality = 'balanced') {
    this.canvas = canvas;
    this.quality = quality;
    this.renderScale = QUALITY_SCALE[quality];
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new GLError('WebGL2 is not available in this browser.');
    this.gl = gl;
    const floatOk = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.hdrInternal = floatOk ? gl.RGBA16F : gl.RGBA8;
    this.hdrType = floatOk ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    if (gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) < SLOT_DIMS.z * MAX_CLOUDS) {
      throw new GLError('This GPU cannot hold the cloud volume atlas (3D textures too small).');
    }
    const vao = gl.createVertexArray();
    if (!vao) throw new GLError('Could not create vertex array');
    this.vao = vao;
    this.sceneProg = createProgram(gl, fullscreenVert, withCommon(sceneFrag, commonGlsl), 'scene');
    this.skyProg = createProgram(gl, fullscreenVert, withCommon(skyLutFrag, commonGlsl), 'skyLut');
    this.accumProg = createProgram(gl, fullscreenVert, accumulateFrag, 'accumulate');
    this.presentProg = createProgram(gl, fullscreenVert, presentFrag, 'present');
    this.noiseShape = this.generateNoise(SHAPE_NOISE_SIZE, 0, gl.RGBA8, gl.RGBA);
    this.noiseDetail = this.generateNoise(DETAIL_NOISE_SIZE, 1, gl.RGBA8, gl.RGBA);
    this.atlas = this.createAtlas();
    this.skyLut = createTarget(gl, SKY_LUT_SIZE[0], SKY_LUT_SIZE[1], this.hdrInternal, gl.RGBA, this.hdrType);
    for (let i = MAX_CLOUDS - 1; i >= 0; i--) this.freeSlots.push(i);
    this.camera = createCamera(1);
  }

  get hdrSupported(): boolean {
    return this.hdrInternal === this.gl.RGBA16F;
  }

  private draw(prog: Program, target: Target | null, width: number, height: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(prog.program);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private generateNoise(size: number, mode: number, internal: number, format: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) throw new GLError('Could not allocate noise volume');
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(gl.TEXTURE_3D, 0, internal, size, size, size, 0, format, gl.UNSIGNED_BYTE, null);
    const prog = createProgram(gl, fullscreenVert, noiseFrag, `noise${mode}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    for (let z = 0; z < size; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z);
      gl.useProgram(prog.program);
      gl.uniform1f(prog.uniforms.get('uSlice')!, (z + 0.5) / size);
      gl.uniform1i(prog.uniforms.get('uMode')!, mode);
      this.draw(prog, { framebuffer: fb, texture: tex, width: size, height: size }, size, size);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteProgram(prog.program);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.generateMipmap(gl.TEXTURE_3D);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
    return tex;
  }

  private createAtlas(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new GLError('Could not allocate cloud atlas');
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RG8, SLOT_DIMS.x, SLOT_DIMS.y, SLOT_DIMS.z * MAX_CLOUDS, 0, gl.RG, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** Assign atlas slots, uploading new envelopes and releasing slots of removed clouds. */
  private syncSlots(clouds: readonly RenderCloud[]): boolean {
    const gl = this.gl;
    let uploaded = false;
    const live = new Set(clouds.map((c) => c.id));
    for (const [id, s] of this.slots) {
      if (!live.has(id)) {
        this.slots.delete(id);
        this.freeSlots.push(s.slot);
      }
    }
    for (const c of clouds) {
      let entry = this.slots.get(c.id);
      if (!entry) {
        const slot = this.freeSlots.pop();
        if (slot === undefined) continue;
        entry = { slot, key: '' };
        this.slots.set(c.id, entry);
      }
      if (entry.key !== c.shapeKey) {
        const data = c.envelope();
        gl.bindTexture(gl.TEXTURE_3D, this.atlas);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, entry.slot * SLOT_DIMS.z, SLOT_DIMS.x, SLOT_DIMS.y, SLOT_DIMS.z, gl.RG, gl.UNSIGNED_BYTE, data);
        entry.key = c.shapeKey;
        uploaded = true;
      }
    }
    return uploaded;
  }

  slotOf(id: string): number | undefined {
    return this.slots.get(id)?.slot;
  }

  private updateSky(a: Atmosphere) {
    const key = [a.hour.toFixed(4), a.haze.toFixed(4)].join('|');
    if (key === this.skyKey) return;
    this.skyKey = key;
    const gl = this.gl;
    const u = this.skyProg.uniforms;
    gl.useProgram(this.skyProg.program);
    gl.uniform3fv(u.get('uSunDir')!, a.sunDir as unknown as number[]);
    gl.uniform3fv(u.get('uSunIlluminance')!, a.sunIlluminance as unknown as number[]);
    gl.uniform3fv(u.get('uMoonDir')!, a.moonDir as unknown as number[]);
    gl.uniform3fv(u.get('uMoonIlluminance')!, a.moonIlluminance as unknown as number[]);
    gl.uniform1f(u.get('uHaze')!, a.haze);
    gl.uniform1f(u.get('uAltitude')!, CAMERA_LIGHT_ALTITUDE);
    gl.uniform1f(u.get('uGroundAlbedo')!, GROUND_ALBEDO);
    gl.uniform3fv(u.get('uTwilightDome')!, a.twilight.dome as unknown as number[]);
    gl.uniform3fv(u.get('uTwilightGlow')!, a.twilight.glow as unknown as number[]);
    this.draw(this.skyProg, this.skyLut, this.skyLut.width, this.skyLut.height);
  }

  /** Size of the internal (raymarched) image for a given output size. */
  renderSizeFor(outW: number, outH: number, scale = this.renderScale): [number, number] {
    return [Math.max(2, Math.round(outW * scale)), Math.max(2, Math.round(outH * scale))];
  }

  private ensureTargets(w: number, h: number) {
    if (this.current && this.current.width === w && this.current.height === h) return;
    const gl = this.gl;
    deleteTarget(gl, this.current);
    deleteTarget(gl, this.history[0]);
    deleteTarget(gl, this.history[1]);
    this.current = createTarget(gl, w, h, this.hdrInternal, gl.RGBA, this.hdrType);
    this.history = [
      createTarget(gl, w, h, this.hdrInternal, gl.RGBA, this.hdrType),
      createTarget(gl, w, h, this.hdrInternal, gl.RGBA, this.hdrType),
    ];
    this.accumulated = 0;
  }

  resetAccumulation() {
    this.accumulated = 0;
  }

  private setSceneUniforms(input: FrameInput, w: number, h: number, jitter: [number, number]) {
    const gl = this.gl;
    const u = this.sceneProg.uniforms;
    const a = input.atmosphere;
    const cam = this.camera;
    const set1f = (n: string, v: number) => { const l = u.get(n); if (l) gl.uniform1f(l, v); };
    const set1i = (n: string, v: number) => { const l = u.get(n); if (l) gl.uniform1i(l, v); };
    const set2f = (n: string, x: number, y: number) => { const l = u.get(n); if (l) gl.uniform2f(l, x, y); };
    const set3 = (n: string, v: readonly number[]) => { const l = u.get(n); if (l) gl.uniform3fv(l, v as unknown as number[]); };
    gl.useProgram(this.sceneProg.program);
    set2f('uResolution', w, h);
    set1f('uFrame', this.frame % 64);
    set2f('uJitter', jitter[0], jitter[1]);
    set3('uCamPos', cam.position);
    set3('uCamForward', cam.forward);
    set3('uCamRight', cam.right);
    set3('uCamUp', cam.up);
    set1f('uTanHalfFov', Math.tan(cam.fovY / 2));
    set1f('uAspect', w / h);
    set3('uSunDir', a.sunDir);
    set3('uSunIlluminance', a.sunIlluminance);
    set3('uMoonDir', a.moonDir);
    set3('uMoonIlluminance', a.moonIlluminance);
    set3('uKeyDir', a.keyDir);
    set3('uKeyColor', a.keyColor);
    set3('uAmbientTop', a.ambientTop);
    set3('uAmbientBottom', a.ambientBottom);
    set1f('uHaze', a.haze);
    set1f('uNight', a.night);
    set1f('uTime', input.time);
    set1i('uQuality', QUALITY_INDEX[this.quality]);
    set1f('uPixelAngle', (2 * Math.tan(cam.fovY / 2)) / h);
    set1f('uSlotCount', MAX_CLOUDS);
    set3('uSlotTexel', [1 / SLOT_DIMS.x, 1 / SLOT_DIMS.y, 1 / SLOT_DIMS.z]);

    const pos = new Float32Array(MAX_CLOUDS * 4);
    const half = new Float32Array(MAX_CLOUDS * 4);
    const prm = new Float32Array(MAX_CLOUDS * 4);
    let n = 0;
    for (const c of input.clouds) {
      const slot = this.slots.get(c.id)?.slot;
      if (slot === undefined || n >= MAX_CLOUDS) continue;
      pos.set([c.position[0], c.position[1], c.position[2], c.scale], n * 4);
      half.set([c.half[0], c.half[1], c.half[2], c.yaw], n * 4);
      prm.set([slot, c.growth, c.seed % 997, c.density], n * 4);
      n++;
    }
    set1i('uCloudCount', n);
    const l1 = u.get('uCloudPos'); if (l1) gl.uniform4fv(l1, pos);
    const l2 = u.get('uCloudHalf'); if (l2) gl.uniform4fv(l2, half);
    const l3 = u.get('uCloudParam'); if (l3) gl.uniform4fv(l3, prm);

    const bind = (unit: number, target: number, tex: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, tex);
      set1i(name, unit);
    };
    bind(0, gl.TEXTURE_2D, this.skyLut.texture, 'uSkyLut');
    bind(1, gl.TEXTURE_3D, this.noiseShape, 'uNoiseShape');
    bind(2, gl.TEXTURE_3D, this.noiseDetail, 'uNoiseDetail');
    bind(3, gl.TEXTURE_3D, this.atlas, 'uAtlas');
  }

  /**
   * Raymarch one frame into the internal targets and accumulate it.
   * `blendFloor` is the minimum weight of the new frame (1 = no history).
   */
  private renderInternal(input: FrameInput, w: number, h: number, blendFloor: number) {
    const gl = this.gl;
    this.ensureTargets(w, h);
    if (this.syncSlots(input.clouds)) this.accumulated = 0;
    if (input.changed) this.accumulated = 0;
    // gradual changes keep a short history: smooths noise without visible lag
    else if (input.softChange) this.accumulated = Math.min(this.accumulated, SOFT_HISTORY_FRAMES);
    this.updateSky(input.atmosphere);
    this.camera = createCamera(w / h);
    const n = this.accumulated;
    const jitter: [number, number] = n === 0 ? [0, 0] : [halton((this.frame % 16) + 1, 2) - 0.5, halton((this.frame % 16) + 1, 3) - 0.5];
    this.setSceneUniforms(input, w, h, jitter);
    this.draw(this.sceneProg, this.current, w, h);

    const blend = n === 0 ? 1 : Math.max(1 / (n + 1), blendFloor);
    const src = this.history[this.historyIndex]!;
    const dst = this.history[1 - this.historyIndex]!;
    gl.useProgram(this.accumProg.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.current!.texture);
    gl.uniform1i(this.accumProg.uniforms.get('uCurrent')!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src.texture);
    gl.uniform1i(this.accumProg.uniforms.get('uHistory')!, 1);
    gl.uniform1f(this.accumProg.uniforms.get('uBlend')!, blend);
    this.draw(this.accumProg, dst, w, h);
    this.historyIndex = 1 - this.historyIndex;
    this.accumulated = Math.min(n + 1, 1e6);
    this.frame++;
    this.lastAtmosphere = input.atmosphere;
  }

  private present(target: Target | null, outW: number, outH: number, a: Atmosphere) {
    const gl = this.gl;
    const u = this.presentProg.uniforms;
    gl.useProgram(this.presentProg.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.history[this.historyIndex]!.texture);
    gl.uniform1i(u.get('uImage')!, 0);
    gl.uniform1f(u.get('uExposure')!, a.exposure);
    gl.uniform1f(u.get('uNight')!, a.night);
    gl.uniform2f(u.get('uResolution')!, outW, outH);
    gl.uniform1f(u.get('uFrame')!, this.frame % 64);
    this.draw(this.presentProg, target, outW, outH);
  }

  /** Render to the canvas. */
  render(input: FrameInput, blendFloor = 0.08): RenderStats {
    const outW = this.canvas.width;
    const outH = this.canvas.height;
    const [w, h] = this.renderSizeFor(outW, outH);
    this.renderInternal(input, w, h, blendFloor);
    this.present(null, outW, outH, input.atmosphere);
    return { renderWidth: w, renderHeight: h, accumulated: this.accumulated, quality: this.quality };
  }

  /**
   * Offscreen high-quality still: renders `samples` jittered frames at the requested
   * size, tone maps, and reads back sRGB pixels (top row first).
   */
  capture(input: FrameInput, width: number, height: number, samples = 24, renderScale = 1): Uint8ClampedArray {
    const gl = this.gl;
    const maxRb = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const limit = Math.min(maxRb, maxTex);
    if (width > limit || height > limit) throw new GLError(`Capture size exceeds this GPU's limit of ${limit}px`);
    const [w, h] = this.renderSizeFor(width, height, renderScale);
    const saved = { current: this.current, history: this.history, idx: this.historyIndex, acc: this.accumulated };
    this.current = null;
    this.history = [null, null];
    this.historyIndex = 0;
    let out: Uint8ClampedArray;
    try {
      this.ensureTargets(w, h);
      for (let i = 0; i < samples; i++) this.renderInternal({ ...input, changed: i === 0 }, w, h, 0);
      const final = createTarget(gl, width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      this.present(final, width, height, input.atmosphere);
      gl.bindFramebuffer(gl.FRAMEBUFFER, final.framebuffer);
      const raw = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      deleteTarget(gl, final);
      out = new Uint8ClampedArray(width * height * 4);
      const row = width * 4;
      for (let y = 0; y < height; y++) out.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    } finally {
      deleteTarget(gl, this.current);
      deleteTarget(gl, this.history[0]);
      deleteTarget(gl, this.history[1]);
      this.current = saved.current;
      this.history = saved.history;
      this.historyIndex = saved.idx;
      this.accumulated = 0;
    }
    return out;
  }

  get atmosphere(): Atmosphere | null {
    return this.lastAtmosphere;
  }

  dispose() {
    const gl = this.gl;
    deleteTarget(gl, this.current);
    deleteTarget(gl, this.history[0]);
    deleteTarget(gl, this.history[1]);
    deleteTarget(gl, this.skyLut);
    gl.deleteTexture(this.noiseShape);
    gl.deleteTexture(this.noiseDetail);
    gl.deleteTexture(this.atlas);
    for (const p of [this.sceneProg, this.skyProg, this.accumProg, this.presentProg]) gl.deleteProgram(p.program);
    gl.deleteVertexArray(this.vao);
    this.slots.clear();
  }
}
