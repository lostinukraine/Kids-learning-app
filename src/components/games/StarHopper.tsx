"use client";

import { useEffect, useRef, useState } from "react";
import { recordGameSession } from "@/lib/record-session";
import { playCorrect, playExplosion, playHurt, playGameOver } from "@/lib/arcade-sound";
import { STAR_HOPPER_SPRITES, STAR_EMOJI } from "@/lib/star-hopper-sprites";
import {
  generateLevel,
  LEVELS_PER_DIFFICULTY,
  isClimbLevel,
  WIDTH,
  HEIGHT,
  GROUND_Y,
  GRAVITY,
  MOVE_SPEED,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  PLAYER_W,
  PLAYER_H,
  type Level,
  type EnemyKind,
} from "@/lib/star-hopper-levels";
import DifficultyGate from "@/components/DifficultyGate";
import { DIFFICULTY_LEVELS, type Difficulty } from "@/lib/difficulty";

function nowMs(): number {
  return performance.now();
}

const ENEMY_SPRITE_KEY: Record<EnemyKind, string> = {
  crawler: "crawlerYellow",
  walker: "walkerSpike",
  flyer: "enemy",
  floater: "floaterUfo",
};

const EMPTY_LEVEL: Level = {
  orientation: "horizontal",
  spawnX: 40,
  spawnY: GROUND_Y - PLAYER_H,
  goalX: WIDTH,
  goalY: 0,
  deathY: HEIGHT + 100,
  cameraMinX: 0,
  cameraMaxX: 0,
  cameraMinY: 0,
  cameraMaxY: 0,
  ground: [],
  platforms: [],
  enemies: [],
  pickups: [],
  lives: 0,
};

interface DifficultyProgress {
  unlockedLevel: number;
  bestScore: number;
}

type ProgressMap = Record<Difficulty, DifficultyProgress>;

const DEFAULT_PROGRESS: ProgressMap = {
  easy: { unlockedLevel: 1, bestScore: 0 },
  medium: { unlockedLevel: 1, bestScore: 0 },
  hard: { unlockedLevel: 1, bestScore: 0 },
  expert: { unlockedLevel: 1, bestScore: 0 },
};

type Screen = "difficulty" | "levels" | "play";

