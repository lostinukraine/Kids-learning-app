import type { Difficulty } from "@/lib/difficulty";

// ---- Shared world/physics constants (single source of truth for both the
// level generator and the StarHopper component's physics loop) ----
export const WIDTH = 480;
export const HEIGHT = 320;
export const GROUND_Y = 280;
export const GRAVITY = 1400;
export const MOVE_SPEED = 190;
export const JUMP_VELOCITY = -540;
export const MAX_FALL_SPEED = 700;
export const PLAYER_W = 26;
export const PLAYER_H = 34;
export const START_X = 40;
export const START_Y = GROUND_Y - PLAYER_H;

// A gap narrower than the player's own hitbox can never actually be fallen
// into — the player's AABB keeps overlapping solid ground on one side or
// the other the whole way across, so it silently reads as solid floor
// instead of a hole. Difficulty-intensity scaling on early levels (e.g.
// easy level 1) could push the randomized/first gap width below this, so
// every generated gap is floored here regardless of difficulty.
const MIN_GAP_WIDTH = PLAYER_W + 14;

// Max horizontal distance/height coverable by a single jump held at full run
// speed the whole time — every generated gap/platform/climb step is kept
// comfortably under these so every level is guaranteed completable.
export const MAX_JUMP_DISTANCE = MOVE_SPEED * ((2 * Math.abs(JUMP_VELOCITY)) / GRAVITY);
export const MAX_JUMP_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);

export const LEVELS_PER_DIFFICULTY = 12;
// Every 4th level is a vertical climb instead of a horizontal run.
export function isClimbLevel(levelNumber: number): boolean {
  return levelNumber % 4 === 0;
}

export type Orientation = "horizontal" | "vertical";
export type EnemyKind = "crawler" | "walker" | "flyer" | "floater";

export interface Solid {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  w: number;
  h: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  speed: number;
  dir: 1 | -1;
  alive: boolean;
}

export interface Pickup {
  x: number;
  y: number;
  r: number;
  collected: boolean;
  kind: "gem" | "star";
}

export interface Level {
  orientation: Orientation;
  spawnX: number;
  spawnY: number;
  goalX: number;
  goalY: number;
  deathY: number;
  // Explicit camera-scroll bounds rather than an assumed [0, worldWidth]/
  // [0, worldHeight] range — climb levels have platforms at negative y as
  // the tower goes up, so the camera's vertical range doesn't start at 0.
  cameraMinX: number;
  cameraMaxX: number;
  cameraMinY: number;
  cameraMaxY: number;
  ground: Solid[];
  platforms: Solid[];
  enemies: Enemy[];
  pickups: Pickup[];
  lives: number;
}

// A small deterministic PRNG (mulberry32) seeded from the difficulty+level
// number, so a given level always generates the same layout — kids can
// retry/practice a specific level rather than getting a fresh random one
// every attempt.
function seedFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface LevelParams {
  segments: number;
  segMin: number;
  segMax: number;
  gapMin: number;
  gapMax: number;
  platformChance: number;
  platformWidthMin: number;
  platformWidthMax: number;
  platformHeightMin: number;
  platformHeightMax: number;
  enemySpeedMin: number;
  enemySpeedMax: number;
  enemyPatrolFrac: number;
  coinsPerSegment: number;
  lives: number;
}

