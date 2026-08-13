"use client";

import { useEffect, useRef, useState } from "react";
import { recordGameSession } from "@/lib/record-session";
import type { Tier } from "@/lib/grade-tiers";
import DifficultyGate from "@/components/DifficultyGate";
import { type Difficulty } from "@/lib/difficulty";

const EMOJI_POOL = ["🐶", "🐱", "🐵", "🦊", "🐼", "🐸", "🦁", "🐰", "🐨", "🐷", "🐮", "🐯", "🦄", "🐔"];

// Grade tier alone made Pre-K/K a fixed, easy 6 pairs no matter what — fine
// for a first-time player, but nothing to grow into once a kid outpaces it.
// "Medium" keeps each tier's original pair count so nothing changes for
// anyone who always just plays the default; "easy"/"hard"/"expert" widen out
// from there. Clamped to the emoji pool size (14) so hard/expert on the
// oldest tier can't ask for more distinct pairs than exist to draw from.
const PAIRS_BY_TIER: Record<Tier, number> = {
  PRE_K_K: 6,
  FIRST_SECOND: 8,
  THIRD_FIFTH: 12,
};

const DIFFICULTY_OFFSET: Record<Difficulty, number> = {
  easy: -2,
  medium: 0,
  hard: 2,
  expert: 4,
};

function pairsFor(tier: Tier, difficulty: Difficulty): number {
  const raw = PAIRS_BY_TIER[tier] + DIFFICULTY_OFFSET[difficulty];
  return Math.max(4, Math.min(EMOJI_POOL.length, raw));
}

interface CardState {
  key: string;
  emoji: string;
  matched: boolean;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildDeck(pairCount: number): CardState[] {
  const chosen = shuffle(EMOJI_POOL).slice(0, pairCount);
  const deck = shuffle(
    chosen.flatMap((emoji, i) => [
      { key: `${i}-a`, emoji, matched: false },
      { key: `${i}-b`, emoji, matched: false },
    ]),
  );
  return deck;
}

export default function MemoryMatch({ kidId, tier }: { kidId: string; tier: Tier }) {
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const pairCount = difficulty ? pairsFor(tier, difficulty) : PAIRS_BY_TIER[tier];
  const [deck, setDeck] = useState<CardState[]>(() => buildDeck(pairCount));
  const [flipped, setFlipped] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [locked, setLocked] = useState(false);
  const startedAt = useRef(new Date());

  const allMatched = deck.every((c) => c.matched);

  useEffect(() => {
    if (allMatched) {
      const accuracy = Math.round((pairCount / moves) * 100);
      recordGameSession({
        kidId,
        gameType: "memory-match",
        subject: "classic",
        skillTag: "memory",
        startedAt: startedAt.current,
        score: moves,
        accuracy: Math.min(100, accuracy),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMatched]);

  function flip(index: number) {
    if (locked || flipped.includes(index) || deck[index].matched) return;
    const next = [...flipped, index];
    setFlipped(next);

    if (next.length === 2) {
      setLocked(true);
      setMoves((m) => m + 1);
      const [a, b] = next;
      if (deck[a].emoji === deck[b].emoji) {
        setTimeout(() => {
          setDeck((d) =>
            d.map((c, i) => (i === a || i === b ? { ...c, matched: true } : c)),
          );
          setFlipped([]);
          setLocked(false);
        }, 500);
      } else {
        setTimeout(() => {
          setFlipped([]);
          setLocked(false);
        }, 900);
      }
    }
  }

  function reset() {
    setDeck(buildDeck(pairCount));
    setFlipped([]);
    setMoves(0);
    startedAt.current = new Date();
  }

  function chooseDifficulty(chosen: Difficulty) {
    setDifficulty(chosen);
    setDeck(buildDeck(pairsFor(tier, chosen)));
    setFlipped([]);
    setMoves(0);
    startedAt.current = new Date();
  }

  if (!difficulty) {
    return (
      <DifficultyGate
        title="Choose a difficulty"
        description="Harder difficulties add more pairs to remember."
        onSelect={chooseDifficulty}
      />
    );
  }

  const cols = pairCount <= 6 ? 4 : pairCount <= 8 ? 4 : 6;

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex items-center gap-3">
        <p className="text-sm font-semibold text-slate-600">Moves: {moves}</p>
        <button
          onClick={() => setDifficulty(null)}
          className="text-xs font-medium text-slate-400 underline hover:text-slate-600"
        >
          Change difficulty
        </button>
      </div>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {deck.map((card, i) => {
          const shown = card.matched || flipped.includes(i);
          return (
            <button
              key={card.key}
              onClick={() => flip(i)}
              className={`flex h-16 w-16 items-center justify-center rounded-xl text-3xl shadow transition sm:h-20 sm:w-20 ${
                shown ? "bg-white" : "bg-sky-500 hover:bg-sky-600"
              }`}
            >
              {shown ? card.emoji : ""}
            </button>
          );
        })}
      </div>

      {allMatched && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xl font-bold text-slate-800">
            All matched in {moves} moves! 🎉
          </p>
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
