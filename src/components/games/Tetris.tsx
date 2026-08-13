"use client";

import { useEffect, useRef, useState } from "react";
import { recordGameSession } from "@/lib/record-session";
import DifficultyGate from "@/components/DifficultyGate";
import type { Difficulty } from "@/lib/difficulty";

const COLS = 10;
const ROWS = 20;
const CELL = 24;

const SPEED_BY_DIFFICULTY: Record<Difficulty, { start: number; perLine: number; min: number }> = {
  easy: { start: 900, perLine: 25, min: 350 },
  medium: { start: 700, perLine: 40, min: 180 },
  hard: { start: 500, perLine: 45, min: 120 },
  expert: { start: 350, perLine: 50, min: 80 },
};

type Board = (string | null)[][];

const SHAPES: Record<string, { blocks: number[][]; color: string }> = {
  I: { blocks: [[0, 1], [1, 1], [2, 1], [3, 1]], color: "#22d3ee" },
  O: { blocks: [[1, 0], [2, 0], [1, 1], [2, 1]], color: "#facc15" },
  T: { blocks: [[1, 0], [0, 1], [1, 1], [2, 1]], color: "#c084fc" },
  S: { blocks: [[1, 0], [2, 0], [0, 1], [1, 1]], color: "#4ade80" },
  Z: { blocks: [[0, 0], [1, 0], [1, 1], [2, 1]], color: "#f87171" },
  J: { blocks: [[0, 0], [0, 1], [1, 1], [2, 1]], color: "#60a5fa" },
  L: { blocks: [[2, 0], [0, 1], [1, 1], [2, 1]], color: "#fb923c" },
};
const SHAPE_KEYS = Object.keys(SHAPES);

interface Piece {
  key: string;
  cells: number[][];
  color: string;
}

interface GameState {
  board: Board;
  piece: Piece;
}

function spawnPiece(): Piece {
  const key = SHAPE_KEYS[Math.floor(Math.random() * SHAPE_KEYS.length)];
  const shape = SHAPES[key];
  return {
    key,
    color: shape.color,
    cells: shape.blocks.map(([x, y]) => [x + 3, y]),
  };
}

function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function initialGameState(): GameState {
  return { board: emptyBoard(), piece: spawnPiece() };
}

function rotate(cells: number[][]): number[][] {
  const cx = Math.round(cells.reduce((s, [x]) => s + x, 0) / cells.length);
  const cy = Math.round(cells.reduce((s, [, y]) => s + y, 0) / cells.length);
  return cells.map(([x, y]) => {
    const relX = x - cx;
    const relY = y - cy;
    return [cx - relY, cy + relX];
  });
}

function collides(board: Board, cells: number[][]): boolean {
  return cells.some(([x, y]) => {
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y < 0) return false;
    return board[y][x] !== null;
  });
}