// The hardest state (last level) for each difficulty — level 1 of that
// difficulty scales these down, ramping up to exactly these values by the
// final level.
const DIFFICULTY_PARAMS: Record<Difficulty, LevelParams> = {
  easy: {
    segments: 5, segMin: 260, segMax: 380, gapMin: 45, gapMax: 75,
    platformChance: 0.35, platformWidthMin: 120, platformWidthMax: 160,
    platformHeightMin: 40, platformHeightMax: 60,
    enemySpeedMin: 35, enemySpeedMax: 55, enemyPatrolFrac: 0.9,
    coinsPerSegment: 3, lives: 4,
  },
  medium: {
    segments: 7, segMin: 220, segMax: 340, gapMin: 60, gapMax: 90,
    platformChance: 0.5, platformWidthMin: 100, platformWidthMax: 140,
    platformHeightMin: 50, platformHeightMax: 70,
    enemySpeedMin: 55, enemySpeedMax: 80, enemyPatrolFrac: 0.75,
    coinsPerSegment: 3, lives: 3,
  },
  hard: {
    segments: 9, segMin: 190, segMax: 300, gapMin: 75, gapMax: 105,
    platformChance: 0.6, platformWidthMin: 80, platformWidthMax: 120,
    platformHeightMin: 60, platformHeightMax: 80,
    enemySpeedMin: 75, enemySpeedMax: 105, enemyPatrolFrac: 0.6,
    coinsPerSegment: 4, lives: 3,
  },
  expert: {
    segments: 11, segMin: 160, segMax: 260, gapMin: 90, gapMax: 120,
    platformChance: 0.7, platformWidthMin: 60, platformWidthMax: 100,
    platformHeightMin: 70, platformHeightMax: 95,
    enemySpeedMin: 95, enemySpeedMax: 135, enemyPatrolFrac: 0.5,
    coinsPerSegment: 4, lives: 2,
  },
};

function levelParamsFor(difficulty: Difficulty, levelNumber: number): LevelParams {
  const base = DIFFICULTY_PARAMS[difficulty];
  const t = (levelNumber - 1) / (LEVELS_PER_DIFFICULTY - 1); // 0 (level 1) .. 1 (last level)
  const intensity = 0.55 + 0.45 * t; // level 1 is ~55% as intense as the last level
  return {
    ...base,
    segments: Math.max(3, Math.round(base.segments * (0.5 + 0.5 * t))),
    gapMin: base.gapMin * intensity,
    gapMax: base.gapMax * intensity,
    platformChance: base.platformChance * intensity,
    enemySpeedMin: base.enemySpeedMin * intensity,
    enemySpeedMax: base.enemySpeedMax * intensity,
  };
}

// Which monster kinds are in play yet at this point in the progression —
// levels ease players into each new kind rather than throwing all four at
// once from level 1.
function enemyKindPool(t: number): EnemyKind[] {
  const pool: EnemyKind[] = ["crawler"];
  if (t > 0.2) pool.push("walker");
  if (t > 0.45) pool.push("floater");
  return pool;
}

function randRange(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}

function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.floor(rand() * items.length)];
}

