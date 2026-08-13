"use client";

import { useEffect, useRef, useState } from "react";
import { FARM_SPRITES } from "@/lib/farm-sprites";
import {
  ANIMALS,
  AUTO_HARVEST_COST,
  AUTO_PLANT_COST,
  BARN_BUILD_COST,
  CHUNK_OFFSETS,
  CHUNK_SIZE,
  CROPS,
  MAX_CHUNKS,
  addToBarn,
  addToBasket,
  animalCost,
  availableOrderItemIds,
  buildBarn,
  canBuildBarn,
  canSellTowardOrder,
  cellSellableItemId,
  cellState,
  chunkCost,
  collectAnimalCell,
  countAnimalType,
  depositBasket,
  effectiveSellPrice,
  emptyChunk,
  fillOrders,
  getAnimal,
  getCrop,
  getSellableItem,
  harvestCropCell,
  initialChunks,
  plantCell,
  pruneStaleOrders,
  sellTowardOrder,
  totalBarnCapacity,
  upgradeCost,
  MAX_CUSTOMERS,
  MAX_UPGRADE_LEVEL,
  type Animal,
  type Barn,
  type Basket,
  type Cell,
  type Chunk,
  type CustomerOrder,
} from "@/lib/farm";

// See RaceTrack.tsx / StarHopper.tsx for why direct Date.now()/performance.now()
// calls are avoided anywhere reachable from render — wrap once here instead.
function nowMs(): number {
  return performance.now();
}
function currentTimeMs(): number {
  return Date.now();
}

interface FarmProgressState {
  coins: number;
  wateringLevel: number;
  fertilizerLevel: number;
  autoHarvest: boolean;
  autoPlant: boolean;
  chunks: Chunk[];
  barn: Barn;
  basket: Basket;
  currentOrders: CustomerOrder[];
}

// The auto-harvest background poll re-fetches progress every 15s whether or
// not anything actually changed, and applying a brand-new object/array
// reference every time forces a full re-render of this whole (large, canvas
// heavy) component — on slower hardware that shows up as a periodic
// hitch/flash. Skip the state update entirely when the fetched snapshot is
// no different from what's already showing.
function progressStatesEqual(a: FarmProgressState, b: FarmProgressState): boolean {
  return (
    a.coins === b.coins &&
    a.wateringLevel === b.wateringLevel &&
    a.fertilizerLevel === b.fertilizerLevel &&
    a.autoHarvest === b.autoHarvest &&
    a.autoPlant === b.autoPlant &&
    JSON.stringify(a.chunks) === JSON.stringify(b.chunks) &&
    JSON.stringify(a.barn) === JSON.stringify(b.barn) &&
    JSON.stringify(a.basket) === JSON.stringify(b.basket) &&
    JSON.stringify(a.currentOrders) === JSON.stringify(b.currentOrders)
  );
}

const DEFAULT_PROGRESS: FarmProgressState = {
  coins: 50,
  wateringLevel: 1,
  fertilizerLevel: 1,
  autoHarvest: false,
  autoPlant: false,
  chunks: initialChunks(),
  barn: {},
  basket: {},
  currentOrders: [],
};

const CANVAS_W = 720;
const CANVAS_H = 600;
const PLAYER_SPEED = 175;
const PLAYER_SIZE = 30;
const INTERACT_RADIUS = 42;
const BUILDING_RADIUS = 54;

interface Point {
  x: number;
  y: number;
}

const BARN_POS: Point = { x: 100, y: 190 };
const TABLE_POS: Point = { x: 240, y: 190 };

// World layout for the chunk grid: chunk (0,0) sits to the right of the
// fixed barn/table landmarks, and every other chunk offset is placed
// relative to it — the world grows outward in every direction as chunks
// are bought, instead of along one line. CHUNK_OFFSETS includes a "west"
// neighbor ([-1, 0]) that swings back left of the origin — ORIGIN_CHUNK_X
// has to stay far enough right that even that westmost ring tile's cell
// area clears BARN_POS/TABLE_POS (plus their interaction radius), or
// buying/seeing that plot buries the barn and sell table under farmland.
const CELL_SIZE = 62;
const CELL_GAP = 8;
const CHUNK_PIXELS = 250;
const CHUNK_CONTENT_SIZE = CHUNK_SIZE * CELL_SIZE + (CHUNK_SIZE + 1) * CELL_GAP;
const CHUNK_PAD = (CHUNK_PIXELS - CHUNK_CONTENT_SIZE) / 2;
const ORIGIN_CHUNK_X = 600;
const ORIGIN_CHUNK_Y = 30;

function chunkOrigin(cx: number, cy: number): Point {
  return { x: ORIGIN_CHUNK_X + cx * CHUNK_PIXELS, y: ORIGIN_CHUNK_Y + cy * CHUNK_PIXELS };
}

function cellCenter(origin: Point, row: number, col: number): Point {
  const left = origin.x + CHUNK_PAD + CELL_GAP + col * (CELL_SIZE + CELL_GAP);
  const top = origin.y + CHUNK_PAD + CELL_GAP + row * (CELL_SIZE + CELL_GAP);
  return { x: left + CELL_SIZE / 2, y: top + CELL_SIZE / 2 };
}

const ALL_CHUNK_ORIGINS = CHUNK_OFFSETS.map(([cx, cy]) => chunkOrigin(cx, cy));
const WORLD_MIN_X = Math.min(60, ...ALL_CHUNK_ORIGINS.map((p) => p.x));
const WORLD_MAX_X = Math.max(...ALL_CHUNK_ORIGINS.map((p) => p.x + CHUNK_PIXELS)) + 20;
const WORLD_MIN_Y = Math.min(...ALL_CHUNK_ORIGINS.map((p) => p.y)) - 20;
const WORLD_MAX_Y = Math.max(...ALL_CHUNK_ORIGINS.map((p) => p.y + CHUNK_PIXELS)) + 20;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function loadSprites(): Record<string, HTMLImageElement> {
  const images: Record<string, HTMLImageElement> = {};
  for (const [name, src] of Object.entries(FARM_SPRITES)) {
    const img = new Image();
    img.src = src;
    images[name] = img;
  }
  return images;
}

