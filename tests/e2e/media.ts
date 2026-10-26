import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffprobePath: string = require('ffprobe-static').path;
const ffmpegPath: string = require('ffmpeg-static');

/** Width/height from a PNG's IHDR chunk; throws if the signature is wrong. */
export function pngInfo(path: string): { width: number; height: number; bytes: number } {
  const buf = readFileSync(path);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => buf[i] === b)) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

export interface ProbeResult {
  format: string;
  codec: string;
  width: number;
  height: number;
  duration: number;
  frames: number;
  fps: number;
}

/** Inspect a video with ffprobe and fully decode it to count frames (proves it plays). */
export function probeVideo(path: string): ProbeResult {
  const json = JSON.parse(
    execFileSync(ffprobePath, ['-v', 'error', '-count_frames', '-show_entries', 'format=format_name,duration:stream=codec_name,width,height,nb_read_frames,avg_frame_rate,r_frame_rate', '-of', 'json', path]).toString(),
  );
  const s = json.streams.find((x: { codec_name?: string; width?: number }) => x.width);
  const [n, d] = String(s.avg_frame_rate || s.r_frame_rate).split('/').map(Number);
  let duration = Number(json.format.duration);
  const frames = Number(s.nb_read_frames);
  const fps = d ? n / d : 0;
  // MediaRecorder WebM often lacks a container duration; derive it from decoded frames.
  if (!Number.isFinite(duration) || duration <= 0) duration = fps > 0 ? frames / fps : NaN;
  return { format: json.format.format_name, codec: s.codec_name, width: s.width, height: s.height, duration, frames, fps };
}

/** Decode one frame to raw RGB and return its mean colour — proves the video has real content. */
export function meanFrameColor(path: string, atSeconds: number): [number, number, number] {
  const raw = execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(atSeconds), '-i', path, '-frames:v', '1', '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < raw.length; i += 3) { r += raw[i]; g += raw[i + 1]; b += raw[i + 2]; }
  const n = raw.length / 3;
  return [r / n, g / n, b / n];
}
