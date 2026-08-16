"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { recordGameSession } from "@/lib/record-session";
import { playCorrect, playHurt } from "@/lib/arcade-sound";
import { WHEEL_PUZZLES_BY_TIER, type WheelPuzzle } from "@/lib/wheel-content";
import type { Tier } from "@/lib/grade-tiers";
import DifficultyGate from "@/components/DifficultyGate";
import PlayerTwoGate from "@/components/PlayerTwoGate";
import { type Difficulty } from "@/lib/difficulty";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
// Roughly English letter-frequency order — the computer opponent's "smart"
// guess, same idea as a human contestant guessing common letters first.
const FREQUENCY_ORDER = "ETAOINSHRDLCUMWFGYPBVKJXQZ".split("");
const RANDOMNESS_BY_DIFFICULTY: Record<Difficulty, number> = {
  easy: 0.75,
  medium: 0.45,
  hard: 0.2,
  expert: 0.05,
};

interface Wedge {
  label: string;
  color: string;
  points: number;
}

// All-positive wedges — no "Lose a Turn"/"Bankrupt" wedge. The real stakes
// come from missing a letter (which hands the turn to the other player),
// not from wheel luck, keeping the spin itself a fun, encouraging moment.
const WHEEL_WEDGES: Wedge[] = [
  { label: "100", color: "#f97316", points: 100 },
  { label: "150", color: "#eab308", points: 150 },
  { label: "200", color: "#84cc16", points: 200 },
  { label: "250", color: "#06b6d4", points: 250 },
  { label: "300", color: "#3b82f6", points: 300 },
  { label: "400", color: "#8b5cf6", points: 400 },
  { label: "500", color: "#ec4899", points: 500 },
  { label: "BONUS!", color: "#f43f5e", points: 600 },
];

const SLICE_ANGLE = 360 / WHEEL_WEDGES.length;

function wheelBackground(): string {
  const stops = WHEEL_WEDGES.map((w, i) => `${w.color} ${i * SLICE_ANGLE}deg ${(i + 1) * SLICE_ANGLE}deg`);
  return `conic-gradient(${stops.join(", ")})`;
}

function pickPuzzle(tier: Tier, excludePhrase?: string): WheelPuzzle {
  const pool = WHEEL_PUZZLES_BY_TIER[tier];
  const choices = pool.length > 1 ? pool.filter((p) => p.phrase !== excludePhrase) : pool;
  return choices[Math.floor(Math.random() * choices.length)];
}

function computerPickLetter(guessed: Set<string>, difficulty: Difficulty): string {
  const remaining = LETTERS.filter((l) => !guessed.has(l));
  if (Math.random() < RANDOMNESS_BY_DIFFICULTY[difficulty]) {
    return remaining[Math.floor(Math.random() * remaining.length)];
  }
  const byFrequency = FREQUENCY_ORDER.filter((l) => remaining.includes(l));
  return byFrequency[0] ?? remaining[0];
}

type Phase = "spin" | "guess" | "roundEnd" | "done";
type PlayerSlot = "p1" | "p2";

// A "match" is ROUNDS_PER_MATCH puzzles back to back with a running score,
// closer to how the real show plays across an episode, instead of one
// puzzle and done.
const ROUNDS_PER_MATCH = 3;