function drawBarn(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const w = 70;
  const h = 56;
  ctx.fillStyle = "#b45309";
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = "#78350f";
  ctx.fillRect(x - 6, y + h / 2 - 22, 12, 22);
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 8, y - h / 2);
  ctx.lineTo(x, y - h / 2 - 26);
  ctx.lineTo(x + w / 2 + 8, y - h / 2);
  ctx.closePath();
  ctx.fillStyle = "#991b1b";
  ctx.fill();
  ctx.fillStyle = "#fef3c7";
  ctx.beginPath();
  ctx.arc(x, y - h / 2 - 8, 5, 0, Math.PI * 2);
  ctx.fill();
}

// CanvasRenderingContext2D.roundRect isn't available on older Safari (pre
// iPadOS 16) — a family tablet is a very plausible place to hit that, and
// calling a missing method would throw mid-frame and kill the render loop.
// Fall back to a plain rectangle path there instead of crashing.
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

interface CellRef {
  chunkIndex: number;
  cellIndex: number;
}

interface Interaction {
  cell: CellRef | null;
  nearBarn: boolean;
  nearTable: boolean;
}

type Screen = "world" | "shop" | "barn";

export default function Farm({ kidId }: { kidId: string }) {
  const [progress, setProgress] = useState<FarmProgressState>(DEFAULT_PROGRESS);
  const [loaded, setLoaded] = useState(false);
  const [screen, setScreen] = useState<Screen>("world");
  const [cellPicker, setCellPicker] = useState<CellRef | null>(null);
  const [now, setNow] = useState(() => currentTimeMs());
  const [interaction, setInteraction] = useState<Interaction>({ cell: null, nearBarn: false, nearTable: false });
  const [toast, setToast] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const spritesRef = useRef<Record<string, HTMLImageElement>>({});
  const playerRef = useRef<Point>({ x: 170, y: 280 });
  const facingRef = useRef<1 | -1>(1);
  const progressRef = useRef(progress);
  const interactionRef = useRef<Interaction>({ cell: null, nearBarn: false, nearTable: false });
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every action's own sync and the periodic auto-harvest re-poll can both be
  // in flight at once; whichever one started first can resolve *last* and
  // clobber newer state with a stale snapshot — the game visibly reverts
  // for a moment (a plant vanishing, a barn count jumping back) until the
  // newer response lands. Only ever apply the response to the most recent
  // request that was actually sent.
  const latestRequestIdRef = useRef(0);

  useEffect(() => {
    spritesRef.current = loadSprites();
  }, []);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  function applyProgress(data: { progress?: FarmProgressState }) {
    if (!data.progress) return;
    const next: FarmProgressState = {
      coins: data.progress.coins,
      wateringLevel: data.progress.wateringLevel,
      fertilizerLevel: data.progress.fertilizerLevel,
      autoHarvest: data.progress.autoHarvest,
      autoPlant: data.progress.autoPlant,
      chunks: data.progress.chunks as Chunk[],
      barn: data.progress.barn as Barn,
      basket: data.progress.basket as Basket,
      currentOrders: (data.progress.currentOrders as CustomerOrder[] | undefined) ?? [],
    };
    // Returning the same object back from a state updater is React's
    // built-in way to bail out of the re-render entirely.
    setProgress((p) => (progressStatesEqual(p, next) ? p : next));
  }

  // Order generation normally happens server-side (see /api/farm/progress),
  // but that means the demo (no backend) or any failed request would leave
  // currentOrders stuck short forever — fall back to filling it locally
  // whenever a sync doesn't come back with a full set.
  function ensureOrders() {
    setProgress((p) => {
      const validOrders = pruneStaleOrders(p.currentOrders, p.chunks);
      if (validOrders.length >= MAX_CUSTOMERS && validOrders.length === p.currentOrders.length) return p;
      return { ...p, currentOrders: fillOrders(validOrders, availableOrderItemIds(p.chunks), Math.random) };
    });
  }

  useEffect(() => {
    const requestId = ++latestRequestIdRef.current;
    fetch(`/api/farm/progress?kidId=${kidId}`)
      .then((res) => res.json())
      .then((data) => {
        if (requestId === latestRequestIdRef.current) applyProgress(data);
      })
      .catch(() => {})
      .finally(() => {
        setLoaded(true);
        ensureOrders();
      });
  }, [kidId]);

  useEffect(() => {
    const interval = setInterval(() => setNow(currentTimeMs()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-harvest/auto-plant advance server-side (see simulateAutoCycles) even
  // while the kid is away; re-polling periodically while owned pulls those
  // changes in during an active session too, reusing the exact same offline
  // catch-up logic instead of duplicating it client-side.
  useEffect(() => {
    if (!progress.autoHarvest) return;
    const interval = setInterval(() => {
      const requestId = ++latestRequestIdRef.current;
      fetch(`/api/farm/progress?kidId=${kidId}`)
        .then((res) => res.json())
        .then((data) => {
          if (requestId === latestRequestIdRef.current) applyProgress(data);
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [progress.autoHarvest, kidId]);

  // Every action updates local state immediately (optimistic) and syncs to
  // the server in the background — without this the game is unplayable
  // wherever there's no backend to round-trip through (like the static demo).
  function syncInBackground(url: string, body: unknown) {
    const requestId = ++latestRequestIdRef.current;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && requestId === latestRequestIdRef.current) applyProgress(data);
      })
      .catch(() => {});
  }

  function showToast(text: string) {
    setToast(text);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 1600);
  }

  function assignCell(chunkIndex: number, cellIndex: number, content: "crop" | "animal", itemId: string) {
    const chunks = progressRef.current.chunks;
    const chunk = chunks[chunkIndex];
    const cell = chunk?.cells[cellIndex];
    if (!cell || cell.content !== "empty") return;
    let cost: number;
    let label: string;
    if (content === "crop") {
      const crop = getCrop(itemId);
      if (!crop) return;
      cost = crop.seedCost;
      label = `Planted ${crop.emoji} ${crop.name}`;
    } else {
      const animal = getAnimal(itemId);
      if (!animal) return;
      cost = animalCost(animal, countAnimalType(chunks, itemId));
      label = `Placed a ${animal.emoji} ${animal.name}`;
    }
    if (progressRef.current.coins < cost) return;
    setCellPicker(null);
    setProgress((p) => {
      const nextChunks = p.chunks.map((c, ci) =>
        ci !== chunkIndex ? c : { ...c, cells: c.cells.map((cc, i) => (i === cellIndex ? plantCell(content, itemId) : cc)) },
      );
      return { ...p, coins: p.coins - cost, chunks: nextChunks };
    });
    syncInBackground("/api/farm/assign-cell", { kidId, chunkIndex, cellIndex, content, itemId });
    showToast(label);
  }

  function harvestCell(chunkIndex: number, cellIndex: number) {
    const chunk = progressRef.current.chunks[chunkIndex];
    const cell = chunk?.cells[cellIndex];
    if (!cell || cellState(cell, progressRef.current.wateringLevel, currentTimeMs()) !== "ready") return;
    const itemId = cellSellableItemId(cell);
    const item = itemId ? getSellableItem(itemId) : undefined;
    if (!itemId || !item) return;
    const autoHarvest = progressRef.current.autoHarvest;
    const isCrop = cell.content === "crop";
    const nextCell: Cell = isCrop ? harvestCropCell() : collectAnimalCell(cell);
    setProgress((p) => {
      const nextChunks = p.chunks.map((c, ci) =>
        ci !== chunkIndex ? c : { ...c, cells: c.cells.map((cc, i) => (i === cellIndex ? nextCell : cc)) },
      );
      if (autoHarvest) {
        const barn = { ...p.barn };
        addToBarn(barn, itemId, totalBarnCapacity(p.chunks));
        return { ...p, chunks: nextChunks, barn };
      }
      const basket = { ...p.basket };
      addToBasket(basket, itemId, 1);
      return { ...p, chunks: nextChunks, basket };
    });
    syncInBackground("/api/farm/harvest-cell", { kidId, chunkIndex, cellIndex });
    showToast(`${isCrop ? "Picked" : "Collected"} ${item.emoji} ${item.name}!`);
  }

  function buildBarnAction(chunkIndex: number) {
    const chunk = progressRef.current.chunks[chunkIndex];
    if (!chunk || !canBuildBarn(chunk)) return;
    if (progressRef.current.coins < BARN_BUILD_COST) return;
    setCellPicker(null);
    setProgress((p) => {
      const nextChunks = p.chunks.map((c, ci) => (ci === chunkIndex ? buildBarn(c) : c));
      return { ...p, coins: p.coins - BARN_BUILD_COST, chunks: nextChunks };
    });
    syncInBackground("/api/farm/build-barn", { kidId, chunkIndex });
    showToast("Barn built! More storage room.");
  }

  function depositBasketAction() {
    const basketNow = progressRef.current.basket;
    const total = Object.values(basketNow).reduce((s, n) => s + n, 0);
    if (total === 0) return;
    setProgress((p) => {
      const capacity = totalBarnCapacity(p.chunks);
      const { basket, barn } = depositBasket(p.basket, p.barn, capacity);
      return { ...p, basket, barn };
    });
    syncInBackground("/api/farm/deposit-basket", { kidId });
    showToast("Deposited into the barn!");
  }

  // Sells toward whichever waiting customer's order the barn has anything
  // for; kids don't have to pick which one by hand, and don't have to wait
  // until they've grown the customer's full quantity — selling less than
  // they asked for still pays out, and leaves the order open for the rest.
  function fulfillBestOrder() {
    const orders = progressRef.current.currentOrders;
    const barn = progressRef.current.barn;
    const orderIndex = orders.findIndex((o) => canSellTowardOrder(barn, o));
    if (orderIndex === -1) return;
    const order = orders[orderIndex];
    const sale = sellTowardOrder(barn, order);
    setProgress((p) => {
      const nextOrders = p.currentOrders
        .map((o, i) => (i === orderIndex ? sale.order : o))
        .filter((o): o is CustomerOrder => o !== null);
      return { ...p, coins: p.coins + sale.earned, barn: sale.barn, currentOrders: nextOrders };
    });
    const requestId = ++latestRequestIdRef.current;
    fetch("/api/farm/fulfill-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kidId, orderIndex }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && requestId === latestRequestIdRef.current) applyProgress(data);
        ensureOrders();
      })
      .catch(() => ensureOrders());
    showToast(`Sold for 🪙${sale.earned}!`);
  }

  function buyChunk() {
    const chunks = progressRef.current.chunks;
    if (chunks.length >= MAX_CHUNKS) return;
    const cost = chunkCost(chunks.length);
    if (progressRef.current.coins < cost) return;
    const [cx, cy] = CHUNK_OFFSETS[chunks.length];
    setProgress((p) => ({ ...p, coins: p.coins - cost, chunks: [...p.chunks, emptyChunk(cx, cy)] }));
    syncInBackground("/api/farm/buy-chunk", { kidId });
  }

  function buyUpgrade(stat: "watering" | "fertilizer") {
    const field = stat === "watering" ? "wateringLevel" : "fertilizerLevel";
    const currentLevel = progressRef.current[field];
    if (currentLevel >= MAX_UPGRADE_LEVEL) return;
    const cost = upgradeCost(currentLevel);
    if (progressRef.current.coins < cost) return;
    setProgress((p) => ({ ...p, coins: p.coins - cost, [field]: currentLevel + 1 }));
    syncInBackground("/api/farm/upgrade", { kidId, stat });
  }

  function buyAutomation(type: "harvest" | "plant") {
    const field = type === "harvest" ? "autoHarvest" : "autoPlant";
    const cost = type === "harvest" ? AUTO_HARVEST_COST : AUTO_PLANT_COST;
    if (progressRef.current[field]) return;
    if (type === "plant" && !progressRef.current.autoHarvest) return;
    if (progressRef.current.coins < cost) return;
    setProgress((p) => ({ ...p, coins: p.coins - cost, [field]: true }));
    syncInBackground("/api/farm/buy-automation", { kidId, type });
  }

  function handleAction() {
    if (cellPicker !== null) return;
    const near = interactionRef.current;
    if (near.cell) {
      const { chunkIndex, cellIndex } = near.cell;
      const chunk = progressRef.current.chunks[chunkIndex];
      const cell = chunk?.cells[cellIndex];
      if (!cell) return;
      const state = cellState(cell, progressRef.current.wateringLevel, currentTimeMs());
      if (state === "empty") setCellPicker({ chunkIndex, cellIndex });
      else if (state === "ready") harvestCell(chunkIndex, cellIndex);
      else if (state === "barn") setScreen("barn");
      return;
    }
    if (near.nearBarn) {
      setScreen("barn");
      return;
    }
    if (near.nearTable) fulfillBestOrder();
  }

  function pressKey(key: string) {
    keysRef.current.add(key);
  }
  function releaseKey(key: string) {
    keysRef.current.delete(key);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
      keysRef.current.add(e.key);
      if (e.key === " " || e.key === "Enter") handleAction();
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
  }, [cellPicker]);

  useEffect(() => {
    if (screen !== "world" || !loaded) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let lastTime = nowMs();
    let rafId: number;
    let frameCount = 0;

    const frame = (frameNow: number) => {
      const dt = Math.min((frameNow - lastTime) / 1000, 0.05);
      lastTime = frameNow;
      const player = playerRef.current;

      if (cellPicker === null) {
        let dx = 0;
        let dy = 0;
        if (keysRef.current.has("ArrowLeft")) dx -= 1;
        if (keysRef.current.has("ArrowRight")) dx += 1;
        if (keysRef.current.has("ArrowUp")) dy -= 1;
        if (keysRef.current.has("ArrowDown")) dy += 1;
        if (dx !== 0 && dy !== 0) {
          dx *= Math.SQRT1_2;
          dy *= Math.SQRT1_2;
        }
        if (dx < 0) facingRef.current = -1;
        else if (dx > 0) facingRef.current = 1;

        const margin = PLAYER_SIZE / 2;
        player.x = Math.max(WORLD_MIN_X + margin, Math.min(WORLD_MAX_X - margin, player.x + dx * PLAYER_SPEED * dt));
        player.y = Math.max(WORLD_MIN_Y + margin, Math.min(WORLD_MAX_Y - margin, player.y + dy * PLAYER_SPEED * dt));
      }

      const chunks = progressRef.current.chunks;
      let nearCell: CellRef | null = null;
      outer: for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const origin = chunkOrigin(chunk.cx, chunk.cy);
        for (let row = 0; row < CHUNK_SIZE; row++) {
          for (let col = 0; col < CHUNK_SIZE; col++) {
            const idx = row * CHUNK_SIZE + col;
            const center = cellCenter(origin, row, col);
            if (dist(player, center) < INTERACT_RADIUS) {
              nearCell = { chunkIndex: ci, cellIndex: idx };
              break outer;
            }
          }
        }
      }
      const nearBarn = dist(player, BARN_POS) < BUILDING_RADIUS;
      const nearTable = dist(player, TABLE_POS) < BUILDING_RADIUS;
      const prev = interactionRef.current;
      const cellChanged =
        (nearCell?.chunkIndex ?? -1) !== (prev.cell?.chunkIndex ?? -1) || (nearCell?.cellIndex ?? -1) !== (prev.cell?.cellIndex ?? -1);
      if (cellChanged || nearBarn !== prev.nearBarn || nearTable !== prev.nearTable) {
        interactionRef.current = { cell: nearCell, nearBarn, nearTable };
        setInteraction({ cell: nearCell, nearBarn, nearTable });
      }

      // Movement and interaction detection above run every frame so input
      // stays responsive, but the actual canvas redraw below — background,
      // world tiles, every planted cell, the customer bubbles — is real CPU
      // work that adds up on weaker hardware. A farm you walk around doesn't
      // need 60 redraws a second to look smooth, so only draw on every other
      // frame (~30fps) and leave the previous frame on screen otherwise.
      frameCount++;
      if (frameCount % 2 === 0) {
        const sprites = spritesRef.current;
        const clockNow = currentTimeMs();
        // Round the camera to whole pixels — a fractional camera offset makes
        // every world-aligned tile edge (grass, soil, chunk borders) land on a
        // different sub-pixel each frame, which reads as a flicker/shimmer
        // across the whole screen while walking.
        const cameraX = Math.round(Math.max(WORLD_MIN_X, Math.min(player.x - CANVAS_W / 2, WORLD_MAX_X - CANVAS_W)));
        const cameraY = Math.round(Math.max(WORLD_MIN_Y, Math.min(player.y - CANVAS_H / 2, WORLD_MAX_Y - CANVAS_H)));

        ctx.fillStyle = "#86c46b";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = "#7bb864";
        // Iterate only the tiles actually inside the camera's view — this used
        // to loop the *entire* world extent every frame (checking each tile
        // against the viewport to decide whether to skip it), which scales up
        // as more land is bought and adds real per-frame CPU work on weaker
        // hardware for no visual benefit, since only ~18x15 tiles are ever
        // visible at once regardless of how big the world has grown.
        const gxStart = Math.floor(cameraX / 40) * 40;
        const gyStart = Math.floor(cameraY / 40) * 40;
        for (let gx = gxStart; gx < cameraX + CANVAS_W; gx += 40) {
          for (let gy = gyStart; gy < cameraY + CANVAS_H; gy += 40) {
            if (((Math.round(gx / 40) + Math.round(gy / 40)) | 0) % 2 === 0) {
              ctx.fillRect(gx - cameraX, gy - cameraY, 40, 40);
            }
          }
        }

        drawBarn(ctx, BARN_POS.x - cameraX, BARN_POS.y - cameraY);
        if (nearBarn) {
          const basketHas = Object.values(progressRef.current.basket).some((n) => n > 0);
          ctx.strokeStyle = basketHas ? "#facc15" : "rgba(250,204,21,0.4)";
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.arc(BARN_POS.x - cameraX, BARN_POS.y - cameraY, BUILDING_RADIUS, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (sprites.table?.complete) {
          const tw = 84;
          const th = 42;
          ctx.drawImage(sprites.table, TABLE_POS.x - cameraX - tw / 2, TABLE_POS.y - cameraY - th / 2, tw, th);
        }
        const orders = progressRef.current.currentOrders;
        const barnNow = progressRef.current.barn;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        orders.forEach((order, i) => {
          const item = getSellableItem(order.itemId);
          if (!item) return;
          const ox = TABLE_POS.x - cameraX + (i - 1) * 56;
          const faceY = TABLE_POS.y - cameraY - 62;
          const bubbleY = faceY - 34;
          const have = barnNow[order.itemId] ?? 0;
          const canFull = have >= order.quantity;
          const canPartial = have > 0 && !canFull;
          const bg = canFull ? "#dcfce7" : canPartial ? "#fef9c3" : "#ffffff";
          const border = canFull ? "#22c55e" : canPartial ? "#eab308" : "#94a3b8";
          const textColor = canFull ? "#166534" : canPartial ? "#854d0e" : "#1e293b";
          const label = `${item.emoji} x${order.quantity}`;

          ctx.font = "bold 18px sans-serif";
          const textWidth = ctx.measureText(label).width;
          const bubbleW = textWidth + 20;
          const bubbleH = 30;
          const bx = ox - bubbleW / 2;
          const by = bubbleY - bubbleH / 2;
          ctx.fillStyle = bg;
          ctx.strokeStyle = border;
          ctx.lineWidth = 2;
          ctx.beginPath();
          roundRectPath(ctx, bx, by, bubbleW, bubbleH, 9);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(ox - 6, by + bubbleH - 1);
          ctx.lineTo(ox + 6, by + bubbleH - 1);
          ctx.lineTo(ox, by + bubbleH + 8);
          ctx.closePath();
          ctx.fillStyle = bg;
          ctx.fill();

          ctx.fillStyle = textColor;
          ctx.fillText(label, ox, bubbleY);

          ctx.font = "32px sans-serif";
          ctx.fillText("🧑", ox, faceY);
        });
        if (nearTable) {
          const anySellable = orders.some((o) => canSellTowardOrder(barnNow, o));
          ctx.strokeStyle = anySellable ? "#facc15" : "rgba(250,204,21,0.4)";
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.arc(TABLE_POS.x - cameraX, TABLE_POS.y - cameraY + 10, BUILDING_RADIUS, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Locked chunk placeholders (fixed positions, drawn before owned ones).
        for (let i = chunks.length; i < CHUNK_OFFSETS.length; i++) {
          const [cx, cy] = CHUNK_OFFSETS[i];
          const origin = chunkOrigin(cx, cy);
          const sx = origin.x - cameraX;
          const sy = origin.y - cameraY;
          if (sx < -CHUNK_PIXELS || sx > CANVAS_W || sy < -CHUNK_PIXELS || sy > CANVAS_H) continue;
          ctx.strokeStyle = "rgba(100,100,100,0.35)";
          ctx.setLineDash([6, 6]);
          ctx.lineWidth = 2;
          ctx.strokeRect(sx + CHUNK_PAD, sy + CHUNK_PAD, CHUNK_CONTENT_SIZE, CHUNK_CONTENT_SIZE);
          ctx.setLineDash([]);
          ctx.font = "20px sans-serif";
          ctx.fillText("🔒", sx + CHUNK_PIXELS / 2, sy + CHUNK_PIXELS / 2 - 8);
          ctx.font = "bold 11px sans-serif";
          ctx.fillStyle = "#334155";
          ctx.fillText(`🪙${chunkCost(i)}`, sx + CHUNK_PIXELS / 2, sy + CHUNK_PIXELS / 2 + 10);
        }

        for (let ci = 0; ci < chunks.length; ci++) {
          const chunk = chunks[ci];
          const origin = chunkOrigin(chunk.cx, chunk.cy);
          const csx = origin.x - cameraX;
          const csy = origin.y - cameraY;
          if (csx < -CHUNK_PIXELS || csx > CANVAS_W || csy < -CHUNK_PIXELS || csy > CANVAS_H) continue;

          for (let row = 0; row < CHUNK_SIZE; row++) {
            for (let col = 0; col < CHUNK_SIZE; col++) {
              const idx = row * CHUNK_SIZE + col;
              const cell = chunk.cells[idx];
              const center = cellCenter(origin, row, col);
              const sx = center.x - cameraX;
              const sy = center.y - cameraY;

              if (cell.content === "barn") {
                ctx.fillStyle = "#92400e";
                ctx.fillRect(sx - CELL_SIZE / 2, sy - CELL_SIZE / 2, CELL_SIZE, CELL_SIZE);
                ctx.font = "22px sans-serif";
                ctx.fillText("🏚️", sx, sy);
                continue;
              }

              if (sprites.soil?.complete) {
                ctx.drawImage(sprites.soil, sx - CELL_SIZE / 2, sy - CELL_SIZE / 2, CELL_SIZE, CELL_SIZE);
              }

              const isNear = interactionRef.current.cell?.chunkIndex === ci && interactionRef.current.cell?.cellIndex === idx;
              if (isNear) {
                ctx.strokeStyle = "#38bdf8";
                ctx.lineWidth = 3;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.arc(sx, sy, INTERACT_RADIUS, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
              }

              const state = cellState(cell, progressRef.current.wateringLevel, clockNow);
              if (cell.content === "empty") {
                ctx.font = "14px sans-serif";
                ctx.fillStyle = "rgba(255,255,255,0.8)";
                ctx.fillText("+", sx, sy);
              } else if (cell.content === "crop" && cell.itemId) {
                const crop = getCrop(cell.itemId);
                if (crop) {
                  if (state === "growing") {
                    const total = crop.growTimeMs;
                    const elapsed = clockNow - new Date(cell.timestamp ?? 0).getTime();
                    const frac = Math.max(0, Math.min(1, elapsed / total));
                    ctx.font = `${12 + frac * 12}px sans-serif`;
                    ctx.globalAlpha = 0.85;
                    ctx.fillText(crop.emoji, sx, sy);
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = "rgba(255,255,255,0.7)";
                    ctx.fillRect(sx - 18, sy + CELL_SIZE / 2 - 6, 36, 5);
                    ctx.fillStyle = "#22c55e";
                    ctx.fillRect(sx - 18, sy + CELL_SIZE / 2 - 6, 36 * frac, 5);
                  } else {
                    const bounce = Math.sin(frameNow / 180) * 2;
                    ctx.font = "24px sans-serif";
                    ctx.fillText(crop.emoji, sx, sy + bounce);
                  }
                }
              } else if (cell.content === "animal" && cell.itemId) {
                const animal = getAnimal(cell.itemId);
                if (animal) {
                  if (state === "growing") {
                    const elapsed = clockNow - new Date(cell.timestamp ?? 0).getTime();
                    const frac = Math.max(0, Math.min(1, elapsed / animal.cycleTimeMs));
                    ctx.font = "20px sans-serif";
                    ctx.fillText(animal.emoji, sx, sy);
                    ctx.fillStyle = "rgba(255,255,255,0.7)";
                    ctx.fillRect(sx - 18, sy + CELL_SIZE / 2 - 6, 36, 5);
                    ctx.fillStyle = "#22c55e";
                    ctx.fillRect(sx - 18, sy + CELL_SIZE / 2 - 6, 36 * frac, 5);
                  } else {
                    const bounce = Math.sin(frameNow / 180) * 2;
                    ctx.font = "24px sans-serif";
                    ctx.fillText(animal.emoji, sx, sy + bounce);
                  }
                }
              }
            }
          }
        }

        if (sprites.player?.complete) {
          const pw = PLAYER_SIZE;
          const ph = PLAYER_SIZE;
          ctx.save();
          if (facingRef.current === -1) {
            ctx.translate(player.x - cameraX + pw / 2, player.y - cameraY - ph / 2);
            ctx.scale(-1, 1);
            ctx.drawImage(sprites.player, 0, 0, pw, ph);
          } else {
            ctx.drawImage(sprites.player, player.x - cameraX - pw / 2, player.y - cameraY - ph / 2, pw, ph);
          }
          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [screen, cellPicker, loaded]);

  if (!loaded) {
    return <p className="text-sm text-slate-400">Loading farm…</p>;
  }

  const barnCapacity = totalBarnCapacity(progress.chunks);
  const barnUsed = Object.values(progress.barn).reduce((s, n) => s + n, 0);
  const basketUsed = Object.values(progress.basket).reduce((s, n) => s + n, 0);

  if (screen === "shop") {
    return (
      <div className="flex flex-col items-center gap-5">
        <span className="text-lg font-bold text-slate-800">🪙 {progress.coins} coins</span>

        <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow">
          {/* eslint-disable-next-line @next/next/no-img-element -- shared component also runs under Vite (the demo), which next/image can't target */}
          <img src={FARM_SPRITES.hoe} alt="" className="h-8 w-8" style={{ imageRendering: "pixelated" }} />
          <div>
            <p className="font-semibold text-slate-700">Land — {progress.chunks.length} / {MAX_CHUNKS} plots of land</p>
            <p className="text-xs text-slate-400">Each plot is a 3x3 area — choose crops, animals, or a barn for each square.</p>
          </div>
          <button
            onClick={buyChunk}
            disabled={progress.chunks.length >= MAX_CHUNKS || progress.coins < chunkCost(progress.chunks.length)}
            className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {progress.chunks.length >= MAX_CHUNKS ? "Max" : `Buy — 🪙${chunkCost(progress.chunks.length)}`}
          </button>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow">
          {/* eslint-disable-next-line @next/next/no-img-element -- shared component also runs under Vite (the demo), which next/image can't target */}
          <img src={FARM_SPRITES.wateringCan} alt="" className="h-8 w-8" style={{ imageRendering: "pixelated" }} />
          <div>
            <p className="font-semibold text-slate-700">Watering Can — Level {progress.wateringLevel} / {MAX_UPGRADE_LEVEL}</p>
            <p className="text-xs text-slate-400">Crops grow faster.</p>
          </div>
          <button
            onClick={() => buyUpgrade("watering")}
            disabled={progress.wateringLevel >= MAX_UPGRADE_LEVEL || progress.coins < upgradeCost(progress.wateringLevel)}
            className="ml-auto rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
          >
            {progress.wateringLevel >= MAX_UPGRADE_LEVEL ? "Max" : `Upgrade — 🪙${upgradeCost(progress.wateringLevel)}`}
          </button>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow">
          <span className="flex h-8 w-8 items-center justify-center text-2xl">🌱</span>
          <div>
            <p className="font-semibold text-slate-700">Fertilizer — Level {progress.fertilizerLevel} / {MAX_UPGRADE_LEVEL}</p>
            <p className="text-xs text-slate-400">Crops sell for more.</p>
          </div>
          <button
            onClick={() => buyUpgrade("fertilizer")}
            disabled={progress.fertilizerLevel >= MAX_UPGRADE_LEVEL || progress.coins < upgradeCost(progress.fertilizerLevel)}
            className="ml-auto rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
          >
            {progress.fertilizerLevel >= MAX_UPGRADE_LEVEL ? "Max" : `Upgrade — 🪙${upgradeCost(progress.fertilizerLevel)}`}
          </button>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow">
          <span className="flex h-8 w-8 items-center justify-center text-2xl">🤖</span>
          <div>
            <p className="font-semibold text-slate-700">Auto-Harvester {progress.autoHarvest && "— Owned"}</p>
            <p className="text-xs text-slate-400">Harvests ready crops &amp; animals straight into a barn, even while you&rsquo;re away.</p>
          </div>
          <button
            onClick={() => buyAutomation("harvest")}
            disabled={progress.autoHarvest || progress.coins < AUTO_HARVEST_COST}
            className="ml-auto rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40"
          >
            {progress.autoHarvest ? "Owned" : `Buy — 🪙${AUTO_HARVEST_COST}`}
          </button>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow">
          <span className="flex h-8 w-8 items-center justify-center text-2xl">🌾</span>
          <div>
            <p className="font-semibold text-slate-700">Auto-Planter {progress.autoPlant && "— Owned"}</p>
            <p className="text-xs text-slate-400">Replants the same crop after auto-harvest, as long as you can afford the seed. Needs Auto-Harvester.</p>
          </div>
          <button
            onClick={() => buyAutomation("plant")}
            disabled={progress.autoPlant || !progress.autoHarvest || progress.coins < AUTO_PLANT_COST}
            className="ml-auto rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40"
          >
            {progress.autoPlant ? "Owned" : `Buy — 🪙${AUTO_PLANT_COST}`}
          </button>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-amber-50 p-3 shadow">
          <span className="flex h-8 w-8 items-center justify-center text-2xl">🏚️</span>
          <div>
            <p className="font-semibold text-slate-700">Want more barn storage?</p>
            <p className="text-xs text-slate-500">
              Barns aren&rsquo;t bought here — walk to an empty square on land
              you own and choose &ldquo;Build Barn&rdquo;. It uses up 4 of
              that plot&rsquo;s 9 squares but adds more storage room.
            </p>
          </div>
        </div>

        <button
          onClick={() => setScreen("world")}
          className="rounded-full border-2 border-emerald-600 bg-white px-5 py-2 text-sm font-bold text-emerald-700 shadow hover:bg-emerald-50"
        >
          🚜 Back to farm
        </button>
      </div>
    );
  }

  if (screen === "barn") {
    const items = Object.entries(progress.barn).filter(([, qty]) => qty > 0);
    const basketItems = Object.entries(progress.basket).filter(([, qty]) => qty > 0);
    return (
      <div className="flex flex-col items-center gap-5">
        <p className="text-lg font-bold text-slate-800">🏚️ Barn — {barnUsed} / {barnCapacity}</p>

        <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow">
          <p className="mb-2 text-sm font-semibold text-slate-600">Stored</p>
          {items.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing stored yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {items.map(([itemId, qty]) => {
                const item = getSellableItem(itemId);
                if (!item) return null;
                return (
                  <div key={itemId} className="flex flex-col items-center rounded-lg bg-slate-50 p-2">
                    <span className="text-2xl">{item.emoji}</span>
                    <span className="text-xs font-semibold text-slate-600">{item.name} x{qty}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {basketItems.length > 0 && (
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow">
            <p className="mb-2 text-sm font-semibold text-slate-600">🧺 In your basket</p>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {basketItems.map(([itemId, qty]) => {
                const item = getSellableItem(itemId);
                if (!item) return null;
                return (
                  <div key={itemId} className="flex flex-col items-center rounded-lg bg-slate-50 p-2">
                    <span className="text-2xl">{item.emoji}</span>
                    <span className="text-xs font-semibold text-slate-600">{item.name} x{qty}</span>
                  </div>
                );
              })}
            </div>
            <button
              onClick={depositBasketAction}
              className="w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700"
            >
              Deposit into barn
            </button>
          </div>
        )}

        <button
          onClick={() => setScreen("world")}
          className="rounded-full border-2 border-emerald-600 bg-white px-5 py-2 text-sm font-bold text-emerald-700 shadow hover:bg-emerald-50"
        >
          🚜 Back to farm
        </button>
      </div>
    );
  }

  const nearCellRef = interaction.cell;
  const nearChunk = nearCellRef ? progress.chunks[nearCellRef.chunkIndex] : null;
  const nearCell = nearChunk && nearCellRef ? nearChunk.cells[nearCellRef.cellIndex] : null;
  const nearCellState = nearCell ? cellState(nearCell, progress.wateringLevel, now) : null;
  const anySellable = progress.currentOrders.some((o) => canSellTowardOrder(progress.barn, o));
  // Any barn — the original landmark, or a plot built via "Build Barn" — opens
  // the same shared barn screen, since storage is one pooled inventory.
  const nearAnyBarn = interaction.nearBarn || nearCellState === "barn";

  const actionLabel = nearAnyBarn
    ? basketUsed > 0
      ? "🏚️ Open Barn"
      : "🏚️ Look Inside"
    : nearCellRef
      ? nearCellState === "empty"
        ? "🌱 Plant / Build"
        : nearCellState === "ready"
          ? "✋ Collect"
          : "⏳ Growing…"
      : interaction.nearTable
        ? progress.currentOrders.length === 0
          ? "No customers yet"
          : anySellable
            ? "💰 Sell to a customer"
            : "❌ Nothing to sell yet"
        : "Walk around";

  const canAct =
    nearAnyBarn ||
    (nearCellRef !== null && (nearCellState === "empty" || nearCellState === "ready")) ||
    (interaction.nearTable && anySellable);

  const pickerChunk = cellPicker ? progress.chunks[cellPicker.chunkIndex] : null;
  const pickerBarnAvailable = pickerChunk ? canBuildBarn(pickerChunk) : false;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <span className="text-lg font-bold text-slate-800">🪙 {progress.coins} coins</span>
        <span className="text-sm font-semibold text-slate-500">🧺 {basketUsed}</span>
        <span className="text-sm font-semibold text-slate-500">🏚️ {barnUsed}/{barnCapacity}</span>
        <button
          onClick={() => setScreen("shop")}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Farm Shop
        </button>
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="max-w-full touch-none rounded-xl shadow-lg"
        />
        {toast && (
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-semibold text-white">
            {toast}
          </div>
        )}
        {cellPicker && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 p-4">
            <div className="flex max-h-full w-60 flex-col gap-1 overflow-y-auto rounded-xl bg-white p-3 shadow-lg">
              <p className="mb-1 text-center text-sm font-semibold text-slate-700">What goes here?</p>
              {CROPS.map((c) => {
                const sellsFor = effectiveSellPrice(c, progress.fertilizerLevel);
                return (
                  <button
                    key={c.id}
                    onClick={() => assignCell(cellPicker.chunkIndex, cellPicker.cellIndex, "crop", c.id)}
                    disabled={progress.coins < c.seedCost}
                    className="flex flex-col rounded-lg px-2 py-1 text-left text-sm hover:bg-sky-50 disabled:opacity-40"
                  >
                    <span className="flex items-center justify-between">
                      <span>{c.emoji} {c.name}</span>
                      <span className="text-slate-400">🪙{c.seedCost}</span>
                    </span>
                    <span className="text-xs text-emerald-600">worth 🪙{sellsFor} to the right customer</span>
                  </button>
                );
              })}
              {ANIMALS.map((a: Animal) => {
                const cost = animalCost(a, countAnimalType(progress.chunks, a.id));
                return (
                  <button
                    key={a.id}
                    onClick={() => assignCell(cellPicker.chunkIndex, cellPicker.cellIndex, "animal", a.id)}
                    disabled={progress.coins < cost}
                    className="flex flex-col rounded-lg px-2 py-1 text-left text-sm hover:bg-sky-50 disabled:opacity-40"
                  >
                    <span className="flex items-center justify-between">
                      <span>{a.emoji} {a.name}</span>
                      <span className="text-slate-400">🪙{cost}</span>
                    </span>
                    <span className="text-xs text-emerald-600">makes {a.productEmoji} {a.productName} forever</span>
                  </button>
                );
              })}
              <button
                onClick={() => buildBarnAction(cellPicker.chunkIndex)}
                disabled={!pickerBarnAvailable || progress.coins < BARN_BUILD_COST}
                className="flex flex-col rounded-lg px-2 py-1 text-left text-sm hover:bg-amber-50 disabled:opacity-40"
              >
                <span className="flex items-center justify-between">
                  <span>🏚️ Build Barn (uses 4 squares)</span>
                  <span className="text-slate-400">🪙{BARN_BUILD_COST}</span>
                </span>
                <span className="text-xs text-amber-600">+{20} more barn storage</span>
              </button>
              <button
                onClick={() => setCellPicker(null)}
                className="mt-1 text-xs text-slate-400 underline"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="h-4 text-sm font-semibold text-slate-600">{actionLabel}</p>

      <div className="flex w-full max-w-[720px] items-center justify-between">
        <div className="grid grid-cols-3 grid-rows-2 gap-2">
          <span />
          <TouchBtn label="⬆" onDown={() => pressKey("ArrowUp")} onUp={() => releaseKey("ArrowUp")} />
          <span />
          <TouchBtn label="⬅" onDown={() => pressKey("ArrowLeft")} onUp={() => releaseKey("ArrowLeft")} />
          <TouchBtn label="⬇" onDown={() => pressKey("ArrowDown")} onUp={() => releaseKey("ArrowDown")} />
          <TouchBtn label="➡" onDown={() => pressKey("ArrowRight")} onUp={() => releaseKey("ArrowRight")} />
        </div>
        <TouchBtn label={actionLabel} onDown={handleAction} onUp={() => {}} disabled={!canAct} wide />
      </div>

      <p className="max-w-md text-center text-xs text-slate-400">
        Buy land in the shop, then choose crops, animals, or a barn for each
        square. Collect into your basket and carry it to the barn — or check
        what the customers at the stand are asking for before you sell.
        Arrow keys to move, Space to act.
      </p>
    </div>
  );
}

function TouchBtn({
  label,
  onDown,
  onUp,
  wide,
  disabled,
}: {
  label: string;
  onDown: () => void;
  onUp: () => void;
  wide?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        if (!disabled) onDown();
      }}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      disabled={disabled}
      className={`touch-none select-none ${wide ? "px-6 text-base" : "px-5 text-3xl"} h-16 rounded-2xl bg-white font-bold text-slate-900 shadow active:bg-sky-50 disabled:opacity-40`}
    >
      {label}
    </button>
  );
}
