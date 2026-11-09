"use client";

import { useEffect, useRef } from "react";
import type { Engine, EngineEvent, Snapshot } from "@/lib/engine/Engine";
import type { DriftConfig } from "@/lib/schema";

export const PALETTE = ["#8ec5ff", "#ffc27a", "#ff9fb2", "#8ff0c8", "#c3a8ff", "#f2e6a0"];
const SURPRISE = "#fff1d6";

/**
 * Everything drawn here is caused by the engine: a note, a chord change,
 * a rule acting, a surprise. Nothing is decorative animation on its own,
 * except the slow nebula, whose colour follows the harmony and whose
 * brightness follows the loudness.
 *
 * Layers (back to front):
 *   background nebula + star dust      → main canvas
 *   moving particles with light trails → trail canvas (fades each frame)
 *   threads, ribbons, ripples, waves   → glow canvas (cleared each frame)
 *   bloom: both of the above, downscaled and scaled back up (soft glow)
 *   ghosts, melody rings, rule overlays, labels → main canvas, crisp
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  born: number;
  life: number;
  color: string;
  alpha: number;
  kind: "note" | "spark" | "surprise";
  layerId: string;
  seed: number;
  tail: { x: number; y: number }[];
}

interface Ghost {
  x: number;
  y: number;
  born: number;
  ruleId: string;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  born: number;
  life: number;
  color: string;
  width: number;
  grow: number;
  double?: boolean;
  crisp?: boolean;
}

interface Ribbon {
  y: number;
  cx: number;
  born: number;
  life: number;
  color: string;
  amp: number;
  phase: number;
}

interface Thread {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  born: number;
  life: number;
  color: string;
  kind: "melody" | "relation" | "handoff";
}

interface Banner {
  text: string;
  x: number;
  y: number;
  born: number;
  color: string;
}

interface Star {
  x: number;
  y: number;
  r: number;
  tw: number;
  ph: number;
  flash: number;
}

interface Props {
  engine: Engine | null;
  config: DriftConfig;
  hoveredRule: string | null;
  /** Space covered by side panels, so visuals stay in the open area. */
  insets: { left: number; right: number };
  /** A GPU scene is drawn underneath: keep this canvas transparent. */
  backdrop: boolean;
  /** Immersive mode: no lanes or labels, just light. */
  immersive: boolean;
}

const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
};

const makeCanvas = () => document.createElement("canvas");