export default function WheelOfFortune({ kidId, tier }: { kidId: string; tier: Tier }) {
  const [vsComputer, setVsComputer] = useState(true);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [player2, setPlayer2] = useState<string | "skip" | null>(null);

  const [puzzle, setPuzzle] = useState<WheelPuzzle>(() => pickPuzzle(tier));
  const [round, setRound] = useState(1);
  const [guessed, setGuessed] = useState<Set<string>>(new Set());
  const [scoreP1, setScoreP1] = useState(0);
  const [scoreP2, setScoreP2] = useState(0);
  const [currentPlayer, setCurrentPlayer] = useState<PlayerSlot>("p1");
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [activeValue, setActiveValue] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("spin");
  const startedAt = useRef(new Date());
  const recorded = useRef(false);

  const uniqueLetters = useMemo(
    () => new Set(puzzle.phrase.split("").filter((c) => c >= "A" && c <= "Z")),
    [puzzle],
  );

  function finish() {
    if (recorded.current) return;
    recorded.current = true;
    const skillTag = vsComputer ? `wheel-of-fortune-${difficulty}` : "wheel-of-fortune-2p";
    recordGameSession({
      kidId,
      gameType: "wheel-of-fortune",
      subject: "reading",
      skillTag,
      startedAt: startedAt.current,
      score: scoreP1,
    });
    if (!vsComputer && player2 && player2 !== "skip") {
      recordGameSession({
        kidId: player2,
        gameType: "wheel-of-fortune",
        subject: "reading",
        skillTag,
        startedAt: startedAt.current,
        score: scoreP2,
      });
    }
    setPhase("done");
  }

  function spin() {
    if (spinning || phase !== "spin") return;
    const idx = Math.floor(Math.random() * WHEEL_WEDGES.length);
    const targetSliceCenter = idx * SLICE_ANGLE + SLICE_ANGLE / 2;
    setRotation((prev) => {
      const prevMod = ((prev % 360) + 360) % 360;
      const desiredMod = (360 - targetSliceCenter) % 360;
      let delta = desiredMod - prevMod;
      if (delta <= 0) delta += 360;
      return prev + delta + 4 * 360;
    });
    setSpinning(true);
    window.setTimeout(() => {
      setSpinning(false);
      setActiveValue(WHEEL_WEDGES[idx].points);
      setPhase("guess");
    }, 3000);
  }

  function guessLetter(letter: string) {
    if (phase !== "guess" || guessed.has(letter) || activeValue === null) return;
    const nextGuessed = new Set(guessed);
    nextGuessed.add(letter);
    setGuessed(nextGuessed);

    const addScore = currentPlayer === "p1" ? setScoreP1 : setScoreP2;

    if (uniqueLetters.has(letter)) {
      const occurrences = puzzle.phrase.split("").filter((c) => c === letter).length;
      const earned = activeValue * occurrences;
      addScore((s) => s + earned);
      playCorrect();
      const allFound = [...uniqueLetters].every((l) => nextGuessed.has(l));
      setActiveValue(null);
      if (allFound) {
        if (round >= ROUNDS_PER_MATCH) {
          finish();
        } else {
          setPhase("roundEnd");
        }
        return;
      }
      setPhase("spin");
      // Correct guess keeps the same player's turn — they keep spinning.
    } else {
      playHurt();
      setActiveValue(null);
      setPhase("spin");
      setCurrentPlayer((p) => (p === "p1" ? "p2" : "p1"));
    }
  }

  // Computer's turn plays itself: spin automatically, then pick a letter,
  // each after a short pause so it reads as a "turn" rather than an instant
  // jump. Both effects re-check phase/currentPlayer so they naturally stop
  // once it's the human's turn again or the puzzle is solved.
  useEffect(() => {
    if (!vsComputer || currentPlayer !== "p2" || phase !== "spin" || spinning) return;
    const t = window.setTimeout(spin, 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vsComputer, currentPlayer, phase, spinning]);

  useEffect(() => {
    if (!vsComputer || currentPlayer !== "p2" || phase !== "guess" || !difficulty) return;
    const t = window.setTimeout(() => {
      guessLetter(computerPickLetter(guessed, difficulty));
    }, 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vsComputer, currentPlayer, phase, difficulty, guessed]);

  function nextRound() {
    const nextRoundNum = round + 1;
    setRound(nextRoundNum);
    setPuzzle(pickPuzzle(tier, puzzle.phrase));
    setGuessed(new Set());
    setActiveValue(null);
    // Whoever didn't open the previous round gets to spin first this
    // time, so one player can't end up controlling the whole match just
    // by winning the coin-flip-equivalent of round 1.
    setCurrentPlayer(nextRoundNum % 2 === 1 ? "p1" : "p2");
    setPhase("spin");
  }

  function playAgain() {
    setRound(1);
    setPuzzle(pickPuzzle(tier, puzzle.phrase));
    setGuessed(new Set());
    setScoreP1(0);
    setScoreP2(0);
    setCurrentPlayer("p1");
    setActiveValue(null);
    setPhase("spin");
    startedAt.current = new Date();
    recorded.current = false;
  }

  if (vsComputer && !difficulty) {
    return (
      <DifficultyGate
        title="Choose a difficulty"
        description="How sharp should the computer's letter guesses be?"
        onSelect={setDifficulty}
      />
    );
  }

  if (!vsComputer && player2 === null) {
    return (
      <PlayerTwoGate
        excludeKidId={kidId}
        onSelect={setPlayer2}
        onSkip={() => setPlayer2("skip")}
      />
    );
  }

  const words = puzzle.phrase.split(" ");
  const finished = phase === "done";
  const roundOver = phase === "roundEnd";
  const inactive = finished || roundOver;
  const computersTurn = vsComputer && currentPlayer === "p2";
  const canAct = !inactive && !computersTurn;
  const winner = finished ? (scoreP1 === scoreP2 ? "tie" : scoreP1 > scoreP2 ? "p1" : "p2") : null;

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex flex-wrap items-center justify-center gap-4">
        <label className="flex items-center gap-1 text-sm font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={vsComputer}
            onChange={(e) => {
              setVsComputer(e.target.checked);
              setDifficulty(null);
              setPlayer2(null);
              playAgain();
            }}
          />
          Play vs computer
        </label>
        <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-600 shadow">
          {puzzle.category}
        </span>
        <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-600 shadow">
          Round {Math.min(round, ROUNDS_PER_MATCH)} of {ROUNDS_PER_MATCH}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 text-sm font-semibold">
        <span className={currentPlayer === "p1" && !inactive ? "text-sky-600" : "text-slate-500"}>
          🧑 You: {scoreP1}
        </span>
        <span className={currentPlayer === "p2" && !inactive ? "text-sky-600" : "text-slate-500"}>
          {vsComputer ? "🤖 Computer" : "🧑 Player 2"}: {scoreP2}
        </span>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        {words.map((word, wi) => (
          <div key={wi} className="flex gap-1">
            {word.split("").map((letter, li) => (
              <div
                key={li}
                className="flex h-10 w-8 items-center justify-center rounded-lg border-2 border-slate-300 bg-white text-xl font-bold text-slate-800 shadow-sm sm:h-12 sm:w-10 sm:text-2xl"
              >
                {guessed.has(letter) || inactive ? letter : ""}
              </div>
            ))}
          </div>
        ))}
      </div>

      {roundOver && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-lg font-bold text-slate-800">Round {round} solved! 🎉</p>
          <button
            onClick={nextRound}
            className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-700"
          >
            ▶️ Next Round
          </button>
        </div>
      )}

      {finished ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xl font-bold text-slate-800">
            Final Score — {winner === "tie"
              ? `It's a tie! ${scoreP1} - ${scoreP2}`
              : winner === "p1"
                ? `You win! 🎉 ${scoreP1} - ${scoreP2}`
                : `${vsComputer ? "Computer" : "Player 2"} wins. ${scoreP2} - ${scoreP1}`}
          </p>
          <button
            onClick={playAgain}
            className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-700"
          >
            Play again
          </button>
        </div>
      ) : roundOver ? null : (
        <>
          <div className="relative flex flex-col items-center">
            <div className="mb-1 h-0 w-0 border-x-8 border-t-[14px] border-x-transparent border-t-slate-800" />
            <div
              className="h-56 w-56 rounded-full border-4 border-white shadow-lg sm:h-64 sm:w-64"
              style={{
                background: wheelBackground(),
                transform: `rotate(${rotation}deg)`,
                transition: spinning ? "transform 3s cubic-bezier(0.17, 0.67, 0.16, 0.99)" : undefined,
              }}
            >
              {WHEEL_WEDGES.map((w, i) => (
                <div
                  key={i}
                  className="absolute inset-0"
                  style={{ transform: `rotate(${i * SLICE_ANGLE + SLICE_ANGLE / 2}deg)` }}
                >
                  <span className="absolute left-1/2 top-3 -translate-x-1/2 text-xs font-bold text-white drop-shadow sm:top-4 sm:text-sm">
                    {w.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {computersTurn ? (
            <p className="text-sm font-semibold text-slate-600">🤖 Computer is playing…</p>
          ) : phase === "spin" ? (
            <button
              onClick={spin}
              disabled={spinning || !canAct}
              className="rounded-full bg-emerald-600 px-6 py-3 text-lg font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
            >
              {spinning ? "Spinning…" : "🎡 Spin the Wheel"}
            </button>
          ) : (
            <p className="text-sm font-semibold text-slate-600">
              Landed on {activeValue} — pick a letter!
            </p>
          )}

          <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-9">
            {LETTERS.map((letter) => {
              const isGuessed = guessed.has(letter);
              const isHit = isGuessed && uniqueLetters.has(letter);
              const isMiss = isGuessed && !uniqueLetters.has(letter);
              return (
                <button
                  key={letter}
                  onClick={() => guessLetter(letter)}
                  disabled={phase !== "guess" || isGuessed || !canAct}
                  className={`h-9 w-9 rounded-lg text-sm font-bold shadow disabled:opacity-50 sm:h-10 sm:w-10 ${
                    isHit
                      ? "bg-emerald-500 text-white"
                      : isMiss
                        ? "bg-slate-300 text-slate-500"
                        : "bg-white text-slate-800 hover:bg-sky-50"
                  }`}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
