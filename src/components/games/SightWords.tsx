"use client";

import { useEffect, useRef, useState } from "react";
import { recordGameSession } from "@/lib/record-session";
import { playCorrect, playHurt, playGameOver } from "@/lib/arcade-sound";

const COLS = 5;
const ROWS = 4;
const TARGET_COPIES = 3;
const STARTING_LIVES = 3;
const MOVE_COOLDOWN_MS = 140;
const TROGGLE_TICK_MS = 700;
const INVULNERABLE_MS = 900;
const START_POS: Pos = { x: 2, y: 2 };

type Dir = "up" | "down" | "left" | "right";
const DELTA: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

interface Tile {
  word: string;
  isTarget: boolean;
  eaten: boolean;
}

interface Pos {
  x: number;
  y: number;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomEmptyCell(occupied: Pos[]): Pos {
  let pos: Pos;
  do {
    pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
  } while (occupied.some((o) => o.x === pos.x && o.y === pos.y));
  return pos;
}

function buildGrid(words: string[], target: string): Tile[][] {
  const cellCount = COLS * ROWS;
  const targetPositions = new Set<number>();
  while (targetPositions.size < Math.min(TARGET_COPIES, cellCount)) {
    targetPositions.add(Math.floor(Math.random() * cellCount));
  }

  const decoyPool = words.filter((w) => w !== target);
  const flat: Tile[] = [];
  for (let i = 0; i < cellCount; i++) {
    if (targetPositions.has(i)) {
      flat.push({ word: target, isTarget: true, eaten: false });
    } else {
      const decoy = decoyPool[Math.floor(Math.random() * decoyPool.length)] ?? target;
      flat.push({ word: decoy, isTarget: false, eaten: false });
    }
  }

  const grid: Tile[][] = [];
  for (let y = 0; y < ROWS; y++) {
    grid.push(flat.slice(y * COLS, y * COLS + COLS));
  }
  return grid;
}

function trogglesForWave(wave: number): number {
  return wave >= 5 ? 2 : 1;
}

export default function SightWords({
  kidId,
  words,
  skillTag,
}: {
  kidId: string;
  words: string[];
  skillTag: string;
}) {
  const [target, setTarget] = useState<string>(() => shuffle(words)[0]);
  const [grid, setGrid] = useState<Tile[][]>(() => buildGrid(words, target));
  const [player, setPlayer] = useState<Pos>(START_POS);
  const [troggles, setTroggles] = useState<Pos[]>(() => [randomEmptyCell([START_POS])]);
  const [lives, setLives] = useState(STARTING_LIVES);
  const [score, setScore] = useState(0);
  const [wave, setWave] = useState(1);
  const [correctMunches, setCorrectMunches] = useState(0);
  const [totalMunches, setTotalMunches] = useState(0);
  const [flash, setFlash] = useState<"good" | "bad" | null>(null);
  const [started, setStarted] = useState(false);

  const lastMoveRef = useRef(0);
  const invulnerableUntilRef = useRef(0);
  const startedAt = useRef(new Date());
  const recorded = useRef(false);

  const gameOver = lives <= 0;
  const accuracy = totalMunches > 0 ? Math.round((correctMunches / totalMunches) * 100) : 0;

  function startWave(newWave: number, wordList: string[]) {
    const nextTarget = shuffle(wordList)[0];
    setTarget(nextTarget);
    setGrid(buildGrid(wordList, nextTarget));
    setPlayer(START_POS);
    setTroggles(
      Array.from({ length: trogglesForWave(newWave) }, () => randomEmptyCell([START_POS])),
    );
  }

  useEffect(() => {
    if (!gameOver || recorded.current) return;
    recorded.current = true;
    playGameOver();
    recordGameSession({
      kidId,
      gameType: "reading",
      subject: "reading",
      skillTag,
      startedAt: startedAt.current,
      score,
      accuracy,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver]);

  function takeHit() {
    const now = performance.now();
    if (now < invulnerableUntilRef.current) return;
    invulnerableUntilRef.current = now + INVULNERABLE_MS;
    playHurt();
    setLives((l) => Math.max(l - 1, 0));
    setFlash("bad");
    setTimeout(() => setFlash(null), 250);
  }

  function munch(pos: Pos) {
    const tile = grid[pos.y][pos.x];
    if (tile.eaten) return;

    setTotalMunches((m) => m + 1);
    setGrid((g) => {
      const next = g.map((row) => [...row]);
      next[pos.y][pos.x] = { ...tile, eaten: true };
      return next;
    });

    if (tile.isTarget) {
      playCorrect();
      setScore((s) => s + 50);
      setCorrectMunches((c) => c + 1);
      setFlash("good");
      setTimeout(() => setFlash(null), 250);
    } else {
      takeHit();
    }
  }

  // Advance to the next wave once every copy of the target has been munched.
  useEffect(() => {
    if (gameOver) return;
    const flat = grid.flat();
    const remaining = flat.filter((t) => t.isTarget && !t.eaten).length;
    if (remaining === 0 && flat.some((t) => t.isTarget)) {
      const nextWave = wave + 1;
      setTimeout(() => {
        setWave(nextWave);
        startWave(nextWave, words);
      }, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, gameOver]);

  function move(dir: Dir) {
    if (!started || gameOver) return;
    const now = performance.now();
    if (now - lastMoveRef.current < MOVE_COOLDOWN_MS) return;
    lastMoveRef.current = now;

    const [dx, dy] = DELTA[dir];
    const next = {
      x: Math.max(0, Math.min(COLS - 1, player.x + dx)),
      y: Math.max(0, Math.min(ROWS - 1, player.y + dy)),
    };
    setPlayer(next);
    munch(next);
    if (troggles.some((t) => t.x === next.x && t.y === next.y)) takeHit();
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
        move(dir);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, gameOver, player, troggles]);

  // Troggles wander the grid; landing on the player costs a life.
  useEffect(() => {
    if (!started || gameOver) return;
    const interval = setInterval(() => {
      setTroggles((current) =>
        current.map((t) => {
          const options: Pos[] = [
            { x: t.x, y: t.y },
            { x: Math.max(0, t.x - 1), y: t.y },
            { x: Math.min(COLS - 1, t.x + 1), y: t.y },
            { x: t.x, y: Math.max(0, t.y - 1) },
            { x: t.x, y: Math.min(ROWS - 1, t.y + 1) },
          ];
          return options[Math.floor(Math.random() * options.length)];
        }),
      );
    }, TROGGLE_TICK_MS);
    return () => clearInterval(interval);
  }, [started, gameOver]);

  useEffect(() => {
    if (gameOver) return;
    if (troggles.some((t) => t.x === player.x && t.y === player.y)) takeHit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [troggles]);

  function reset() {
    setLives(STARTING_LIVES);
    setScore(0);
    setWave(1);
    setCorrectMunches(0);
    setTotalMunches(0);
    setFlash(null);
    invulnerableUntilRef.current = 0;
    startWave(1, words);
    startedAt.current = new Date();
    recorded.current = false;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full max-w-[380px] items-center justify-between text-sm font-semibold text-slate-600">
        <span>Score: {score}</span>
        <span>Wave: {wave}</span>
        <span>{"❤️".repeat(Math.max(lives, 0))}</span>
      </div>

      <div className="rounded-2xl bg-white px-6 py-2 text-xl font-extrabold text-slate-800 shadow">
        Munch: <span className="text-emerald-600">{target}</span>
      </div>

      <div className="relative">
        <div
          className={`grid gap-1 rounded-xl p-2 shadow-lg transition-colors ${
            flash === "good" ? "bg-emerald-700" : flash === "bad" ? "bg-red-700" : "bg-emerald-900"
          }`}
          style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
        >
          {grid.map((row, y) =>
            row.map((tile, x) => {
              const isPlayer = player.x === x && player.y === y;
              const troggleHere = troggles.some((t) => t.x === x && t.y === y);
              return (
                <div
                  key={`${x}-${y}`}
                  className={`flex h-14 w-16 items-center justify-center rounded-md text-[11px] font-bold sm:h-16 sm:w-20 sm:text-xs ${
                    tile.eaten ? "bg-emerald-950" : "bg-emerald-100 text-emerald-900"
                  }`}
                >
                  {isPlayer ? (
                    <span className="text-2xl">😋</span>
                  ) : troggleHere ? (
                    <span className="text-2xl">👾</span>
                  ) : (
                    !tile.eaten && tile.word
                  )}
                </div>
              );
            }),
          )}
        </div>

        {!started && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/85 p-5 text-center text-white">
            <p className="text-2xl font-bold">How to play</p>
            <ul className="flex flex-col gap-1.5 text-left text-sm">
              <li>😋 You move with the arrow keys (or the buttons below).</li>
              <li>Moving onto a tile <strong>eats it</strong> — that&rsquo;s the whole move.</li>
              <li>
                Eat every tile that says <strong className="text-emerald-400">{target}</strong>{" "}
                to clear the wave.
              </li>
              <li>Eating a wrong word — or touching 👾 — costs a ❤️.</li>
            </ul>
            <button
              onClick={() => setStarted(true)}
              className="mt-1 rounded-lg bg-sky-500 px-5 py-2 font-semibold text-white hover:bg-sky-400"
            >
              Start munching!
            </button>
          </div>
        )}

        {gameOver && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/70 text-center text-white">
            <p className="text-2xl font-bold">Munched! 👾</p>
            <p className="text-sm">
              {correctMunches}/{totalMunches} correct ({accuracy}%) · Score {score}
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

      <div className="grid grid-cols-3 gap-2">
        <span />
        <TouchBtn label="⬆" onClick={() => move("up")} />
        <span />
        <TouchBtn label="⬅" onClick={() => move("left")} />
        <TouchBtn label="⬇" onClick={() => move("down")} />
        <TouchBtn label="➡" onClick={() => move("right")} />
      </div>
      <p className="max-w-[380px] text-center text-xs text-slate-400">
        😋 = you · 👾 = avoid · walk onto a {target.toUpperCase()} tile to eat it and score
      </p>
    </div>
  );
}

function TouchBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-14 w-14 touch-none select-none rounded-xl bg-white text-2xl font-bold text-slate-900 shadow active:bg-sky-50"
    >
      {label}
    </button>
  );
}