export default function StarHopper({ kidId }: { kidId: string }) {
  const [screen, setScreen] = useState<Screen>("difficulty");
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [levelNumber, setLevelNumber] = useState(1);
  const [progress, setProgress] = useState<ProgressMap>(DEFAULT_PROGRESS);
  const [progressLoaded, setProgressLoaded] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const playerRef = useRef({ x: 0, y: 0, vx: 0, vy: 0, onGround: false, facing: 1 as 1 | -1 });
  const levelRef = useRef<Level>(EMPTY_LEVEL);
  const invulnRef = useRef(0);
  const spritesRef = useRef<Record<string, HTMLImageElement>>({});

  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(0);
  const [won, setWon] = useState(false);
  const startedAt = useRef(new Date());
  const recorded = useRef(false);
  const scoreRef = useRef(0);
  const livesRef = useRef(0);

  const gameOver = lives <= 0;
  const finished = gameOver || won;

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    livesRef.current = lives;
  }, [lives]);

  useEffect(() => {
    spritesRef.current = loadSprites();
  }, []);

  useEffect(() => {
    fetch(`/api/star-hopper/progress?kidId=${kidId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.progress)) {
          setProgress((p) => {
            const next = { ...p };
            for (const row of data.progress) {
              next[row.difficulty as Difficulty] = { unlockedLevel: row.unlockedLevel, bestScore: row.bestScore };
            }
            return next;
          });
        }
      })
      .catch(() => {})
      .finally(() => setProgressLoaded(true));
  }, [kidId]);

  function chooseDifficulty(chosen: Difficulty) {
    setDifficulty(chosen);
    setScreen("levels");
  }

  function startLevel(chosen: Difficulty, level: number) {
    const generated = generateLevel(chosen, level);
    levelRef.current = generated;
    playerRef.current = { x: generated.spawnX, y: generated.spawnY, vx: 0, vy: 0, onGround: false, facing: 1 };
    invulnRef.current = 0;
    setScore(0);
    setLives(generated.lives);
    setWon(false);
    setDifficulty(chosen);
    setLevelNumber(level);
    startedAt.current = new Date();
    recorded.current = false;
    setScreen("play");
  }

  // Called directly from the physics loop (or loseLife below) the moment a
  // level actually ends, rather than reactively from an effect watching
  // `finished` — an effect body can't call setState synchronously without
  // triggering a cascading-render lint error, but a plain function invoked
  // from a requestAnimationFrame callback can.
  function finishLevel(didWin: boolean) {
    if (recorded.current || !difficulty) return;
    recorded.current = true;
    setWon(didWin);
    (didWin ? playCorrect : playGameOver)();
    const finalScore = scoreRef.current;
    recordGameSession({
      kidId,
      gameType: "star-hopper",
      subject: "classic",
      skillTag: `star-hopper-${difficulty}-l${levelNumber}`,
      startedAt: startedAt.current,
      score: finalScore,
    });
    if (didWin) {
      fetch("/api/star-hopper/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kidId, difficulty, level: levelNumber, score: finalScore }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.progress) {
            setProgress((p) => ({
              ...p,
              [difficulty]: { unlockedLevel: data.progress.unlockedLevel, bestScore: data.progress.bestScore },
            }));
          }
        })
        .catch(() => {});
      setProgress((p) => ({
        ...p,
        [difficulty]: {
          unlockedLevel: Math.max(p[difficulty].unlockedLevel, Math.min(levelNumber + 1, LEVELS_PER_DIFFICULTY + 1)),
          bestScore: Math.max(p[difficulty].bestScore, finalScore),
        },
      }));
    }
  }

  function respawn() {
    const level = levelRef.current;
    playerRef.current = { x: level.spawnX, y: level.spawnY, vx: 0, vy: 0, onGround: false, facing: 1 };
    invulnRef.current = 1.2;
  }

  function loseLife() {
    if (invulnRef.current > 0) return;
    playHurt();
    const next = Math.max(livesRef.current - 1, 0);
    setLives(next);
    if (next === 0) finishLevel(false);
    respawn();
  }

  function jump() {
    if (playerRef.current.onGround) {
      playerRef.current.vy = JUMP_VELOCITY;
      playerRef.current.onGround = false;
    }
  }

  function pressKey(key: string) {
    keysRef.current.add(key);
  }
  function releaseKey(key: string) {
    keysRef.current.delete(key);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", " "].includes(e.key)) e.preventDefault();
      keysRef.current.add(e.key);
      if (e.key === "ArrowUp" || e.key === " ") jump();
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
  }, []);

  useEffect(() => {
    if (screen !== "play") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let lastTime = nowMs();
    let rafId: number;

    const frame = (frameNow: number) => {
      const dt = Math.min((frameNow - lastTime) / 1000, 0.05);
      lastTime = frameNow;
      const level = levelRef.current;

      if (!finished) {
        const player = playerRef.current;
        if (invulnRef.current > 0) invulnRef.current = Math.max(0, invulnRef.current - dt);

        if (keysRef.current.has("ArrowLeft")) {
          player.vx = -MOVE_SPEED;
          player.facing = -1;
        } else if (keysRef.current.has("ArrowRight")) {
          player.vx = MOVE_SPEED;
          player.facing = 1;
        } else {
          player.vx = 0;
        }

        player.vy = Math.min(player.vy + GRAVITY * dt, MAX_FALL_SPEED);

        const prevBottom = player.y + PLAYER_H;
        const playerMaxX = level.cameraMaxX + WIDTH - PLAYER_W;
        player.x = Math.max(0, Math.min(playerMaxX, player.x + player.vx * dt));
        player.y += player.vy * dt;

        player.onGround = false;
        if (player.vy >= 0) {
          for (const solid of [...level.ground, ...level.platforms]) {
            const withinX = player.x + PLAYER_W > solid.x && player.x < solid.x + solid.w;
            const crossedTop = prevBottom <= solid.y && player.y + PLAYER_H >= solid.y;
            if (withinX && crossedTop) {
              player.y = solid.y - PLAYER_H;
              player.vy = 0;
              player.onGround = true;
            }
          }
        }

        if (player.y > level.deathY) {
          loseLife();
        }

        for (const enemy of level.enemies) {
          if (!enemy.alive) continue;
          if (enemy.kind === "flyer") {
            enemy.y += enemy.speed * enemy.dir * dt;
            if (enemy.y < enemy.minY || enemy.y + enemy.h > enemy.maxY) {
              enemy.dir = enemy.dir === 1 ? -1 : 1;
              enemy.y = Math.max(enemy.minY, Math.min(enemy.maxY - enemy.h, enemy.y));
            }
          } else {
            enemy.x += enemy.speed * enemy.dir * dt;
            if (enemy.x < enemy.minX || enemy.x + enemy.w > enemy.maxX) {
              enemy.dir = enemy.dir === 1 ? -1 : 1;
              enemy.x = Math.max(enemy.minX, Math.min(enemy.maxX - enemy.w, enemy.x));
            }
          }

          const overlap =
            player.x < enemy.x + enemy.w &&
            player.x + PLAYER_W > enemy.x &&
            player.y < enemy.y + enemy.h &&
            player.y + PLAYER_H > enemy.y;

          if (overlap && invulnRef.current <= 0) {
            const stomped = player.vy > 0 && prevBottom <= enemy.y + enemy.h * 0.5;
            if (stomped) {
              enemy.alive = false;
              player.vy = JUMP_VELOCITY * 0.55;
              playExplosion();
              setScore((s) => s + 50);
            } else {
              loseLife();
            }
          }
        }

        for (const pickup of level.pickups) {
          if (pickup.collected) continue;
          const dx = player.x + PLAYER_W / 2 - pickup.x;
          const dy = player.y + PLAYER_H / 2 - pickup.y;
          if (Math.hypot(dx, dy) < pickup.r + 16) {
            pickup.collected = true;
            playCorrect();
            setScore((s) => s + (pickup.kind === "star" ? 30 : 10));
          }
        }

        const reachedGoal =
          level.orientation === "horizontal"
            ? player.x + PLAYER_W >= level.goalX
            : player.y + PLAYER_H <= level.goalY + 4;
        if (reachedGoal) {
          finishLevel(true);
        }
      }

      const player = playerRef.current;
      const cameraX = Math.max(level.cameraMinX, Math.min(player.x - WIDTH / 2, level.cameraMaxX));
      const cameraY = Math.max(level.cameraMinY, Math.min(player.y - HEIGHT / 2, level.cameraMaxY));
      const sprites = spritesRef.current;

      ctx.fillStyle = level.orientation === "vertical" ? "#93c5fd" : "#bae6fd";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      for (const g of level.ground) {
        drawTiledSolid(ctx, sprites, g, cameraX, cameraY);
      }
      for (const p of level.platforms) {
        drawTiledSolid(ctx, sprites, p, cameraX, cameraY);
      }

      for (const pickup of level.pickups) {
        if (pickup.collected) continue;
        if (pickup.kind === "star") {
          ctx.font = `${pickup.r * 2.4}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(STAR_EMOJI, pickup.x - cameraX, pickup.y - cameraY);
        } else if (sprites.gem?.complete) {
          ctx.drawImage(sprites.gem, pickup.x - cameraX - pickup.r, pickup.y - cameraY - pickup.r, pickup.r * 2, pickup.r * 2);
        }
      }

      for (const enemy of level.enemies) {
        if (!enemy.alive) continue;
        const sprite = sprites[ENEMY_SPRITE_KEY[enemy.kind]];
        if (sprite?.complete) {
          ctx.drawImage(sprite, enemy.x - cameraX, enemy.y - cameraY, enemy.w, enemy.h);
        }
      }

      const flagX = level.orientation === "horizontal" ? level.goalX : level.goalX - 18;
      const flagY = level.orientation === "horizontal" ? GROUND_Y - 90 : level.goalY - 90;
      if (sprites.flag?.complete) {
        ctx.drawImage(sprites.flag, flagX - cameraX, flagY - cameraY, 36, 90);
      }

      if (invulnRef.current <= 0 || Math.floor(invulnRef.current * 10) % 2 === 0) {
        if (sprites.player?.complete) {
          ctx.save();
          if (player.facing === -1) {
            ctx.translate(player.x - cameraX + PLAYER_W, player.y - cameraY);
            ctx.scale(-1, 1);
            ctx.drawImage(sprites.player, 0, 0, PLAYER_W, PLAYER_H);
          } else {
            ctx.drawImage(sprites.player, player.x - cameraX, player.y - cameraY, PLAYER_W, PLAYER_H);
          }
          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, finished]);

  function retryLevel() {
    if (difficulty) startLevel(difficulty, levelNumber);
  }

  function nextLevel() {
    if (difficulty) startLevel(difficulty, levelNumber + 1);
  }

  if (screen === "difficulty" || !difficulty) {
    return (
      <DifficultyGate
        title="Choose a difficulty"
        description="Each difficulty has 12 levels — longer runs, tighter jumps, and more (faster) space creatures as you go. Every 4th level is a tower to climb instead of a run to the flag."
        onSelect={chooseDifficulty}
      />
    );
  }

  if (screen === "levels") {
    const diffProgress = progress[difficulty];
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-lg font-bold text-slate-800">
          {DIFFICULTY_LEVELS.find((d) => d.value === difficulty)?.emoji} {DIFFICULTY_LEVELS.find((d) => d.value === difficulty)?.label} — pick a level
        </p>
        {!progressLoaded && <p className="text-sm text-slate-400">Loading levels…</p>}
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: LEVELS_PER_DIFFICULTY }, (_, i) => i + 1).map((n) => {
            const locked = n > diffProgress.unlockedLevel;
            const climb = isClimbLevel(n);
            return (
              <button
                key={n}
                onClick={() => !locked && startLevel(difficulty, n)}
                disabled={locked}
                className={`flex h-16 w-16 flex-col items-center justify-center rounded-xl text-lg font-bold shadow ${
                  locked ? "bg-slate-100 text-slate-300" : "bg-white text-slate-900 hover:bg-sky-50"
                }`}
              >
                {locked ? "🔒" : n}
                {!locked && climb && <span className="text-[10px] font-semibold text-sky-500">CLIMB</span>}
              </button>
            );
          })}
        </div>
        {diffProgress.bestScore > 0 && (
          <p className="text-sm text-slate-500">Best score: {diffProgress.bestScore}</p>
        )}
        <button onClick={() => setScreen("difficulty")} className="text-sm text-slate-500 underline">
          Change difficulty
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-6 text-sm font-semibold text-slate-600">
        <span>
          Level {levelNumber} / {LEVELS_PER_DIFFICULTY}
          {isClimbLevel(levelNumber) ? " 🧗 Climb!" : ""}
        </span>
        <span>Score: {score}</span>
        <span className="flex items-center gap-1">
          Lives:
          {Array.from({ length: lives }).map((_, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- shared component also runs under Vite (the demo), which next/image can't target
            <img key={i} src={STAR_HOPPER_SPRITES.heart} alt="" className="h-4 w-4" style={{ imageRendering: "pixelated" }} />
          ))}
          {lives === 0 && "—"}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="max-w-full touch-none rounded-xl shadow-lg"
      />

      <div className="flex w-full max-w-[480px] items-center justify-between">
        <div className="flex gap-2">
          <TouchBtn
            label="⬅"
            onDown={() => pressKey("ArrowLeft")}
            onUp={() => releaseKey("ArrowLeft")}
          />
          <TouchBtn
            label="➡"
            onDown={() => pressKey("ArrowRight")}
            onUp={() => releaseKey("ArrowRight")}
          />
        </div>
        <TouchBtn label="⬆ Jump" onDown={jump} onUp={() => {}} wide />
      </div>
      <p className="text-xs text-slate-400">
        Arrow keys to move, Up/Space to jump — or use the buttons above
      </p>

      {finished && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xl font-bold text-slate-800">
            {won ? `Level complete! Score: ${score} 🎉` : `Game over! Score: ${score}`}
          </p>
          <div className="flex gap-3">
            {won && levelNumber < LEVELS_PER_DIFFICULTY && (
              <button
                onClick={nextLevel}
                className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-700"
              >
                Next Level →
              </button>
            )}
            {won && levelNumber === LEVELS_PER_DIFFICULTY && (
              <p className="font-semibold text-emerald-600">You beat every level! 🏆</p>
            )}
            <button
              onClick={retryLevel}
              className="rounded-lg bg-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-300"
            >
              {won ? "Replay" : "Try Again"}
            </button>
            <button
              onClick={() => setScreen("levels")}
              className="rounded-lg bg-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-300"
            >
              Level Select
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function loadSprites(): Record<string, HTMLImageElement> {
  const images: Record<string, HTMLImageElement> = {};
  for (const [name, src] of Object.entries(STAR_HOPPER_SPRITES)) {
    const img = new Image();
    img.src = src;
    images[name] = img;
  }
  return images;
}

function drawTiledSolid(
  ctx: CanvasRenderingContext2D,
  sprites: Record<string, HTMLImageElement>,
  solid: { x: number; y: number; w: number; h: number },
  cameraX: number,
  cameraY: number,
) {
  const tile = sprites.groundMid;
  if (!tile?.complete) return;
  const tileSize = 18;
  const drawY = solid.y - cameraY;
  for (let x = solid.x; x < solid.x + solid.w; x += tileSize) {
    const drawW = Math.min(tileSize, solid.x + solid.w - x);
    ctx.drawImage(tile, 0, 0, drawW, tileSize, x - cameraX, drawY, drawW, tileSize);
  }
  // fill any remaining vertical space below the top tile row with a solid
  // color so pits read clearly against the sky.
  if (solid.h > tileSize) {
    ctx.fillStyle = "#78350f";
    ctx.fillRect(solid.x - cameraX, drawY + tileSize, solid.w, solid.h - tileSize);
  }
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
      className={`touch-none select-none ${wide ? "h-14 px-8 text-base" : "h-14 w-14 text-2xl"} rounded-2xl bg-white font-bold text-slate-900 shadow active:bg-sky-50`}
    >
      {label}
    </button>
  );
}