function generateHorizontalLevel(difficulty: Difficulty, levelNumber: number, rand: () => number): Level {
  const p = levelParamsFor(difficulty, levelNumber);
  const t = (levelNumber - 1) / (LEVELS_PER_DIFFICULTY - 1);
  const kindPool = enemyKindPool(t);
  const ground: Solid[] = [];
  const platforms: Solid[] = [];
  const enemies: Enemy[] = [];
  const pickups: Pickup[] = [];

  // A generous, fixed-width safe runway to start: a first-time player needs
  // a few seconds to even realize a jump button exists before meeting the
  // first pit — a short/random first segment made that pit arrive within
  // ~2s of holding right, which reads as "falls off immediately."
  const firstSegWidth = Math.max(440, p.segMax);
  ground.push({ x: 0, y: GROUND_Y, w: firstSegWidth, h: HEIGHT - GROUND_Y });
  for (let i = 0; i < 3; i++) {
    pickups.push({ x: randRange(rand, 40, firstSegWidth - 20), y: GROUND_Y - 40, r: 9, collected: false, kind: "gem" });
  }

  let cursorX = firstSegWidth;

  for (let i = 1; i < p.segments; i++) {
    // The very first jump is always the easiest possible width, regardless
    // of difficulty, since it's most players' first-ever encounter with a
    // gap in this game.
    const gapWidth =
      i === 1
        ? Math.max(MIN_GAP_WIDTH, p.gapMin)
        : Math.max(MIN_GAP_WIDTH, Math.min(randRange(rand, p.gapMin, p.gapMax), MAX_JUMP_DISTANCE * 0.9));
    const gapStart = cursorX;
    cursorX += gapWidth;

    const segWidth = randRange(rand, p.segMin, p.segMax);
    ground.push({ x: cursorX, y: GROUND_Y, w: segWidth, h: HEIGHT - GROUND_Y });

    const kind = i === 1 ? "crawler" : pick(rand, kindPool);
    if (kind === "floater") {
      // Hovers over the gap just crossed rather than patrolling the ground.
      const hoverY = GROUND_Y - randRange(rand, 50, Math.min(90, MAX_JUMP_HEIGHT * 0.8));
      enemies.push({
        kind, x: gapStart, y: hoverY, w: 26, h: 26,
        minX: gapStart, maxX: gapStart + gapWidth, minY: hoverY, maxY: hoverY,
        speed: randRange(rand, p.enemySpeedMin, p.enemySpeedMax) * 0.7,
        dir: rand() < 0.5 ? 1 : -1, alive: true,
      });
    } else {
      const patrolWidth = segWidth * p.enemyPatrolFrac;
      const patrolStart = cursorX + (segWidth - patrolWidth) / 2;
      const speedMul = kind === "walker" ? 0.75 : 1;
      enemies.push({
        kind, x: patrolStart, y: GROUND_Y - 26, w: 26, h: 26,
        minX: patrolStart, maxX: patrolStart + patrolWidth, minY: GROUND_Y - 26, maxY: GROUND_Y - 26,
        speed: randRange(rand, p.enemySpeedMin, p.enemySpeedMax) * speedMul,
        dir: rand() < 0.5 ? 1 : -1, alive: true,
      });
    }

    for (let c = 0; c < p.coinsPerSegment; c++) {
      pickups.push({ x: cursorX + randRange(rand, 20, segWidth - 20), y: GROUND_Y - 40, r: 9, collected: false, kind: "gem" });
    }

    if (rand() < p.platformChance) {
      const pw = randRange(rand, p.platformWidthMin, p.platformWidthMax);
      const ph = Math.min(randRange(rand, p.platformHeightMin, p.platformHeightMax), MAX_JUMP_HEIGHT * 0.9);
      const px = Math.max(gapStart - 15, gapStart + gapWidth / 2 - pw / 2);
      platforms.push({ x: px, y: GROUND_Y - ph, w: pw, h: 15 });
      // Platforms are the harder-to-reach spots, so they get the
      // higher-value star instead of a plain gem.
      pickups.push({ x: px + pw / 2, y: GROUND_Y - ph - 22, r: 10, collected: false, kind: "star" });
    }

    cursorX += segWidth;
  }

  const goalX = cursorX - 70;
  const worldWidth = cursorX + 120;

  return {
    orientation: "horizontal",
    spawnX: START_X,
    spawnY: START_Y,
    goalX,
    goalY: 0,
    deathY: HEIGHT + 100,
    cameraMinX: 0,
    cameraMaxX: Math.max(0, worldWidth - WIDTH),
    cameraMinY: 0,
    cameraMaxY: 0,
    ground,
    platforms,
    enemies,
    pickups,
    lives: p.lives,
  };
}

// Landings only register while falling (see the `player.vy >= 0` guard in
// the physics loop), so a jump to a platform *above* the launch point only
// counts once the player is past the arc's apex and descending back through
// that height. That leaves less horizontal travel time than the arc's full
// (same-height) range — height and horizontal reach aren't independently
// choosable the way flat-ground gaps and platform heights are. This
// computes the horizontal distance actually covered by the time the arc
// descends back to a given height above the launch point.
function achievableDistanceForHeight(height: number): number {
  const discriminant = JUMP_VELOCITY * JUMP_VELOCITY - 2 * GRAVITY * height;
  if (discriminant < 0) return 0; // height exceeds the arc's apex — unreachable
  const t = (-JUMP_VELOCITY + Math.sqrt(discriminant)) / GRAVITY;
  return MOVE_SPEED * t;
}