export default function Visualizer({ engine, config, hoveredRule, insets, backdrop, immersive }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<string | null>(hoveredRule);
  const configRef = useRef(config);
  const insetRef = useRef(insets);
  const modeRef = useRef({ backdrop, immersive });
  modeRef.current = { backdrop, immersive };
  hoverRef.current = hoveredRule;
  configRef.current = config;
  insetRef.current = insets;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !engine) return;
    const ctx = canvas.getContext("2d")!;

    // offscreen layers
    const trail = makeCanvas();
    const tctx = trail.getContext("2d")!;
    const glow = makeCanvas();
    const gctx = glow.getContext("2d")!;
    const bloomA = makeCanvas();
    const bactx = bloomA.getContext("2d")!;
    const bloomB = makeCanvas();
    const bbctx = bloomB.getContext("2d")!;

    let W = 0;
    let H = 0;
    let dpr = 1;
    let ls = 1; // light-layer scale (kept modest for speed)
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      ls = Math.min(1.25, dpr);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      for (const c of [trail, glow]) {
        c.width = Math.max(1, Math.round(W * ls));
        c.height = Math.max(1, Math.round(H * ls));
      }
      bloomA.width = Math.max(1, Math.round(W / 4));
      bloomA.height = Math.max(1, Math.round(H / 4));
      bloomB.width = Math.max(1, Math.round(W / 12));
      bloomB.height = Math.max(1, Math.round(H / 12));
    };
    resize();
    window.addEventListener("resize", resize);

    const queue: EngineEvent[] = [];
    const particles: Particle[] = [];
    const ghosts: Ghost[] = [];
    const rings: Ring[] = [];
    const ribbons: Ribbon[] = [];
    const threads: Thread[] = [];
    const banners: Banner[] = [];
    const sweeps: { born: number; hue: number }[] = [];
    const lastPoint = new Map<string, { x: number; y: number; at: number }>();
    const stars: Star[] = Array.from({ length: 170 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * 1.1,
      tw: 0.3 + Math.random() * 1.4,
      ph: Math.random() * Math.PI * 2,
      flash: 0,
    }));
    let hue = 215;
    let targetHue = 215;
    let silenceUntil = 0;
    let level = 0;
    let kickGlow = 0; // the floor glows on each kick
    let snap: Snapshot = engine.snapshot();

    const off = engine.on((e) => queue.push(e));

    // the open area between the side panels
    let X0 = 0;
    let X1 = 0;
    const area = () => {
      const ins = insetRef.current;
      const fits = W - ins.left - ins.right > 320;
      X0 = (fits ? ins.left : 0) + 40;
      X1 = W - (fits ? ins.right : 0) - 40;
    };
    const xOf = (lane: number) => X0 + lane * (X1 - X0);
    const yFor = (midi: number) => H * 0.86 - ((midi - 28) / 72) * H * 0.74;
    const laneX = (layerId: string) => {
      const l = snap.layers.find((x) => x.id === layerId);
      return xOf(l ? l.lane : 0.5);
    };
    const colorFor = (layerId: string) => {
      if (layerId === "surprise") return SURPRISE;
      const l = snap.layers.find((x) => x.id === layerId);
      return PALETTE[(l?.colorIndex ?? 0) % PALETTE.length];
    };
    const flashStars = (x: number, y: number, amount: number) => {
      for (const s of stars) {
        const dx = s.x * W - x;
        const dy = s.y * H - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 220 * 220) s.flash = Math.min(1, s.flash + amount * (1 - Math.sqrt(d2) / 220));
      }
    };

    const spawn = (e: EngineEvent, t: number) => {
      const erosion = snap.erosion;
      switch (e.kind) {
        case "note": {
          const color = colorFor(e.layerId);
          const isPad = e.role === "pad";
          const isBass = e.role === "bass";
          const y = yFor(e.midi);
          const baseX = e.layerId === "surprise" ? xOf(0.3 + Math.random() * 0.4) : laneX(e.layerId);
          if (e.role === "drums") {
            const lx = laneX(e.layerId);
            if (e.midi === 36) {
              // kick: a pulse from the floor
              rings.push({ x: lx, y: H * 0.86, r: 8, born: t, life: 0.9, color, width: 3, grow: 150 * e.velocity });
              flashStars(lx, H * 0.86, 0.35);
              kickGlow = Math.max(kickGlow, e.velocity);
            } else if (e.midi === 38) {
              // snare: a bright flash ring at mid height
              rings.push({ x: lx, y: H * 0.5, r: 4, born: t, life: 0.7, color: "#ffffff", width: 1.6, grow: 90 });
              for (let i = 0; i < 8; i++) {
                const a = Math.random() * Math.PI * 2;
                particles.push({ x: lx, y: H * 0.5, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, r: 1.4, born: t, life: 0.8, color, alpha: 0.8, kind: "spark", layerId: e.layerId, seed: Math.random() * 100, tail: [] });
              }
            } else {
              // hats: a tiny spark high up
              particles.push({ x: lx + (Math.random() - 0.5) * 30, y: H * (0.2 + Math.random() * 0.08), vx: (Math.random() - 0.5) * 40, vy: 20, r: 1 + e.velocity * 1.5, born: t, life: e.midi === 46 ? 1.2 : 0.5, color, alpha: 0.9, kind: "spark", layerId: e.layerId, seed: Math.random() * 100, tail: [] });
            }
            break;
          }
          if (isPad) {
            // a pad note is a slow ribbon of light at its pitch
            ribbons.push({ y, cx: baseX, born: t, life: Math.min(22, e.duration + 6), color, amp: 6 + e.velocity * 18, phase: Math.random() * 10 });
            break;
          }
          const x = baseX + (Math.random() - 0.5) * (X1 - X0) * 0.07;
          if (isBass) {
            // the bass sends out wide, slow ripples
            for (let i = 0; i < 3; i++) rings.push({ x, y, r: 10 + i * 18, born: t + i * 0.35, life: 4.5, color, width: 2.2 - i * 0.5, grow: 230 });
            flashStars(x, y, 0.5);
            break;
          }
          const r = 3 + e.velocity * 9;
          particles.push({
            x,
            y,
            vx: (Math.random() - 0.5) * (8 + erosion * 40),
            vy: -6 - Math.random() * 8,
            r,
            born: t,
            life: Math.min(14, e.duration + 4.5),
            color,
            alpha: 1,
            kind: e.role === "surprise" ? "surprise" : "note",
            layerId: e.layerId,
            seed: Math.random() * 100,
            tail: [],
          });
          // onset: a quick ripple
          rings.push({ x, y, r: r * 1.5, born: t, life: 1.6, color, width: 1.4, grow: 46 + e.velocity * 40 });
          // melody contour: join consecutive notes of the same layer
          const lp = lastPoint.get(e.layerId);
          if (lp && t - lp.at < 9 && e.layerId !== "surprise") {
            threads.push({ x1: lp.x, y1: lp.y, x2: x, y2: y, born: t, life: 6, color, kind: "melody" });
          }
          lastPoint.set(e.layerId, { x, y, at: t });
          // the user's own melody wears a crisp ring; locked notes a double one
          if (e.theme) rings.push({ x, y, r: r + 6, born: t, life: 2.6, color, width: 1.5, grow: 26, double: e.locked, crisp: true });
          flashStars(x, y, 0.25 + e.velocity * 0.5);
          // erosion: notes break into drifting fragments
          if (erosion > 0.05) {
            const n = Math.round(erosion * 7);
            for (let i = 0; i < n; i++)
              particles.push({ x, y, vx: (Math.random() - 0.5) * 70 * erosion, vy: (Math.random() - 0.5) * 70 * erosion, r: r * 0.35, born: t, life: 2 + Math.random() * 2, color, alpha: 0.6, kind: "spark", layerId: e.layerId, seed: Math.random() * 100, tail: [] });
          }
          break;
        }
        case "ghost": {
          const x = e.layerId === "surprise" ? xOf(0.5) : laneX(e.layerId);
          ghosts.push({ x: x + (Math.random() - 0.5) * (X1 - X0) * 0.05, y: yFor(e.midi), born: t, ruleId: e.ruleId });
          break;
        }
        case "chord":
          if (e.pcs.length) {
            targetHue = (200 + e.pcs[0] * 13) % 360;
            sweeps.push({ born: t, hue: targetHue });
          }
          break;
        case "surprise": {
          // a shockwave and a burst of sparks
          const x = xOf(0.3 + Math.random() * 0.4);
          const y = H * (0.3 + Math.random() * 0.35);
          rings.push({ x, y, r: 6, born: t, life: 3, color: SURPRISE, width: 2.5, grow: 320 });
          for (let i = 0; i < 26; i++) {
            const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
            const sp = 60 + Math.random() * 120;
            particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 1.6 + Math.random() * 2, born: t, life: 2.2 + Math.random() * 1.5, color: SURPRISE, alpha: 0.9, kind: "spark", layerId: "surprise", seed: Math.random() * 100, tail: [] });
          }
          flashStars(x, y, 1);
          break;
        }
        case "relation":
        case "handoff": {
          const a = lastPoint.get(e.from);
          setTimeout(() => {
            const b = lastPoint.get(e.to);
            if (a && b) threads.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, born: performance.now() / 1000, life: e.kind === "handoff" ? 2.8 : 1.8, color: colorFor(e.to), kind: e.kind });
          }, 30);
          break;
        }
        case "layerEnter":
          banners.push({ text: `new voice · ${e.name}`, x: laneX(e.layerId), y: H * 0.12, born: performance.now() / 1000, color: colorFor(e.layerId) });
          rings.push({ x: laneX(e.layerId), y: H * 0.5, r: 10, born: performance.now() / 1000, life: 3, color: colorFor(e.layerId), width: 2, grow: 260 });
          break;
        case "layerLeave":
          banners.push({ text: `leaving · ${e.name}`, x: laneX(e.layerId), y: H * 0.12, born: performance.now() / 1000, color: "#8a90a0" });
          break;
        case "silence":
          silenceUntil = e.until;
          break;
      }
    };

    let raf = 0;
    let lastFrame = performance.now() / 1000;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const wall = performance.now() / 1000;
      const dt = Math.min(0.05, wall - lastFrame);
      lastFrame = wall;
      snap = engine.snapshot();
      area();
      const now = snap.now;
      level += (snap.level - level) * Math.min(1, dt * 4);

      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].time <= now + 0.02) {
          spawn(queue[i], wall);
          queue.splice(i, 1);
        }
      }
      if (queue.length > 600) queue.splice(0, queue.length - 600);

      const hov = hoverRef.current;
      const cfg = configRef.current;
      const hovRule = hov ? cfg.rules.find((r) => r.id === hov) : undefined;
      const emph = (type: string) => (hovRule?.type === type ? 1 : 0);
      const quiet = now < silenceUntil ? 0.55 : 1;
      hue += ((((targetHue - hue + 540) % 360) - 180) * dt) / 6;
      const cx0 = (X0 + X1) / 2;

      /* ---------- background: nebula + star dust ---------- */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (modeRef.current.backdrop) {
        // the GPU horizon scene shows through underneath
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, W, H);
      } else {
        ctx.globalCompositeOperation = "source-over";
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, `hsl(${hue + 20}, 40%, 3%)`);
        bg.addColorStop(1, `hsl(${hue - 10}, 35%, 5%)`);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        ctx.globalCompositeOperation = "lighter";
        // the nebula follows loudness and, if set, the dramatic arc
        const glowAmt = (0.55 + level * 0.9) * quiet * (snap.arc ? 0.5 + snap.arc.intensity * 0.9 : 1);
        for (let i = 0; i < 4; i++) {
          const bx = cx0 + Math.sin(wall * 0.031 + i * 1.7) * (X1 - X0) * 0.32;
          const by = H * (0.45 + Math.cos(wall * 0.023 + i * 2.3) * 0.22);
          const br = Math.max(W, H) * (0.28 + 0.06 * Math.sin(wall * 0.05 + i));
          const ng = ctx.createRadialGradient(bx, by, 0, bx, by, br);
          ng.addColorStop(0, `hsla(${hue + i * 28 - 30}, 55%, 22%, ${0.16 * glowAmt})`);
          ng.addColorStop(1, `hsla(${hue + i * 28 - 30}, 55%, 10%, 0)`);
          ctx.fillStyle = ng;
          ctx.fillRect(0, 0, W, H);
        }
        // kick drum: the floor of the scene breathes
        kickGlow = Math.max(0, kickGlow - dt * 3.5);
        if (kickGlow > 0.01) {
          const kg = ctx.createLinearGradient(0, H, 0, H * 0.55);
          kg.addColorStop(0, `hsla(${hue}, 70%, 55%, ${(kickGlow * 0.18).toFixed(3)})`);
          kg.addColorStop(1, `hsla(${hue}, 70%, 55%, 0)`);
          ctx.fillStyle = kg;
          ctx.fillRect(0, H * 0.55, W, H * 0.45);
        }
        for (const s of stars) {
          s.flash = Math.max(0, s.flash - dt * 0.8);
          const a = (0.18 + 0.22 * Math.sin(wall * s.tw + s.ph) ** 2 + s.flash * 0.8) * quiet;
          ctx.fillStyle = `rgba(220,230,255,${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(s.x * W, s.y * H, s.r + s.flash * 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";

      }

      // lanes: each layer's stream (they separate when "drift apart" is on)
      ctx.font = "11px ui-sans-serif, -apple-system, sans-serif";
      ctx.textAlign = "center";
      for (const l of modeRef.current.immersive ? [] : snap.layers) {
        const x = xOf(l.lane);
        const a = (l.active ? 0.05 : 0.02) + snap.driftAmount * 0.12 + emph("driftApart") * 0.25 + (l.speaking ? 0.1 : 0);
        const col = PALETTE[l.colorIndex % PALETTE.length];
        const lg = ctx.createLinearGradient(0, H * 0.1, 0, H * 0.92);
        lg.addColorStop(0, hexA(col, 0));
        lg.addColorStop(0.5, hexA(col, a));
        lg.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = lg;
        ctx.fillRect(x - (l.speaking ? 2 : 0.75), H * 0.1, l.speaking ? 4 : 1.5, H * 0.82);
        ctx.fillStyle = hexA(col, l.active ? 0.6 : 0.25);
        ctx.fillText(l.name + (l.runtime ? " ✦" : ""), x, H - 132);
      }

      /* ---------- trail layer: moving lights ---------- */
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.clearRect(0, 0, trail.width, trail.height);
      tctx.setTransform(ls, 0, 0, ls, 0, 0);
      tctx.lineCap = "round";
      const tailLen = 14 + Math.round(snap.erosion * 14);
      tctx.globalCompositeOperation = "lighter";
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const age = wall - p.born;
        if (age > p.life) {
          particles.splice(i, 1);
          continue;
        }
        const k = age / p.life;
        // gentle, organic drift
        const wob = Math.sin(wall * 0.7 + p.seed) * 10 + Math.sin(p.y * 0.01 + wall * 0.4) * 6;
        p.x += (p.vx + wob * (p.kind === "spark" ? 0.2 : 1)) * dt;
        p.y += p.vy * dt;
        if (p.kind === "spark") {
          p.vx *= 1 - dt * 1.2;
          p.vy *= 1 - dt * 1.2;
        }
        p.tail.push({ x: p.x, y: p.y });
        if (p.tail.length > tailLen) p.tail.shift();
        const env = Math.pow(1 - k, 1.3) * Math.min(1, age * 12);
        const a = p.alpha * env * (1 - snap.erosion * 0.3) * quiet;
        const rr = p.r * (1 + snap.erosion * 1.2) * (p.kind === "spark" ? 1 : 1 + k * 0.4);
        // a fading tail of light behind the particle
        for (let j = 1; j < p.tail.length; j++) {
          const f = j / p.tail.length;
          tctx.strokeStyle = hexA(p.color, a * f * 0.35);
          tctx.lineWidth = rr * (0.4 + f * 0.9);
          tctx.beginPath();
          tctx.moveTo(p.tail[j - 1].x, p.tail[j - 1].y);
          tctx.lineTo(p.tail[j].x, p.tail[j].y);
          tctx.stroke();
        }
        // soft halo, coloured body, small bright core
        const g = tctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 3);
        g.addColorStop(0, hexA(p.color, a * 0.55));
        g.addColorStop(0.35, hexA(p.color, a * 0.22));
        g.addColorStop(1, hexA(p.color, 0));
        tctx.fillStyle = g;
        tctx.beginPath();
        tctx.arc(p.x, p.y, rr * 3, 0, Math.PI * 2);
        tctx.fill();
        tctx.fillStyle = hexA("#ffffff", a * 0.85);
        tctx.beginPath();
        tctx.arc(p.x, p.y, Math.max(0.8, rr * 0.28), 0, Math.PI * 2);
        tctx.fill();
      }
      if (particles.length > 500) particles.splice(0, particles.length - 500);

      /* ---------- glow layer: ribbons, threads, ripples, sweeps ---------- */
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.clearRect(0, 0, glow.width, glow.height);
      gctx.setTransform(ls, 0, 0, ls, 0, 0);
      gctx.globalCompositeOperation = "lighter";
      gctx.lineCap = "round";

      // chord changes: a slow wave of light crosses the open area
      for (let i = sweeps.length - 1; i >= 0; i--) {
        const s = sweeps[i];
        const k = (wall - s.born) / 4;
        if (k > 1) {
          sweeps.splice(i, 1);
          continue;
        }
        const x = X0 + (X1 - X0) * k;
        const sg = gctx.createLinearGradient(x - 160, 0, x + 160, 0);
        sg.addColorStop(0, `hsla(${s.hue}, 70%, 60%, 0)`);
        sg.addColorStop(0.5, `hsla(${s.hue}, 70%, 60%, ${0.07 * Math.sin(k * Math.PI)})`);
        sg.addColorStop(1, `hsla(${s.hue}, 70%, 60%, 0)`);
        gctx.fillStyle = sg;
        gctx.fillRect(x - 160, 0, 320, H);
      }

      // pads: ribbons of light at their pitch
      for (let i = ribbons.length - 1; i >= 0; i--) {
        const rb = ribbons[i];
        const age = wall - rb.born;
        const k = age / rb.life;
        if (k > 1) {
          ribbons.splice(i, 1);
          continue;
        }
        const env = Math.sin(Math.min(1, k * 3) * Math.PI * 0.5) * Math.pow(1 - k, 0.8) * quiet;
        const half = (X1 - X0) * 0.42;
        for (let strand = 0; strand < 3; strand++) {
          gctx.beginPath();
          for (let x = rb.cx - half; x <= rb.cx + half; x += 10) {
            const u = (x - (rb.cx - half)) / (2 * half);
            const y = rb.y + Math.sin(x * 0.006 + wall * (0.35 + strand * 0.12) + rb.phase + strand * 1.3) * rb.amp * (0.6 + strand * 0.3) + Math.sin(u * Math.PI * 3 + wall * 0.2) * 4;
            if (x === rb.cx - half) gctx.moveTo(x, y);
            else gctx.lineTo(x, y);
          }
          const lg = gctx.createLinearGradient(rb.cx - half, 0, rb.cx + half, 0);
          lg.addColorStop(0, hexA(rb.color, 0));
          lg.addColorStop(0.5, hexA(rb.color, env * (0.22 - strand * 0.05)));
          lg.addColorStop(1, hexA(rb.color, 0));
          gctx.strokeStyle = lg;
          gctx.lineWidth = 7 - strand * 2;
          gctx.stroke();
        }
      }

      // threads: melody contours, relations, hand-offs
      for (let i = threads.length - 1; i >= 0; i--) {
        const th = threads[i];
        const k = (wall - th.born) / th.life;
        if (k > 1) {
          threads.splice(i, 1);
          continue;
        }
        const strong = th.kind === "handoff" ? 1 + emph("handoff") : th.kind === "relation" ? 0.7 : 0.45;
        const mx = (th.x1 + th.x2) / 2;
        const my = th.kind === "melody" ? (th.y1 + th.y2) / 2 - 10 : Math.min(th.y1, th.y2) - 40 - Math.abs(th.x2 - th.x1) * 0.15;
        gctx.strokeStyle = hexA(th.color, (1 - k) * 0.55 * strong * quiet);
        gctx.lineWidth = th.kind === "handoff" ? 2 : th.kind === "melody" ? 1.2 : 1;
        gctx.beginPath();
        gctx.moveTo(th.x1, th.y1);
        gctx.quadraticCurveTo(mx, my, th.x2, th.y2);
        gctx.stroke();
        if (th.kind === "handoff") {
          const s = Math.min(1, k * 1.6);
          const sx = (1 - s) * (1 - s) * th.x1 + 2 * (1 - s) * s * mx + s * s * th.x2;
          const sy = (1 - s) * (1 - s) * th.y1 + 2 * (1 - s) * s * my + s * s * th.y2;
          const sg = gctx.createRadialGradient(sx, sy, 0, sx, sy, 14);
          sg.addColorStop(0, hexA("#ffffff", 0.95 * (1 - k)));
          sg.addColorStop(1, hexA(th.color, 0));
          gctx.fillStyle = sg;
          gctx.beginPath();
          gctx.arc(sx, sy, 14, 0, Math.PI * 2);
          gctx.fill();
        }
      }

      // ripples (soft) — crisp ones are drawn later on the main canvas
      for (const rg of rings) {
        if (rg.crisp) continue;
        const age = wall - rg.born;
        if (age < 0) continue;
        const k = age / rg.life;
        if (k > 1) continue;
        gctx.strokeStyle = hexA(rg.color, Math.pow(1 - k, 1.5) * 0.55 * quiet);
        gctx.lineWidth = rg.width;
        gctx.beginPath();
        gctx.ellipse(rg.x, rg.y, rg.r + rg.grow * k, (rg.r + rg.grow * k) * 0.82, 0, 0, Math.PI * 2);
        gctx.stroke();
      }

      /* ---------- composite light + bloom ---------- */
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(trail, 0, 0, canvas.width, canvas.height);
      ctx.drawImage(glow, 0, 0, canvas.width, canvas.height);
      bactx.globalCompositeOperation = "source-over";
      bactx.clearRect(0, 0, bloomA.width, bloomA.height);
      bactx.drawImage(trail, 0, 0, bloomA.width, bloomA.height);
      bactx.globalCompositeOperation = "lighter";
      bactx.drawImage(glow, 0, 0, bloomA.width, bloomA.height);
      bbctx.clearRect(0, 0, bloomB.width, bloomB.height);
      bbctx.drawImage(bloomA, 0, 0, bloomB.width, bloomB.height);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(bloomA, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 0.7;
      ctx.drawImage(bloomB, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // rule: higher notes become rarer → the top darkens
      if (snap.thinProgress > 0 || emph("thinHighs")) {
        const yT = yFor(67);
        const tg = ctx.createLinearGradient(0, 0, 0, yT);
        tg.addColorStop(0, `rgba(0,0,0,${0.7 * Math.max(snap.thinProgress, emph("thinHighs") * 0.4)})`);
        tg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = tg;
        ctx.fillRect(X0 - 40, 0, X1 - X0 + 80, yT);
      }

      // crisp rings: notes from your melody (double ring = locked)
      for (let i = rings.length - 1; i >= 0; i--) {
        const rg = rings[i];
        const age = wall - rg.born;
        const k = age / rg.life;
        if (k > 1) {
          rings.splice(i, 1);
          continue;
        }
        if (!rg.crisp || age < 0) continue;
        const rr = rg.r + rg.grow * k;
        ctx.strokeStyle = hexA(rg.color, (1 - k) * 0.85);
        ctx.lineWidth = rg.width;
        ctx.beginPath();
        ctx.arc(rg.x, rg.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        if (rg.double) {
          ctx.beginPath();
          ctx.arc(rg.x, rg.y, rr + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (rings.length > 400) rings.splice(0, rings.length - 400);

      // ghosts: notes a rule blocked
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const g = ghosts[i];
        const k = (wall - g.born) / 1.8;
        if (k > 1) {
          ghosts.splice(i, 1);
          continue;
        }
        const strong = hov && g.ruleId === hov ? 1 : 0.6;
        ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.6 * strong})`;
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(g.x, g.y - k * 6, 10 + k * 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      /* ---------- rule overlays ---------- */
      ctx.font = "11px ui-sans-serif, -apple-system, sans-serif";

      const drawLine = (midi: number, label: string, type: string) => {
        const y = yFor(midi);
        const e = emph(type);
        ctx.strokeStyle = `rgba(255,211,161,${0.28 + e * 0.5})`;
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X0, y);
        ctx.lineTo(X1, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.textAlign = "left";
        ctx.fillStyle = `rgba(255,211,161,${0.5 + e * 0.4})`;
        ctx.fillText(label, X0, y - 6);
      };
      if (snap.ceilingMidi !== null) drawLine(snap.ceilingMidi + 0.5, "nothing above this line", "ceiling");
      if (snap.floorMidi !== null) drawLine(snap.floorMidi - 0.5, "nothing below this line", "floor");

      // max simultaneous sounds → slots on the right edge
      let slotBottom = H * 0.5;
      if (snap.maxVoices !== null) {
        const n = snap.maxVoices;
        const e = emph("maxVoices");
        const x = X1 + 14;
        const y0 = H * 0.5 - (n - 1) * 13 - (snap.maxNotes ? 40 : 0);
        for (let i = 0; i < n; i++) {
          const filled = i < snap.soundingLayers;
          ctx.beginPath();
          ctx.arc(x, y0 + i * 26, 7, 0, Math.PI * 2);
          ctx.fillStyle = filled ? `rgba(255,211,161,${0.75 + e * 0.25})` : "rgba(255,255,255,0.04)";
          ctx.fill();
          ctx.strokeStyle = `rgba(255,211,161,${0.4 + e * 0.5})`;
          ctx.stroke();
        }
        slotBottom = y0 + n * 26;
        if (e) {
          ctx.textAlign = "right";
          ctx.fillStyle = "rgba(255,211,161,0.85)";
          ctx.fillText(`${snap.soundingLayers}/${n} sounds`, x - 14, y0 + 4);
        }
      }
      // max simultaneous notes → small dots
      if (snap.maxNotes !== null) {
        const n = snap.maxNotes;
        const e = emph("maxNotes");
        const x = X1 + 14;
        const y0 = snap.maxVoices !== null ? slotBottom + 10 : H * 0.5 - (n - 1) * 8;
        for (let i = 0; i < n; i++) {
          const filled = i < snap.soundingNotes;
          ctx.beginPath();
          ctx.arc(x, y0 + i * 16, 4, 0, Math.PI * 2);
          ctx.fillStyle = filled ? `rgba(169,199,255,${0.8 + e * 0.2})` : "rgba(255,255,255,0.04)";
          ctx.fill();
          ctx.strokeStyle = `rgba(169,199,255,${0.45 + e * 0.5})`;
          ctx.stroke();
        }
        slotBottom = y0 + n * 16;
        if (e) {
          ctx.textAlign = "right";
          ctx.fillStyle = "rgba(169,199,255,0.9)";
          ctx.fillText(`${Math.min(snap.soundingNotes, n)}/${n} notes`, x - 10, y0 + 4);
        }
      }

      // introduce a new instrument → ring clock
      if (snap.addProgress !== null) {
        const e = emph("addLayerEvery");
        const cx = X1 + 6;
        const cy = snap.maxVoices !== null || snap.maxNotes !== null ? slotBottom + 30 : H * 0.5;
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,211,161,${0.6 + e * 0.4})`;
        ctx.beginPath();
        ctx.arc(cx, cy, 15, -Math.PI / 2, -Math.PI / 2 + snap.addProgress * Math.PI * 2);
        ctx.stroke();
        if (e) {
          ctx.textAlign = "right";
          ctx.fillStyle = "rgba(255,211,161,0.85)";
          ctx.fillText("next new voice", cx - 22, cy + 4);
        }
      }

      // each sound quieter → a fading meter at the left
      if (snap.quietLevel !== null) {
        const e = emph("eachQuieter");
        const x = X0 - 14;
        const h = H * 0.3;
        const y = H * 0.5 + h / 2;
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(x - 2, y - h, 4, h);
        ctx.fillStyle = `rgba(255,211,161,${0.6 + e * 0.4})`;
        ctx.fillRect(x - 2, y - h * snap.quietLevel, 4, h * snap.quietLevel);
        if (e) {
          ctx.textAlign = "left";
          ctx.fillText("loudness of the next sound", x + 10, y - h * snap.quietLevel + 4);
        }
      }

      if (hovRule && ["erode", "driftApart", "thinHighs", "handoff"].includes(hovRule.type)) {
        const caption: Record<string, string> = {
          erode: `dissolving · ${Math.round(snap.erosion * 100)}%`,
          driftApart: `drifting apart · ${Math.round(snap.driftAmount * 100)}%`,
          thinHighs: `high notes thinning · ${Math.round(snap.thinProgress * 100)}%`,
          handoff: snap.speaker ? `speaking: ${snap.layers.find((l) => l.id === snap.speaker)?.name ?? ""}` : "waiting for the next voice",
        };
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,211,161,0.9)";
        ctx.font = "12px ui-sans-serif, -apple-system, sans-serif";
        ctx.fillText(caption[hovRule.type], (X0 + X1) / 2, 82);
      }

      for (let i = banners.length - 1; i >= 0; i--) {
        const b = banners[i];
        const k = (wall - b.born) / 5;
        if (k > 1) {
          banners.splice(i, 1);
          continue;
        }
        ctx.textAlign = "center";
        ctx.font = "12px ui-sans-serif, -apple-system, sans-serif";
        ctx.fillStyle = hexA(b.color, Math.sin(Math.min(1, k * 4) * Math.PI * 0.5) * (1 - k));
        ctx.fillText(b.text, b.x, b.y + k * 10);
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      off();
      window.removeEventListener("resize", resize);
    };
  }, [engine]);

  return <canvas ref={canvasRef} className="canvas" />;
}
