"use client";

import { useEffect, useRef, useState } from "react";
import { recordGameSession } from "@/lib/record-session";
import { playShoot, playExplosion, playCorrect, playHurt, playGameOver } from "@/lib/arcade-sound";
import type { GradeLevel } from "@prisma/client";

const WIDTH = 360;
const HEIGHT = 480;
const SHIP_Y = HEIGHT - 40;
const SHIP_SPEED = 260; // px/sec
const PROJECTILE_SPEED = 420; // px/sec
const SHOOT_COOLDOWN = 260; // ms
const STARTING_LIVES = 3;
const ROCK_RADIUS = 26;

interface Question {
  a: number;
  b: number;
  op: "+" | "-" | "×" | "÷";
}

interface Rock {
  x: number;
  y: number;
  label: number;
  correct: boolean;
  alive: boolean;
}

interface Projectile {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function addSub(min: number, max: number, allowSub: boolean): Question {
  if (!allowSub || Math.random() < 0.5) {
    return { a: randInt(min, max), b: randInt(min, max), op: "+" };
  }
  const a = randInt(min + 1, max);
  return { a, b: randInt(min, a), op: "-" };
}

function multiplyFacts(max: number): Question {
  return { a: randInt(1, max), b: randInt(1, max), op: "×" };
}

function divideFacts(max: number): Question {
  // Build from a whole-number multiplication so the division is exact.
  const b = randInt(2, max);
  const result = randInt(1, max);
  return { a: b * result, b, op: "÷" };
}

function makeQuestion(grade: GradeLevel): Question {
  switch (grade) {
    case "PRE_K":
      return addSub(1, 3, false);
    case "K":
      return addSub(1, 5, false);
    case "FIRST":
      return addSub(1, 10, true);
    case "SECOND":
      return addSub(5, 20, true);
    case "THIRD":
      return Math.random() < 0.6 ? addSub(10, 100, true) : multiplyFacts(5);
    case "FOURTH":
      return Math.random() < 0.4 ? addSub(50, 1000, true) : multiplyFacts(10);
    case "FIFTH": {
      const roll = Math.random();
      if (roll < 0.4) return multiplyFacts(12);
      if (roll < 0.75) return divideFacts(12);
      return addSub(100, 1000, true);
    }
  }
}

function answer(q: Question) {
  if (q.op === "+") return q.a + q.b;
  if (q.op === "-") return q.a - q.b;
  if (q.op === "×") return q.a * q.b;
  return q.a / q.b;
}

function makeRocks(question: Question): Rock[] {
  const correctAnswer = answer(question);
  const maxOffset = Math.max(3, Math.round(correctAnswer * 0.15) + 2);
  const distractors = new Set<number>();
  while (distractors.size < 3) {
    const offset = randInt(1, maxOffset) * (Math.random() < 0.5 ? -1 : 1);
    const candidate = correctAnswer + offset;
    if (candidate !== correctAnswer && candidate >= 0) distractors.add(candidate);
  }

  const labels = [correctAnswer, ...distractors];
  for (let i = labels.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [labels[i], labels[j]] = [labels[j], labels[i]];
  }

  const slotWidth = WIDTH / labels.length;
  return labels.map((label, i) => ({
    x: slotWidth * i + slotWidth / 2,
    y: -ROCK_RADIUS - i * 40,
    label,
    correct: label === correctAnswer,
    alive: true,
  }));
}

export default function MathFacts({ kidId, grade }: { kidId: string; grade: GradeLevel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shipXRef = useRef(WIDTH / 2);
  const rocksRef = useRef<Rock[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const keysRef = useRef<Set<string>>(new Set());
  const lastShotRef = useRef(0);
  const fallSpeedRef = useRef(40);
  const roundEndedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const [question, setQuestion] = useState<Question>(() => makeQuestion(grade));
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [wave, setWave] = useState(1);
  const [lives, setLives] = useState(STARTING_LIVES);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalRounds, setTotalRounds] = useState(0);
  const startedAt = useRef(new Date());
  const recorded = useRef(false);

  const gameOver = lives <= 0;

  useEffect(() => {
    rocksRef.current = makeRocks(question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accuracy = totalRounds > 0 ? Math.round((correctCount / totalRounds) * 100) : 0;

  useEffect(() => {
    if (!gameOver || recorded.current) return;
    recorded.current = true;
    playGameOver();
    recordGameSession({
      kidId,
      gameType: "math-facts",
      subject: "math",
      skillTag: `math-${grade.toLowerCase()}`,
      startedAt: startedAt.current,
      score,
      accuracy,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver]);

  function nextRound(missed: boolean) {
    if (roundEndedRef.current) return;
    roundEndedRef.current = true;

    setTotalRounds((r) => r + 1);
    if (missed) {
      setStreak(0);
      setLives((l) => Math.max(l - 1, 0));
    } else {
      setCorrectCount((c) => c + 1);
      setStreak((s) => s + 1);
      setWave((w) => w + 1);
      fallSpeedRef.current = Math.min(fallSpeedRef.current + 6, 160);
    }

    setTimeout(() => {
      const q = makeQuestion(grade);
      setQuestion(q);
      rocksRef.current = makeRocks(q);
      projectilesRef.current = [];
      roundEndedRef.current = false;
    }, 550);
  }

  function destroyRock(rock: Rock) {
    rock.alive = false;
    const color = rock.correct ? "#4ade80" : "#f87171";
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI * 2 * i) / 10;
      particlesRef.current.push({
        x: rock.x,
        y: rock.y,
        vx: Math.cos(angle) * 90,
        vy: Math.sin(angle) * 90,
        life: 0.4,
        color,
      });
    }
    if (rock.correct) {
      playCorrect();
      nextRound(false);
    } else {
      playExplosion();
      playHurt();
      nextRound(true);
    }
  }

  function shoot() {
    if (gameOver) return;
    const now = performance.now();
    if (now - lastShotRef.current < SHOOT_COOLDOWN) return;
    lastShotRef.current = now;
    projectilesRef.current.push({ x: shipXRef.current, y: SHIP_Y - 16 });
    playShoot();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (["ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
      keysRef.current.add(e.key);
      if (e.key === " ") shoot();
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
  }, [gameOver]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let lastTime = performance.now();

    const frame = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      if (!gameOver) {
        if (keysRef.current.has("ArrowLeft")) shipXRef.current -= SHIP_SPEED * dt;
        if (keysRef.current.has("ArrowRight")) shipXRef.current += SHIP_SPEED * dt;
        shipXRef.current = Math.max(20, Math.min(WIDTH - 20, shipXRef.current));

        for (const rock of rocksRef.current) {
          if (!rock.alive) continue;
          rock.y += fallSpeedRef.current * dt;
          if (rock.y > HEIGHT + ROCK_RADIUS) {
            rock.alive = false;
            if (rock.correct) nextRound(true);
          }
        }

        for (const p of projectilesRef.current) {
          p.y -= PROJECTILE_SPEED * dt;
        }
        projectilesRef.current = projectilesRef.current.filter((p) => p.y > -10);

        for (const p of projectilesRef.current) {
          for (const rock of rocksRef.current) {
            if (!rock.alive) continue;
            const dx = p.x - rock.x;
            const dy = p.y - rock.y;
            if (Math.sqrt(dx * dx + dy * dy) < ROCK_RADIUS) {
              p.y = -100;
              destroyRock(rock);
              break;
            }
          }
        }
      }

      for (const particle of particlesRef.current) {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.life -= dt;
      }
      particlesRef.current = particlesRef.current.filter((p) => p.life > 0);

      // --- draw ---
      const bgGradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
      bgGradient.addColorStop(0, "#0f172a");
      bgGradient.addColorStop(1, "#1e293b");
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      for (const rock of rocksRef.current) {
        if (!rock.alive) continue;
        ctx.beginPath();
        ctx.arc(rock.x, rock.y, ROCK_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "#78716c";
        ctx.fill();
        ctx.strokeStyle = "#57534e";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(rock.label), rock.x, rock.y + 1);
      }

      ctx.fillStyle = "#38bdf8";
      for (const p of projectilesRef.current) {
        ctx.fillRect(p.x - 2, p.y - 8, 4, 16);
      }

      for (const particle of particlesRef.current) {
        ctx.globalAlpha = Math.max(particle.life / 0.4, 0);
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (!gameOver) {
        const sx = shipXRef.current;
        ctx.fillStyle = "#e2e8f0";
        ctx.beginPath();
        ctx.moveTo(sx, SHIP_Y - 18);
        ctx.lineTo(sx - 16, SHIP_Y + 14);
        ctx.lineTo(sx, SHIP_Y + 4);
        ctx.lineTo(sx + 16, SHIP_Y + 14);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#38bdf8";
        ctx.beginPath();
        ctx.arc(sx, SHIP_Y - 4, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver]);

  function reset() {
    fallSpeedRef.current = 40;
    shipXRef.current = WIDTH / 2;
    projectilesRef.current = [];
    particlesRef.current = [];
    roundEndedRef.current = false;
    const q = makeQuestion(grade);
    setQuestion(q);
    rocksRef.current = makeRocks(q);
    setScore(0);
    setStreak(0);
    setWave(1);
    setLives(STARTING_LIVES);
    setCorrectCount(0);
    setTotalRounds(0);
    startedAt.current = new Date();
    recorded.current = false;
  }

  // Score is derived from correct answers + streak bonus, applied when a round is won.
  const prevCorrect = useRef(0);
  useEffect(() => {
    if (correctCount > prevCorrect.current) {
      setScore((s) => s + 100 + (streak - 1) * 20);
    }
    prevCorrect.current = correctCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correctCount]);

  function pressDir(key: "ArrowLeft" | "ArrowRight") {
    keysRef.current.add(key);
  }
  function releaseDir(key: "ArrowLeft" | "ArrowRight") {
    keysRef.current.delete(key);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full max-w-[360px] items-center justify-between text-sm font-semibold text-slate-600">
        <span>Score: {score}</span>
        <span>Wave: {wave}</span>
        <span>{"❤️".repeat(Math.max(lives, 0))}</span>
      </div>

      <div className="rounded-2xl bg-white px-6 py-3 text-2xl font-extrabold text-slate-800 shadow">
        {question.a} {question.op} {question.b} = ?
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="rounded-xl shadow-lg"
        />
        {gameOver && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/70 text-center text-white">
            <p className="text-2xl font-bold">Blasted! 💥</p>
            <p className="text-sm">
              {correctCount}/{totalRounds} correct ({accuracy}%) · Score {score}
            </p>
            <button
              onClick={reset}
              className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-white hover:bg-sky-400"
            >
              Play again
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onPointerDown={() => pressDir("ArrowLeft")}
          onPointerUp={() => releaseDir("ArrowLeft")}
          onPointerLeave={() => releaseDir("ArrowLeft")}
          className="h-14 w-14 touch-none select-none rounded-xl bg-white text-2xl font-bold text-slate-900 shadow active:bg-sky-50"
        >
          ⬅
        </button>
        <button
          onPointerDown={shoot}
          className="h-14 w-20 touch-none rounded-xl bg-sky-500 text-lg font-bold text-white shadow active:bg-sky-600"
        >
          FIRE
        </button>
        <button
          onPointerDown={() => pressDir("ArrowRight")}
          onPointerUp={() => releaseDir("ArrowRight")}
          onPointerLeave={() => releaseDir("ArrowRight")}
          className="h-14 w-14 touch-none select-none rounded-xl bg-white text-2xl font-bold text-slate-900 shadow active:bg-sky-50"
        >
          ➡
        </button>
      </div>
      <p className="text-center text-xs text-slate-400">
        Hold ⬅➡ to steer, tap FIRE — or use arrow keys + Space
      </p>
    </div>
  );
}
