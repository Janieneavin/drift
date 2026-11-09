"use client";

import { useEffect, useRef } from "react";
import type { Engine } from "@/lib/engine/Engine";

/**
 * A night horizon over a calm sea, rendered on the GPU and driven by the
 * music: the aurora takes its colour from the current chord, the sun
 * rises with the dramatic arc, the water glitters with each note, kicks
 * send a pulse along the horizon, and everything breathes with loudness.
 */

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uHue;       // chord colour, 0..1
uniform float uIntensity; // dramatic arc, 0..1
uniform float uLevel;     // loudness, 0..1
uniform float uPulse;     // kick drum, decays
uniform float uEnergy;    // recent note activity
uniform float uFlash;     // chord change, decays
uniform float uErosion;   // "less recognizable" rule
uniform float uOpenX;     // centre of the open area, 0..1

vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}

// the sky above the horizon (also sampled, distorted, for the reflection)
vec3 sky(vec2 uv, float t, float horizon, vec2 sunPos) {
  float h = uv.y - horizon;
  vec3 deep = hsv(uHue + 0.62, 0.65, 0.05);
  vec3 low = hsv(uHue + 0.02, 0.55, 0.16 + 0.22 * uIntensity);
  vec3 col = mix(low, deep, smoothstep(0.0, 0.75, h));

  // aurora curtains: folded ribbons whose lower edge waves and drifts
  float ax = uv.x * 1.3 + fbm(vec2(uv.x * 0.7, t * 0.025)) * 1.8;
  float edge = 0.1 + 0.16 * fbm(vec2(ax * 1.5, t * 0.04));          // wavy bottom edge
  float top = edge + 0.25 + 0.25 * fbm(vec2(ax * 0.9 + 7.0, t * 0.03)); // ragged top
  float band = fbm(vec2(ax * 1.1, t * 0.045));
  float curtain = smoothstep(0.38, 0.85, band) * smoothstep(edge - 0.01, edge + 0.05, h) * smoothstep(top, edge + 0.04, h);
  // fine rays along the folds, uneven and drifting
  float fold = fbm(vec2(ax * 9.0 + t * 0.05, h * 0.6));
  float streak = 0.35 + 0.65 * pow(fold, 1.6) * 1.6;
  // brightest just above the lower edge, like real aurora
  float glowEdge = exp(-(h - edge) * 6.0);
  float aur = curtain * streak * (0.55 + 0.9 * glowEdge) * (0.3 + 0.9 * uIntensity + 0.6 * uLevel);
  vec3 aColA = hsv(uHue + 0.38, 0.75, 1.0);
  vec3 aColB = hsv(uHue + 0.55, 0.7, 1.0);
  col += aur * mix(aColA, aColB, smoothstep(0.1, 0.6, h)) * 0.55;

  // stars, fading where the aurora and the sun are bright
  vec2 sp = uv * vec2(uRes.x / uRes.y, 1.0) * 140.0;
  vec2 cell = floor(sp);
  float star = step(0.985, hash(cell));
  float tw = 0.5 + 0.5 * sin(t * (1.0 + hash(cell + 3.1) * 3.0) + hash(cell) * 30.0);
  float d = length(fract(sp) - 0.5);
  col += star * tw * smoothstep(0.12, 0.0, d) * smoothstep(0.05, 0.4, h) * (1.0 - aur) * 0.9;

  // the sun: rises with the arc, glows with loudness
  vec2 sd = (uv - sunPos) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(sd);
  float size = 0.045 + 0.03 * uIntensity;
  vec3 sunCol = hsv(uHue + 0.07, 0.45 - 0.3 * uIntensity, 1.0);
  col += sunCol * smoothstep(size, size * 0.8, r) * (0.6 + 0.6 * uIntensity);
  col += sunCol * exp(-r * (9.0 - 4.0 * uIntensity)) * (0.25 + 0.6 * uIntensity + 0.4 * uLevel);
  // light rays at the climax
  float ang = atan(sd.y, sd.x);
  float rays = pow(0.5 + 0.5 * sin(ang * 13.0 + t * 0.15 + fbm(vec2(ang * 3.0, t * 0.08)) * 5.0), 5.0);
  rays *= 0.3 + 0.7 * fbm(vec2(ang * 6.0, t * 0.06)); // uneven lengths, like light through haze
  col += sunCol * rays * exp(-r * 4.2) * smoothstep(0.55, 1.0, uIntensity) * 0.22 * step(0.0, h);

  // kick drum: a soft band of light along the horizon
  col += hsv(uHue + 0.05, 0.5, 1.0) * uPulse * exp(-abs(h) * 28.0) * 0.5;
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float t = uTime;
  float horizon = 0.34 + 0.02 * sin(t * 0.05);
  vec2 sunPos = vec2(uOpenX, horizon - 0.08 + 0.26 * uIntensity);

  vec3 col;
  if (uv.y >= horizon) {
    col = sky(uv, t, horizon, sunPos);
  } else {
    // the sea: a rippled mirror of the sky
    float depth = (horizon - uv.y) / horizon;
    float w1 = fbm(vec2(uv.x * 6.0, uv.y * 40.0 / (depth + 0.15) + t * 0.6));
    float w2 = sin(uv.y * 220.0 / (depth + 0.2) + t * 1.8 + w1 * 6.0);
    vec2 ruv = vec2(uv.x + (w1 - 0.5) * 0.04 * depth + w2 * 0.003, 2.0 * horizon - uv.y + (w1 - 0.5) * 0.05 * depth);
    col = sky(ruv, t, horizon, sunPos) * (0.55 - 0.3 * depth);
    // a path of light from the sun
    float path = exp(-abs(uv.x - sunPos.x) * (18.0 - 10.0 * depth)) * smoothstep(-0.2, 1.0, w2);
    col += hsv(uHue + 0.07, 0.35, 1.0) * path * (0.12 + 0.5 * uIntensity) * (1.0 - depth * 0.6);
    // glitter: notes make the water sparkle
    vec2 gp = vec2(uv.x * 260.0, uv.y * 900.0 / (depth + 0.3));
    float g = step(0.992 - 0.01 * uEnergy, hash(floor(gp) + floor(t * 6.0)));
    col += g * (0.25 + 1.2 * uEnergy) * (1.0 - depth) * hsv(uHue + 0.45, 0.3, 1.0);
    col += hsv(uHue + 0.05, 0.5, 1.0) * uPulse * 0.08 * (1.0 - depth);
    col *= mix(vec3(1.0), hsv(uHue + 0.6, 0.4, 0.6), depth * 0.6);
  }

  // chord change: a brief bloom of colour
  col += hsv(uHue + 0.2, 0.6, 1.0) * uFlash * 0.06;
  // dissolving music: the picture softens and drifts
  col = mix(col, vec3(dot(col, vec3(0.33))), uErosion * 0.35);
  // vignette and a little film grain
  vec2 q = uv - 0.5;
  col *= 1.0 - dot(q, q) * 1.1;
  col += (hash(uv * uRes + t) - 0.5) * 0.025;
  gl_FragColor = vec4(pow(max(col, 0.0), vec3(0.92)), 1.0);
}
`;

interface Props {
  engine: Engine | null;
  /** Where the open area is centred (0..1 across the screen). */
  openX: number;
  onUnsupported: () => void;
}

export default function ShaderBackdrop({ engine, openX, onUnsupported }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const openRef = useRef(openX);
  openRef.current = openX;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !engine) return;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) {
      onUnsupported();
      return;
    }
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || (gl.isContextLost() ? "context lost" : "shader error"));
      return sh;
    };
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
    } catch (err) {
      console.warn("[drift] backdrop unavailable", err);
      onUnsupported();
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const U = {
      res: u("uRes"),
      time: u("uTime"),
      hue: u("uHue"),
      intensity: u("uIntensity"),
      level: u("uLevel"),
      pulse: u("uPulse"),
      energy: u("uEnergy"),
      flash: u("uFlash"),
      erosion: u("uErosion"),
      openX: u("uOpenX"),
    };

    // render a little below full resolution: soft, and light on the GPU
    const scale = 0.6;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    // musical state, smoothed
    let hue = 0.6;
    let hueTarget = 0.6;
    let pulse = 0;
    let energy = 0;
    let flash = 0;
    let level = 0;
    let intensity = 0.5;
    let openSmooth = openRef.current;
    const pending: { time: number; kind: "chord" | "kick" | "note"; pc?: number; vel?: number }[] = [];
    const off = engine.on((e) => {
      if (e.kind === "chord" && e.pcs.length) pending.push({ time: e.time, kind: "chord", pc: e.pcs[0] });
      else if (e.kind === "note") pending.push({ time: e.time, kind: e.role === "drums" && e.midi === 36 ? "kick" : "note", vel: e.velocity });
    });

    const t0 = performance.now();
    let last = t0;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const nowMs = performance.now();
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const snap = engine.snapshot();
      for (let i = pending.length - 1; i >= 0; i--) {
        const ev = pending[i];
        if (ev.time > snap.now + 0.02) continue;
        pending.splice(i, 1);
        if (ev.kind === "chord") {
          hueTarget = (0.58 + (ev.pc ?? 0) / 12) % 1;
          flash = 1;
        } else if (ev.kind === "kick") pulse = Math.max(pulse, ev.vel ?? 1);
        else energy = Math.min(1, energy + 0.12 + (ev.vel ?? 0.5) * 0.15);
      }
      if (pending.length > 400) pending.splice(0, pending.length - 400);
      // glide the colour the short way round the wheel
      let dh = hueTarget - hue;
      if (dh > 0.5) dh -= 1;
      if (dh < -0.5) dh += 1;
      hue = (hue + dh * Math.min(1, dt * 0.35) + 1) % 1;
      pulse = Math.max(0, pulse - dt * 3);
      energy = Math.max(0, energy - dt * 0.6);
      flash = Math.max(0, flash - dt * 0.7);
      level += (snap.level - level) * Math.min(1, dt * 3);
      const target = snap.arc ? snap.arc.intensity : 0.45 + level * 0.4;
      intensity += (target - intensity) * Math.min(1, dt * 0.8);
      openSmooth += (openRef.current - openSmooth) * Math.min(1, dt * 3);

      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.time, (nowMs - t0) / 1000);
      gl.uniform1f(U.hue, hue);
      gl.uniform1f(U.intensity, snap.playing ? intensity : 0.25);
      gl.uniform1f(U.level, level);
      gl.uniform1f(U.pulse, pulse);
      gl.uniform1f(U.energy, energy);
      gl.uniform1f(U.flash, flash);
      gl.uniform1f(U.erosion, snap.erosion);
      gl.uniform1f(U.openX, openSmooth);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      off();
      window.removeEventListener("resize", resize);
      // free GPU objects but keep the context: the canvas may be reused
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, [engine, onUnsupported]);

  return <canvas ref={ref} className="canvas backdrop" />;
}