function generateClimbLevel(difficulty: Difficulty, levelNumber: number, rand: () => number): Level {
  const p = levelParamsFor(difficulty, levelNumber);
  const ground: Solid[] = [];
  const platforms: Solid[] = [];
  const enemies: Enemy[] = [];
  const pickups: Pickup[] = [];

  const startWidth = 220;
  ground.push({ x: WIDTH / 2 - startWidth / 2, y: GROUND_Y, w: startWidth, h: HEIGHT - GROUND_Y });

  const steps = Math.max(6, Math.round(p.segments * 1.4));
  let stepY = GROUND_Y;
  let prevCenterX = WIDTH / 2;

  for (let i = 0; i < steps; i++) {
    const stepUp = randRange(rand, MAX_JUMP_HEIGHT * 0.35, MAX_JUMP_HEIGHT * 0.65);
    stepY -= stepUp;
    const pw = randRange(rand, p.platformWidthMin, p.platformWidthMax);

    // Alternate roughly left/right of the previous platform so the climb
    // zigzags, but keep the horizontal offset within reach of a single jump
    // *at this step's height* (see achievableDistanceForHeight) — a flat
    // fraction of MAX_JUMP_DISTANCE ignores that higher steps leave much
    // less usable horizontal travel, which left some climbs unreachable.
    const maxOffset = Math.min(achievableDistanceForHeight(stepUp) * 0.5, WIDTH / 2 - 20);
    const dir = i % 2 === 0 ? 1 : -1;
    const offset = dir * randRange(rand, maxOffset * 0.3, maxOffset);
    let cx = prevCenterX + offset;
    cx = Math.max(30 + pw / 2, Math.min(WIDTH - 30 - pw / 2, cx));

    const px = cx - pw / 2;
    platforms.push({ x: px, y: stepY, w: pw, h: 15 });

    const isTop = i === steps - 1;
    pickups.push({
      x: cx, y: stepY - 22, r: isTop ? 11 : 9, collected: false,
      kind: isTop || rand() < 0.3 ? "star" : "gem",
    });

    // Guard some steps with a flyer (patrols vertically near this platform)
    // or a floater (patrols the width of this platform) — climb levels
    // lean on the airborne kinds since there's no continuous ground to
    // patrol.
    if (i > 0 && rand() < 0.5) {
      const kind: EnemyKind = rand() < 0.5 ? "flyer" : "floater";
      if (kind === "flyer") {
        const guardY = stepY - randRange(rand, 40, Math.min(90, MAX_JUMP_HEIGHT * 0.7));
        enemies.push({
          kind, x: cx - 13, y: guardY, w: 26, h: 26,
          minX: cx - 13, maxX: cx - 13, minY: guardY, maxY: stepY - 15,
          speed: randRange(rand, p.enemySpeedMin, p.enemySpeedMax) * 0.6,
          dir: rand() < 0.5 ? 1 : -1, alive: true,
        });
      } else {
        enemies.push({
          kind, x: px, y: stepY - 26, w: 26, h: 26,
          minX: px, maxX: px + pw - 26, minY: stepY - 26, maxY: stepY - 26,
          speed: randRange(rand, p.enemySpeedMin, p.enemySpeedMax) * 0.6,
          dir: rand() < 0.5 ? 1 : -1, alive: true,
        });
      }
    }

    prevCenterX = cx;
  }

  const goalY = stepY;

  return {
    orientation: "vertical",
    spawnX: WIDTH / 2 - PLAYER_W / 2,
    spawnY: START_Y,
    goalX: prevCenterX,
    goalY,
    deathY: GROUND_Y + 150,
    cameraMinX: 0,
    cameraMaxX: 0,
    cameraMinY: goalY - 150,
    cameraMaxY: 0,
    ground,
    platforms,
    enemies,
    pickups,
    lives: p.lives,
  };
}

export function generateLevel(difficulty: Difficulty, levelNumber: number): Level {
  const rand = mulberry32(seedFromString(`${difficulty}-${levelNumber}`));
  return isClimbLevel(levelNumber)
    ? generateClimbLevel(difficulty, levelNumber, rand)
    : generateHorizontalLevel(difficulty, levelNumber, rand);
}