export default function Tetris({ kidId }: { kidId: string }) {
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [game, setGame] = useState<GameState>(initialGameState);
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [paused, setPaused] = useState(false);
  const startedAt = useRef(new Date());
  const recorded = useRef(false);

  const { start, perLine, min } = SPEED_BY_DIFFICULTY[difficulty ?? "medium"];
  const speed = Math.max(min, start - lines * perLine);

  function performLock(pieceOverride?: Piece) {
    const piece = pieceOverride ?? game.piece;
    const next = game.board.map((row) => [...row]);
    piece.cells.forEach(([x, y]) => {
      if (y >= 0) next[y][x] = piece.color;
    });

    let cleared = 0;
    const filtered = next.filter((row) => {
      const full = row.every((c) => c !== null);
      if (full) cleared++;
      return !full;
    });
    while (filtered.length < ROWS) filtered.unshift(Array(COLS).fill(null));

    if (cleared > 0) {
      setScore((s) => s + [0, 100, 300, 500, 800][cleared]);
      setLines((l) => l + cleared);
    }

    const spawned = spawnPiece();
    if (collides(filtered, spawned.cells)) {
      setGameOver(true);
    }
    setGame({ board: filtered, piece: spawned });
  }

  function attemptMove(dx: number, dy: number) {
    if (gameOver || paused) return;
    const moved = game.piece.cells.map(([x, y]) => [x + dx, y + dy]);
    if (!collides(game.board, moved)) {
      setGame({ ...game, piece: { ...game.piece, cells: moved } });
    } else if (dy === 1) {
      performLock();
    }
  }

  function rotatePiece() {
    if (gameOver || paused) return;
    const rotated = rotate(game.piece.cells);
    if (!collides(game.board, rotated)) {
      setGame({ ...game, piece: { ...game.piece, cells: rotated } });
    }
  }

  function hardDrop() {
    if (gameOver || paused) return;
    let cells = game.piece.cells;
    while (!collides(game.board, cells.map(([x, y]) => [x, y + 1]))) {
      cells = cells.map(([x, y]) => [x, y + 1]);
    }
    performLock({ ...game.piece, cells });
  }

  useEffect(() => {
    if (gameOver && !recorded.current && difficulty) {
      recorded.current = true;
      recordGameSession({
        kidId,
        gameType: "tetris",
        subject: "classic",
        skillTag: `tetris-${difficulty}`,
        startedAt: startedAt.current,
        score,
      });
    }
  }, [gameOver, kidId, score, difficulty]);

  useEffect(() => {
    if (gameOver || paused || !difficulty) return;
    const interval = setInterval(() => attemptMove(0, 1), speed);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, gameOver, paused, speed, difficulty]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") attemptMove(-1, 0);
      else if (e.key === "ArrowRight") attemptMove(1, 0);
      else if (e.key === "ArrowDown") attemptMove(0, 1);
      else if (e.key === "ArrowUp") rotatePiece();
      else if (e.key === " ") {
        e.preventDefault();
        hardDrop();
      } else if (e.key === "p" || e.key === "P") {
        setPaused((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, gameOver, paused]);

  function reset() {
    setGame(initialGameState());
    setScore(0);
    setLines(0);
    setGameOver(false);
    setPaused(false);
    startedAt.current = new Date();
    recorded.current = false;
  }

  const display = game.board.map((row) => [...row]);
  game.piece.cells.forEach(([x, y]) => {
    if (y >= 0 && y < ROWS && x >= 0 && x < COLS) display[y][x] = game.piece.color;
  });

  if (!difficulty) {
    return (
      <DifficultyGate
        title="Choose a difficulty"
        description="Higher difficulties drop faster and speed up quicker per line cleared."
        onSelect={setDifficulty}
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-6 text-sm font-semibold text-slate-600">
        <span>Score: {score}</span>
        <span>Lines: {lines}</span>
      </div>

      <div
        className="grid gap-px rounded-lg bg-slate-700 p-1 shadow-lg"
        style={{
          gridTemplateColumns: `repeat(${COLS}, ${CELL}px)`,
          gridTemplateRows: `repeat(${ROWS}, ${CELL}px)`,
        }}
      >
        {display.flatMap((row, y) =>
          row.map((cell, x) => (
            <div
              key={`${x}-${y}`}
              style={{ backgroundColor: cell ?? "#1e293b" }}
              className="rounded-[2px]"
            />
          )),
        )}
      </div>

      <div className="flex gap-2">
        <TouchBtn label="⬅" onClick={() => attemptMove(-1, 0)} />
        <TouchBtn label="⟳" onClick={rotatePiece} />
        <TouchBtn label="➡" onClick={() => attemptMove(1, 0)} />
        <TouchBtn label="⬇" onClick={() => attemptMove(0, 1)} />
        <TouchBtn label="⤓" onClick={hardDrop} />
      </div>
      <p className="text-center text-xs text-slate-400">
        Tap the buttons, or use arrow keys + Space to hard drop, P to pause
      </p>

      {gameOver && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xl font-bold text-slate-800">Game over! 🧱</p>
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
