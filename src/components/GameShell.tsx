"use client";

import Link from "next/link";
import type { Tier } from "@/lib/grade-tiers";
import type { GradeLevel } from "@prisma/client";
import type { GameSlug } from "@/lib/games-catalog";
import TicTacToe from "./games/TicTacToe";
import MemoryMatch from "./games/MemoryMatch";
import Snake from "./games/Snake";
import Tetris from "./games/Tetris";
import Checkers from "./games/Checkers";
import MathFacts from "./games/MathFacts";
import Reading from "./games/Reading";
import ConnectFour from "./games/ConnectFour";
import SimonSays from "./games/SimonSays";
import NumberMatching from "./games/NumberMatching";
import Phonics from "./games/Phonics";
import SpellingBee from "./games/SpellingBee";
import ChessGame from "./games/Chess";
import BananaBlast from "./games/BananaBlast";
import WordBlaster from "./games/WordBlaster";
import StarHopper from "./games/StarHopper";
import RaceTrack from "./games/RaceTrack";
import Farm from "./games/Farm";

export default function GameShell({
  kidId,
  slug,
  gameName,
  mathTier,
  mathGrade,
  readingGrade,
}: {
  kidId: string;
  slug: GameSlug;
  gameName: string;
  mathTier: Tier;
  mathGrade: GradeLevel;
  readingGrade: GradeLevel;
}) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 to-emerald-50 px-4 py-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-800">{gameName}</h1>
          <Link
            href={`/play/${kidId}`}
            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            ← Back to games
          </Link>
        </div>

        <div className="flex justify-center">
          {slug === "tic-tac-toe" && <TicTacToe kidId={kidId} />}
          {slug === "memory-match" && <MemoryMatch kidId={kidId} tier={mathTier} />}
          {slug === "snake" && <Snake kidId={kidId} />}
          {slug === "tetris" && <Tetris kidId={kidId} />}
          {slug === "checkers" && <Checkers kidId={kidId} />}
          {slug === "math-facts" && <MathFacts kidId={kidId} grade={mathGrade} />}
          {slug === "reading" && <Reading kidId={kidId} grade={readingGrade} />}
          {slug === "connect-four" && <ConnectFour kidId={kidId} />}
          {slug === "simon-says" && <SimonSays kidId={kidId} />}
          {slug === "number-matching" && <NumberMatching kidId={kidId} grade={mathGrade} />}
          {slug === "phonics" && <Phonics kidId={kidId} />}
          {slug === "spelling-bee" && <SpellingBee kidId={kidId} grade={readingGrade} />}
          {slug === "chess" && <ChessGame kidId={kidId} />}
          {slug === "banana-blast" && <BananaBlast kidId={kidId} grade={mathGrade} />}
          {slug === "word-blaster" && <WordBlaster kidId={kidId} grade={readingGrade} />}
          {slug === "star-hopper" && <StarHopper kidId={kidId} />}
          {slug === "race-track" && <RaceTrack kidId={kidId} />}
          {slug === "farm" && <Farm kidId={kidId} />}
        </div>
      </div>
    </main>
  );
}
