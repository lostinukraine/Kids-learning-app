"use client";

import { useEffect, useRef, useState } from "react";
import { recordGameSession } from "@/lib/record-session";
import DifficultyGate from "@/components/DifficultyGate";
import type { Difficulty } from "@/lib/difficulty";

const GRID = 18;
const CELL = 22;
const SIZE = GRID * CELL;

const SPEED_BY_DIFFICULTY: Record<Difficulty, { base: number; step: number; min: number }> = {
  easy: { base: 220, step: 0, min: 220 },
  medium: { base: 150, step: 3, min: 90 },
  hard: { base: 110, step: 4, min: 60 },
  expert: { base: 85, step: 5, min: 45 },
};

type Point = { x: number; y: number };
type Dir = "up" | "down" | "left" | "right";

const OPPOSITE: Record<Dir, Dir> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

function randCell(exclude: Point[]): Point {
  let p: Point;
  do {
    p = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
  } while (exclude.some((e) => e.x === p.x && e.y === p.y));
  return p;
}

function initialSnake(): Point[] {
  return [{ x: 8, y: 9 }, { x: 7, y: 9 }, { x: 6, y: 9 }];
}

export default function Snake({ kidId }: { kidId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snakeRef = useRef<Point[]>(initialSnake());
  const dirRef = useRef<Dir>("right");
  const nextDirRef = useRef<Dir>("right");
  const foodRef = useRef<Point>(randCell(initialSnake()));
  const touchStart = useRef<Point | null>(null);

  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [running, setRunning] = useState(true);
  const startedAt = useRef(new Date());
  const recorded = useRef(false);

  useEffect(() => {
    if (gameOver && !recorded.current && difficulty) {
      recorded.current = true;
      recordGameSession({
        kidId,
        gameType: "snake",
        subject: "classic",
        skillTag: `snake-${difficulty}`,
        startedAt: startedAt.current,
        score,
      });
    }
  }, [gameOver, kidId, score, difficulty]);

  function queueDir(dir: Dir) {
    if (dir !== OPPOSITE[dirRef.current]) {
      nextDirRef.current = dir;
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const map: Record<string, Dir> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        w: "up",
        s: "down",
        a: "left",
        d: "right",
      };
      const dir = map[e.key];
      if (dir) {
        e.preventDefault();
        queueDir(dir);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!running || !difficulty) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const { base, step, min } = SPEED_BY_DIFFICULTY[difficulty];
    const tickMs = Math.max(min, base - step * score);

    const interval = setInterval(() => {
      dirRef.current = nextDirRef.current;
      const head = snakeRef.current[0];
      const delta: Record<Dir, Point> = {
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 },
      };
      const d = delta[dirRef.current];
      const newHead = { x: head.x + d.x, y: head.y + d.y };

      const hitsWall =
        newHead.x < 0 || newHead.y < 0 || newHead.x >= GRID || newHead.y >= GRID;
      const hitsSelf = snakeRef.current.some(
        (s) => s.x === newHead.x && s.y === newHead.y,
      );

      if (hitsWall || hitsSelf) {
        setRunning(false);
        setGameOver(true);
        return;
      }

      const ateFood = newHead.x === foodRef.current.x && newHead.y === foodRef.current.y;
      const newSnake = [newHead, ...snakeRef.current];
      if (ateFood) {
        setScore((s) => s + 1);
        foodRef.current = randCell(newSnake);
      } else {
        newSnake.pop();
      }
      snakeRef.current = newSnake;

      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = "#f87171";
      ctx.fillRect(foodRef.current.x * CELL, foodRef.current.y * CELL, CELL - 2, CELL - 2);
      ctx.fillStyle = "#22c55e";
      newSnake.forEach((seg, i) => {
        ctx.fillStyle = i === 0 ? "#4ade80" : "#22c55e";
        ctx.fillRect(seg.x * CELL, seg.y * CELL, CELL - 2, CELL - 2);
      });
    }, tickMs);

    return () => clearInterval(interval);
  }, [running, difficulty, score]);

  function reset() {
    snakeRef.current = initialSnake();
    dirRef.current = "right";
    nextDirRef.current = "right";
    foodRef.current = randCell(snakeRef.current);
    setScore(0);
    setGameOver(false);
    setRunning(true);
    startedAt.current = new Date();
    recorded.current = false;
  }

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    let dir: Dir;
    if (Math.abs(dx) > Math.abs(dy)) {
      dir = dx > 0 ? "right" : "left";
    } else {
      dir = dy > 0 ? "down" : "up";
    }
    queueDir(dir);
    touchStart.current = null;
  }

  if (!difficulty) {
    return (
      <DifficultyGate
        title="Choose a difficulty"
        description="Higher difficulties start faster and speed up quicker as you eat."
        onSelect={setDifficulty}
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-lg font-semibold text-slate-700">Score: {score}</p>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="max-w-full touch-none rounded-xl shadow-lg"
      />
      <div className="grid grid-cols-3 gap-2">
        <span />
        <DPadBtn label="⬆" onClick={() => queueDir("up")} />
        <span />
        <DPadBtn label="⬅" onClick={() => queueDir("left")} />
        <DPadBtn label="⬇" onClick={() => queueDir("down")} />
        <DPadBtn label="➡" onClick={() => queueDir("right")} />
      </div>
      <p className="text-xs text-slate-400">Arrow keys, swipe, or the buttons above</p>
      {gameOver && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xl font-bold text-slate-800">Game over! 🐍</p>
          <button
            onClick={reset}
            className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-700"
          >
            Play again
          </button>
        </div>
      )}
    </div>
  );
}

function DPadBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-14 w-14 touch-none select-none rounded-xl bg-white text-2xl font-bold text-slate-900 shadow active:bg-sky-50"
    >
      {label}
    </button>
  );
}
