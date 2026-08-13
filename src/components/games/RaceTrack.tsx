"use client";

import { useEffect, useRef, useState } from "react";
import { recordGameSession } from "@/lib/record-session";
import { playCorrect, playHurt, playGameOver } from "@/lib/arcade-sound";
import { RACING_SPRITES } from "@/lib/racing-sprites";
import {
  TRACKS,
  CAR_COLORS,
  CAR_STATS,
  MAX_CAR_LEVEL,
  upgradeCost,
  trackDecorations,
  type CarColor,
  type CarStat,
  type TrackDef,
} from "@/lib/racing";

function nowMs(): number {
  return performance.now();
}

const CANVAS_W = 480;
const CANVAS_H = 360;
const RACE_LAPS = 2;
const WAYPOINT_RADIUS = 55;
const ACCEL = 260;
const FRICTION = 90;
const TURBO_MULTIPLIER = 1.6;
const TURBO_COOLDOWN = 4;
const AI_TURN_RATE = 3.0;

interface CarProgressState {
  coins: number;
  engineLevel: number;
  wheelsLevel: number;
  turboLevel: number;
  color: CarColor;
}

const DEFAULT_PROGRESS: CarProgressState = {
  coins: 0,
  engineLevel: 1,
  wheelsLevel: 1,
  turboLevel: 1,
  color: "red",
};

interface RaceCar {
  x: number;
  y: number;
  heading: number;
  speed: number;
  waypointIndex: number;
  laps: number;
  finished: boolean;
  finishTimeMs: number | null;
  isPlayer: boolean;
  color: CarColor;
  aiSpeed: number;
}

function engineMaxSpeed(level: number): number {
  return 140 + (level - 1) * 30;
}
function wheelsTurnRate(level: number): number {
  return 2.4 + (level - 1) * 0.5;
}
function turboDuration(level: number): number {
  return 0.6 + (level - 1) * 0.3;
}

