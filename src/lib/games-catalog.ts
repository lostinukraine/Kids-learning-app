import type { GradeLevel } from "@prisma/client";
import { gradeIndex } from "@/lib/grade-tiers";

export type GameSlug =
  | "tetris"
  | "snake"
  | "checkers"
  | "tic-tac-toe"
  | "memory-match"
  | "math-facts"
  | "reading"
  | "connect-four"
  | "simon-says"
  | "number-matching"
  | "phonics"
  | "spelling-bee"
  | "chess"
  | "banana-blast"
  | "word-blaster"
  | "star-hopper"
  | "race-track"
  | "farm";

export interface GameCatalogEntry {
  slug: GameSlug;
  name: string;
  emoji: string;
  subject: "classic" | "math" | "reading";
  description: string;
  // Inclusive grade range this game is shown for. Omitted bounds mean "no
  // limit that direction." Most games already scale their own content/
  // difficulty by grade (math-facts, banana-blast, reading, spelling-bee,
  // word-blaster, memory-match) so they're left unbounded here — this is
  // only for games whose content doesn't scale and becomes either
  // developmentally inaccessible (chess's ruleset) or a trivial mismatch
  // for the grade (number-matching/phonics stay pure early-counting/
  // beginning-sounds content no matter how old the kid is).
  minGrade?: GradeLevel;
  maxGrade?: GradeLevel;
}

export const GAMES_CATALOG: GameCatalogEntry[] = [
  { slug: "tetris", name: "Tetris", emoji: "🧱", subject: "classic", description: "Stack the falling blocks." },
  { slug: "snake", name: "Snake", emoji: "🐍", subject: "classic", description: "Eat and grow, don't hit the walls." },
  { slug: "checkers", name: "Checkers", emoji: "🔴", subject: "classic", description: "Jump your way to victory.", minGrade: "FIRST" },
  { slug: "tic-tac-toe", name: "Tic-Tac-Toe", emoji: "❌", subject: "classic", description: "Three in a row wins." },
  { slug: "memory-match", name: "Memory Match", emoji: "🃏", subject: "classic", description: "Find the matching pairs." },
  { slug: "math-facts", name: "Math Facts", emoji: "➕", subject: "math", description: "Quick addition & subtraction drills." },
  { slug: "reading", name: "Reading", emoji: "📖", subject: "reading", description: "Words and stories." },
  { slug: "connect-four", name: "Connect Four", emoji: "🟡", subject: "classic", description: "Four in a row wins." },
  { slug: "simon-says", name: "Simon Says", emoji: "🎵", subject: "classic", description: "Watch, then repeat the pattern." },
  { slug: "number-matching", name: "Number Match", emoji: "🔢", subject: "math", description: "Count and pick the right number.", maxGrade: "FIRST" },
  { slug: "phonics", name: "Phonics", emoji: "🔤", subject: "reading", description: "What letter does it start with?", maxGrade: "FIRST" },
  { slug: "spelling-bee", name: "Spelling Bee", emoji: "🐝", subject: "reading", description: "Build the word, letter by letter." },
  { slug: "chess", name: "Chess", emoji: "♟️", subject: "classic", description: "Checkmate the king.", minGrade: "THIRD" },
  { slug: "banana-blast", name: "Banana Blast", emoji: "🐒", subject: "math", description: "Toss the answer to the right monkey." },
  { slug: "word-blaster", name: "Word Blaster", emoji: "💥", subject: "reading", description: "Blast the letters to spell the word." },
  { slug: "star-hopper", name: "Star Hopper", emoji: "🧑‍🚀", subject: "classic", description: "Run, jump, and stomp your way to the flag." },
  { slug: "race-track", name: "Race Track", emoji: "🏎️", subject: "classic", description: "Race, earn coins, and upgrade your car." },
  { slug: "farm", name: "Farm", emoji: "🚜", subject: "classic", description: "Plant, grow, harvest, and sell — build up your farm." },
];

export function getGame(slug: string): GameCatalogEntry | undefined {
  return GAMES_CATALOG.find((g) => g.slug === slug);
}

// The grade to check a game's minGrade/maxGrade against: math games use the
// kid's math grade, reading games use their reading grade, and "classic"
// games (no dedicated grade of their own) use whichever of the two is
// further along — a kid working ahead in either subject is treated as ready
// for the game's general complexity rather than held back by the other.
export function relevantGradeForGame(
  game: GameCatalogEntry,
  mathGrade: GradeLevel,
  readingGrade: GradeLevel,
): GradeLevel {
  if (game.subject === "math") return mathGrade;
  if (game.subject === "reading") return readingGrade;
  return gradeIndex(mathGrade) >= gradeIndex(readingGrade) ? mathGrade : readingGrade;
}

export function isGameAvailable(game: GameCatalogEntry, mathGrade: GradeLevel, readingGrade: GradeLevel): boolean {
  const grade = relevantGradeForGame(game, mathGrade, readingGrade);
  const idx = gradeIndex(grade);
  if (game.minGrade && idx < gradeIndex(game.minGrade)) return false;
  if (game.maxGrade && idx > gradeIndex(game.maxGrade)) return false;
  return true;
}
