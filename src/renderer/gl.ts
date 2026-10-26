/** Thin WebGL2 helpers. */

export class GLError extends Error {}

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new GLError(`Could not create ${label} shader`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new GLError(`${label} shader failed to compile:\n${log}`);
  }
  return shader;
}

export interface Program {
  readonly program: WebGLProgram;
  readonly uniforms: Map<string, WebGLUniformLocation>;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string, label: string): Program {
  const v = compileShader(gl, gl.VERTEX_SHADER, vs, `${label}.vert`);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs, `${label}.frag`);
  const program = gl.createProgram();
  if (!program) throw new GLError(`Could not create program ${label}`);
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new GLError(`Program ${label} failed to link:\n${log}`);
  }
  const uniforms = new Map<string, WebGLUniformLocation>();
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    const loc = gl.getUniformLocation(program, info.name);
    if (loc) uniforms.set(name, loc);
  }
  return { program, uniforms };
}

export interface Target {
  readonly framebuffer: WebGLFramebuffer;
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
}

export function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
  filter: number = gl.LINEAR,
): Target {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) throw new GLError('Could not allocate render target');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer);
    throw new GLError(`Render target incomplete (0x${status.toString(16)})`);
  }
  return { framebuffer, texture, width, height };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | null): void {
  if (!t) return;
  gl.deleteFramebuffer(t.framebuffer);
  gl.deleteTexture(t.texture);
}

export function withCommon(source: string, common: string): string {
  return source.replace('//#include common', common);
}