function angleDiff(target: number, current: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function distToTrack(track: TrackDef, x: number, y: number): number {
  let min = Infinity;
  for (let i = 0; i < track.waypoints.length; i++) {
    const a = track.waypoints[i];
    const b = track.waypoints[(i + 1) % track.waypoints.length];
    min = Math.min(min, distToSegment(x, y, a.x, a.y, b.x, b.y));
  }
  return min;
}

function makeCars(track: TrackDef, playerColor: CarColor): RaceCar[] {
  const otherColors = CAR_COLORS.filter((c) => c !== playerColor);
  const start = track.waypoints[0];
  const next = track.waypoints[1];
  // Face along the track at the start line instead of a hardcoded "up" —
  // heading 0 only happened to match tracks whose first leg runs north.
  const startHeading = Math.atan2(next.x - start.x, -(next.y - start.y));
  const cars: RaceCar[] = [
    {
      x: start.x, y: start.y, heading: startHeading, speed: 0, waypointIndex: 1,
      laps: 0, finished: false, finishTimeMs: null, isPlayer: true,
      color: playerColor, aiSpeed: 0,
    },
  ];
  for (let i = 0; i < 3; i++) {
    cars.push({
      x: start.x + (i + 1) * 14 - 20,
      y: start.y + (i + 1) * 12,
      heading: startHeading,
      speed: 0,
      waypointIndex: 1,
      laps: 0,
      finished: false,
      finishTimeMs: null,
      isPlayer: false,
      color: otherColors[i % otherColors.length],
      aiSpeed: 150 + Math.random() * 35,
    });
  }
  return cars;
}

function loadSprites(): Record<string, HTMLImageElement> {
  const images: Record<string, HTMLImageElement> = {};
  for (const [name, src] of Object.entries(RACING_SPRITES)) {
    const img = new Image();
    img.src = src;
    images[name] = img;
  }
  return images;
}

const CAR_SPRITE_KEY: Record<CarColor, string> = {
  red: "carRed",
  blue: "carBlue",
  green: "carGreen",
  yellow: "carYellow",
  black: "carBlack",
};

const COLOR_SWATCH: Record<CarColor, string> = {
  red: "#dc2626",
  blue: "#2563eb",
  green: "#16a34a",
  yellow: "#eab308",
  black: "#334155",
};

type Screen = "select" | "shop" | "race" | "results";

export default function RaceTrack({ kidId }: { kidId: string }) {
  const [screen, setScreen] = useState<Screen>("select");
  const [progress, setProgress] = useState<CarProgressState>(DEFAULT_PROGRESS);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<TrackDef | null>(null);
  const [records, setRecords] = useState<Record<string, { timeMs: number; kidName: string }>>({});
  const [raceResult, setRaceResult] = useState<{
    placement: number;
    timeMs: number;
    reward: number;
    isNewRecord: boolean;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const spritesRef = useRef<Record<string, HTMLImageElement>>({});
  const carsRef = useRef<RaceCar[]>([]);
  const turboChargeRef = useRef(0);
  const turboActiveRef = useRef(0);
  const raceStartRef = useRef(0);
  const raceOverRef = useRef(false);
  const cameraRef = useRef({ x: 0, y: 0 });
  const startedAt = useRef(new Date());

  useEffect(() => {
    spritesRef.current = loadSprites();
  }, []);

  useEffect(() => {
    fetch(`/api/racing/progress?kidId=${kidId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.progress) {
          setProgress({
            coins: data.progress.coins,
            engineLevel: data.progress.engineLevel,
            wheelsLevel: data.progress.wheelsLevel,
            turboLevel: data.progress.turboLevel,
            color: data.progress.color,
          });
        }
      })
      .catch(() => {})
      .finally(() => setProgressLoaded(true));

    fetch("/api/racing/records")
      .then((res) => res.json())
      .then((data) => {
        const map: Record<string, { timeMs: number; kidName: string }> = {};
        for (const r of data.records ?? []) {
          map[r.trackId] = { timeMs: r.timeMs, kidName: r.kidName };
        }
        setRecords(map);
      })
      .catch(() => {});
  }, [kidId]);

  function startRace(track: TrackDef) {
    setSelectedTrack(track);
    carsRef.current = makeCars(track, progress.color);
    turboChargeRef.current = 1;
    turboActiveRef.current = 0;
    raceStartRef.current = nowMs();
    raceOverRef.current = false;
    startedAt.current = new Date();
    setRaceResult(null);
    setScreen("race");
  }

  function pressKey(key: string) {
    keysRef.current.add(key);
  }
  function releaseKey(key: string) {
    keysRef.current.delete(key);
  }
  function activateTurbo() {
    if (turboChargeRef.current >= 1) {
      turboChargeRef.current = 0;
      turboActiveRef.current = turboDuration(progress.turboLevel);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
      keysRef.current.add(e.key);
      if (e.key === " ") activateTurbo();
    }
    function onKeyUp(e: KeyboardEvent) {
      keysRef.current.delete(e.key);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.turboLevel]);

  function finishRace(track: TrackDef) {
    raceOverRef.current = true;
    const cars = carsRef.current;
    const player = cars.find((c) => c.isPlayer)!;
    const finishedBeforePlayer = cars.filter((c) => !c.isPlayer && c.finished).length;
    const placement = 1 + finishedBeforePlayer;
    const timeMs = player.finishTimeMs ?? Math.round(nowMs() - raceStartRef.current);

    if (placement === 1) playCorrect();
    else if (placement === 4) playGameOver();

    fetch("/api/racing/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kidId, trackId: track.id, timeMs, placement }),
    })
      .then((res) => res.json())
      .then((data) => {
        setProgress((p) => ({ ...p, coins: data.totalCoins ?? p.coins }));
        setRaceResult({
          placement,
          timeMs,
          reward: data.reward ?? 0,
          isNewRecord: !!data.isNewRecord,
        });
        if (data.isNewRecord) {
          setRecords((r) => ({ ...r, [track.id]: { timeMs, kidName: "you" } }));
        }
      })
      .catch(() => {
        setRaceResult({ placement, timeMs, reward: 0, isNewRecord: false });
      });

    recordGameSession({
      kidId,
      gameType: "race-track",
      subject: "classic",
      skillTag: `race-track-${track.id}`,
      startedAt: startedAt.current,
      score: placement === 1 ? 1 : 0,
    });

    setScreen("results");
  }

  useEffect(() => {
    if (screen !== "race" || !selectedTrack) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const track = selectedTrack;
    const decorations = trackDecorations(track);

    let lastTime = nowMs();
    let rafId: number;

    const frame = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      const cars = carsRef.current;
      const player = cars.find((c) => c.isPlayer)!;

      if (!raceOverRef.current) {
        if (turboActiveRef.current > 0) {
          turboActiveRef.current = Math.max(0, turboActiveRef.current - dt);
        } else if (turboChargeRef.current < 1) {
          turboChargeRef.current = Math.min(1, turboChargeRef.current + dt / TURBO_COOLDOWN);
        }

        const maxSpeed = engineMaxSpeed(progress.engineLevel) * (turboActiveRef.current > 0 ? TURBO_MULTIPLIER : 1);
        const turnRate = wheelsTurnRate(progress.wheelsLevel);

        if (keysRef.current.has("ArrowLeft")) player.heading -= turnRate * dt;
        if (keysRef.current.has("ArrowRight")) player.heading += turnRate * dt;

        if (keysRef.current.has("ArrowUp")) {
          player.speed = Math.min(maxSpeed, player.speed + ACCEL * dt);
        } else if (keysRef.current.has("ArrowDown")) {
          player.speed = Math.max(0, player.speed - ACCEL * dt);
        } else {
          player.speed = Math.max(0, player.speed - FRICTION * dt);
        }

        const offRoad = distToTrack(track, player.x, player.y) > track.roadWidth / 2;
        const effectiveSpeed = offRoad ? Math.min(player.speed, maxSpeed * 0.45) : player.speed;

        player.x += Math.sin(player.heading) * effectiveSpeed * dt;
        player.y -= Math.cos(player.heading) * effectiveSpeed * dt;

        for (const car of cars) {
          if (car.isPlayer || car.finished) continue;
          const target = track.waypoints[car.waypointIndex];
          const targetAngle = Math.atan2(target.x - car.x, -(target.y - car.y));
          car.heading += angleDiff(targetAngle, car.heading) * Math.min(1, AI_TURN_RATE * dt);
          car.speed = Math.min(car.aiSpeed, car.speed + ACCEL * dt);
          car.x += Math.sin(car.heading) * car.speed * dt;
          car.y -= Math.cos(car.heading) * car.speed * dt;
        }

        for (const car of cars) {
          if (car.finished) continue;
          const target = track.waypoints[car.waypointIndex];
          if (Math.hypot(car.x - target.x, car.y - target.y) < WAYPOINT_RADIUS) {
            car.waypointIndex++;
            if (car.waypointIndex >= track.waypoints.length) {
              car.waypointIndex = 0;
              car.laps++;
              if (car.laps >= RACE_LAPS) {
                car.finished = true;
                car.finishTimeMs = Math.round(now - raceStartRef.current);
                if (!car.isPlayer) playHurt();
              }
            }
          }
        }

        if (player.finished) {
          finishRace(track);
        }
      }

      const cameraX = Math.max(0, Math.min(player.x - CANVAS_W / 2, track.worldWidth - CANVAS_W));
      const cameraY = Math.max(0, Math.min(player.y - CANVAS_H / 2, track.worldHeight - CANVAS_H));
      cameraRef.current = { x: cameraX, y: cameraY };
      const sprites = spritesRef.current;

      ctx.fillStyle = "#4d7c0f";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      ctx.strokeStyle = "#57534e";
      ctx.lineWidth = track.roadWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      track.waypoints.forEach((wp, i) => {
        const x = wp.x - cameraX;
        const y = wp.y - cameraY;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();

      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 4;
      ctx.setLineDash([12, 10]);
      ctx.beginPath();
      track.waypoints.forEach((wp, i) => {
        const x = wp.x - cameraX;
        const y = wp.y - cameraY;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      for (const d of decorations) {
        const sprite = sprites[d.type];
        if (!sprite?.complete) continue;
        const size = d.type === "tree" ? 34 : 16;
        ctx.drawImage(sprite, d.x - cameraX - size / 2, d.y - cameraY - size / 2, size, size);
      }

      for (const car of cars) {
        const sprite = sprites[CAR_SPRITE_KEY[car.color]];
        if (!sprite?.complete) continue;
        const w = 22;
        const h = 40;
        ctx.save();
        ctx.translate(car.x - cameraX, car.y - cameraY);
        ctx.rotate(car.heading);
        ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
        ctx.restore();
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, selectedTrack]);

  async function buyUpgrade(stat: CarStat) {
    const res = await fetch("/api/racing/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kidId, stat }),
    }).catch(() => null);
    if (!res || !res.ok) return;
    const data = await res.json();
    if (data.progress) {
      setProgress({
        coins: data.progress.coins,
        engineLevel: data.progress.engineLevel,
        wheelsLevel: data.progress.wheelsLevel,
        turboLevel: data.progress.turboLevel,
        color: data.progress.color,
      });
    }
  }

  async function pickColor(color: CarColor) {
    setProgress((p) => ({ ...p, color }));
    await fetch("/api/racing/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kidId, color }),
    }).catch(() => {});
  }

  if (!progressLoaded) {
    return <p className="text-sm text-slate-400">Loading garage…</p>;
  }

  if (screen === "select") {
    return (
      <div className="flex flex-col items-center gap-5">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-slate-800">🪙 {progress.coins} coins</span>
          <button
            onClick={() => setScreen("shop")}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Garage / Upgrades
          </button>
        </div>
        <p className="text-lg font-bold text-slate-800">Pick a track</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {TRACKS.map((track) => {
            const record = records[track.id];
            return (
              <button
                key={track.id}
                onClick={() => startRace(track)}
                className="flex flex-col items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white p-4 text-center hover:border-sky-400 hover:bg-sky-50"
              >
                <span className="text-lg font-bold text-slate-800">{track.name}</span>
                <span className="text-xs text-slate-500">{track.description}</span>
                <span className="text-xs font-semibold text-amber-600">
                  {record ? `🏆 ${(record.timeMs / 1000).toFixed(2)}s — ${record.kidName}` : "No record yet"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (screen === "shop") {
    return (
      <div className="flex flex-col items-center gap-5">
        <span className="text-lg font-bold text-slate-800">🪙 {progress.coins} coins</span>

        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-semibold text-slate-600">Car color</p>
          <div className="flex gap-2">
            {CAR_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => pickColor(color)}
                className={`h-9 w-9 rounded-full border-4 ${progress.color === color ? "border-sky-500" : "border-transparent"}`}
                style={{ backgroundColor: COLOR_SWATCH[color] }}
                aria-label={color}
              />
            ))}
          </div>
        </div>

        <div className="grid w-full max-w-sm gap-3">
          {CAR_STATS.map((stat) => {
            const level =
              stat === "engine" ? progress.engineLevel : stat === "wheels" ? progress.wheelsLevel : progress.turboLevel;
            const maxed = level >= MAX_CAR_LEVEL;
            const cost = upgradeCost(level);
            return (
              <div key={stat} className="flex items-center justify-between rounded-xl bg-white p-3 shadow">
                <div>
                  <p className="font-semibold capitalize text-slate-700">{stat}</p>
                  <p className="text-xs text-slate-400">Level {level} / {MAX_CAR_LEVEL}</p>
                </div>
                <button
                  onClick={() => buyUpgrade(stat)}
                  disabled={maxed || progress.coins < cost}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
                >
                  {maxed ? "Max" : `Upgrade — 🪙${cost}`}
                </button>
              </div>
            );
          })}
        </div>

        <button onClick={() => setScreen("select")} className="text-sm text-slate-500 underline">
          Back to tracks
        </button>
      </div>
    );
  }

  if (screen === "race" && selectedTrack) {
    return (
      <div className="flex flex-col items-center gap-4">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="max-w-full touch-none rounded-xl shadow-lg"
        />
        <div className="flex w-full max-w-[480px] items-center justify-between">
          <TouchBtn label="⬆ Gas" onDown={() => pressKey("ArrowUp")} onUp={() => releaseKey("ArrowUp")} wide />
          <div className="flex gap-2">
            <TouchBtn label="⬅" onDown={() => pressKey("ArrowLeft")} onUp={() => releaseKey("ArrowLeft")} />
            <TouchBtn label="➡" onDown={() => pressKey("ArrowRight")} onUp={() => releaseKey("ArrowRight")} />
            <TouchBtn label="🚀 Turbo" onDown={activateTurbo} onUp={() => {}} wide />
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Arrow keys to drive, Space for turbo — or use the buttons above
        </p>
      </div>
    );
  }

  if (screen === "results" && raceResult && selectedTrack) {
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="text-xl font-bold text-slate-800">
          {raceResult.placement === 1 ? "🥇 1st place!" : `Place: ${raceResult.placement}${raceResult.placement === 2 ? "nd" : raceResult.placement === 3 ? "rd" : "th"}`}
        </p>
        <p className="text-slate-600">Time: {(raceResult.timeMs / 1000).toFixed(2)}s</p>
        <p className="text-slate-600">🪙 +{raceResult.reward} coins</p>
        {raceResult.isNewRecord && <p className="font-semibold text-amber-600">🏆 New track record!</p>}
        <div className="flex gap-3">
          <button
            onClick={() => startRace(selectedTrack)}
            className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-700"
          >
            Race again
          </button>
          <button
            onClick={() => setScreen("select")}
            className="rounded-lg bg-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-300"
          >
            Pick another track
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function TouchBtn({
  label,
  onDown,
  onUp,
  wide,
}: {
  label: string;
  onDown: () => void;
  onUp: () => void;
  wide?: boolean;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        onDown();
      }}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      className={`touch-none select-none ${wide ? "h-14 px-5 text-base" : "h-14 w-14 text-2xl"} rounded-2xl bg-white font-bold text-slate-900 shadow active:bg-sky-50`}
    >
      {label}
    </button>
  );
}
