import { computeAtmosphere, luminance } from '../src/atmosphere/timeOfDay';
import { skyRadiance } from '../src/atmosphere/physics';
import { dirFromAngles, DEG } from '../src/math/vec';
const f = (v: readonly number[]) => v.map((x) => x.toFixed(4)).join(', ');
for (const h of (process.argv[2] ?? '6.35,12.5,18.2,19,19.45,20,22.5').split(',').map(Number)) {
  const a = computeAtmosphere(h);
  const lights = [{ dir: a.sunDir, illuminance: a.sunIlluminance }, { dir: a.moonDir, illuminance: a.moonIlluminance }];
  const zen = skyRadiance(1, [0, 1, 0], lights, { haze: a.haze });
  const fwd = skyRadiance(1, dirFromAngles(0, 20 * DEG), lights, { haze: a.haze });
  console.log(h, 'sunEl', (Math.asin(a.sunDir[1]) / DEG).toFixed(1), 'exp', a.exposure.toFixed(2), 'night', a.night.toFixed(2),
    '\n  key', f(a.keyColor), 'L', luminance(a.keyColor).toFixed(3),
    '\n  top', f(a.ambientTop), 'L', luminance(a.ambientTop).toFixed(4),
    '\n  zenith*exp', f(zen.map((x) => x * a.exposure)), ' fwd20*exp', f(fwd.map((x) => x * a.exposure)));
}
