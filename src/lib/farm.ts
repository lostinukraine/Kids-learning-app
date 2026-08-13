import type { Prisma } from "@prisma/client";

export interface Crop {
  id: string;
  name: string;
  emoji: string;
  seedCost: number;
  growTimeMs: number;
  sellPrice: number;
  tier: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Idle-farm pacing: crops take real minutes-to-hours to grow, so there's a
// reason to plant, go do something else (another game, come back later),
// and return to collect — rather than a plot cycling in under a minute.
// tier gates which items customers can ask for (see unlockedTierForChunks) —
// kids start out only ever getting orders for tier-1 carrot/corn so the
// economy ramps up instead of opening with a pumpkin request.
export const CROPS: Crop[] = [
  { id: "carrot", name: "Carrot", emoji: "🥕", seedCost: 5, growTimeMs: 5 * MINUTE, sellPrice: 12, tier: 1 },
  { id: "corn", name: "Corn", emoji: "🌽", seedCost: 15, growTimeMs: 20 * MINUTE, sellPrice: 38, tier: 1 },
  { id: "pumpkin", name: "Pumpkin", emoji: "🎃", seedCost: 40, growTimeMs: HOUR, sellPrice: 100, tier: 2 },
  { id: "strawberry", name: "Strawberry", emoji: "🍓", seedCost: 80, growTimeMs: 4 * HOUR, sellPrice: 220, tier: 3 },
];

export function getCrop(cropId: string): Crop | undefined {
  return CROPS.find((c) => c.id === cropId);
}

export const MAX_UPGRADE_LEVEL = 4;

export function upgradeCost(currentLevel: number): number {
  return currentLevel * 50;
}

// Watering Can: each level shortens grow time by 10%.
export function growTimeMultiplier(wateringLevel: number): number {
  return 1 - (wateringLevel - 1) * 0.1;
}

// Fertilizer: each level raises sell price by 10%.
export function sellPriceMultiplier(fertilizerLevel: number): number {
  return 1 + (fertilizerLevel - 1) * 0.1;
}

export function effectiveGrowTimeMs(crop: Crop, wateringLevel: number): number {
  return Math.round(crop.growTimeMs * growTimeMultiplier(wateringLevel));
}

export function effectiveSellPrice(crop: Crop, fertilizerLevel: number): number {
  return Math.round(crop.sellPrice * sellPriceMultiplier(fertilizerLevel));
}

// ---- Animals ----
// An animal is a one-time purchase that, once placed on a cell, produces
// its good on a repeating timer forever — unlike a crop, collecting it
// doesn't clear the cell or cost anything to "replant".
export interface Animal {
  id: string;
  name: string;
  emoji: string;
  purchaseCost: number;
  cycleTimeMs: number;
  productId: string;
  productName: string;
  productEmoji: string;
  sellPrice: number;
  tier: number;
}

export const ANIMALS: Animal[] = [
  {
    id: "chicken", name: "Chicken", emoji: "🐔", purchaseCost: 100, cycleTimeMs: 10 * MINUTE,
    productId: "egg", productName: "Egg", productEmoji: "🥚", sellPrice: 15, tier: 2,
  },
  {
    id: "cow", name: "Cow", emoji: "🐄", purchaseCost: 250, cycleTimeMs: 30 * MINUTE,
    productId: "milk", productName: "Milk", productEmoji: "🥛", sellPrice: 40, tier: 3,
  },
  {
    id: "sheep", name: "Sheep", emoji: "🐑", purchaseCost: 400, cycleTimeMs: HOUR,
    productId: "wool", productName: "Wool", productEmoji: "🧶", sellPrice: 80, tier: 3,
  },
];

export function getAnimal(animalId: string): Animal | undefined {
  return ANIMALS.find((a) => a.id === animalId);
}

// ---- Unified sellable items (crops + animal products) ----
export interface SellableItem {
  id: string;
  name: string;
  emoji: string;
  sellPrice: number;
}

export function getSellableItem(itemId: string): SellableItem | undefined {
  const crop = getCrop(itemId);
  if (crop) return crop;
  const animal = ANIMALS.find((a) => a.productId === itemId);
  if (animal) {
    return { id: animal.productId, name: animal.productName, emoji: animal.productEmoji, sellPrice: animal.sellPrice };
  }
  return undefined;
}

// ---- World: a grid of purchasable 3x3 chunks ----
// The world grows in every direction, not just one line: each purchased
// chunk of land is a 3x3 block of 9 individually-assignable cells (crop,
// animal, or contributing toward a barn), and chunks themselves are placed
// around the starting chunk (origin) in a ring — buy more, walk farther.
export type CellContent = "empty" | "crop" | "animal" | "barn";

export interface Cell {
  content: CellContent;
  itemId: string | null; // crop id or animal id; null for empty/barn
  timestamp: string | null; // plantedAt / producedAt; null for empty/barn
}

export interface Chunk {
  cx: number;
  cy: number;
  cells: Cell[]; // always CELLS_PER_CHUNK long
}

export const CHUNK_SIZE = 3;
export const CELLS_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;

// Fixed expansion order (origin, then the 8 chunks surrounding it) — every
// new chunk purchase reveals the next one in this ring, so land grows
// outward in every direction instead of along one line.
export const CHUNK_OFFSETS: [number, number][] = [
  [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1],
];
export const MAX_CHUNKS = CHUNK_OFFSETS.length;

export function emptyCell(): Cell {
  return { content: "empty", itemId: null, timestamp: null };
}

export function emptyChunk(cx: number, cy: number): Chunk {
  return { cx, cy, cells: Array.from({ length: CELLS_PER_CHUNK }, emptyCell) };
}

export function initialChunks(): Chunk[] {
  const [cx, cy] = CHUNK_OFFSETS[0];
  return [emptyChunk(cx, cy)];
}

export function chunkCost(ownedCount: number): number {
  return 120 + ownedCount * 90;
}

export type CellStatus = "empty" | "growing" | "ready" | "barn";

function cellDurationMs(cell: Cell, wateringLevel: number): number | null {
  if (cell.content === "crop" && cell.itemId) {
    const crop = getCrop(cell.itemId);
    return crop ? effectiveGrowTimeMs(crop, wateringLevel) : null;
  }
  if (cell.content === "animal" && cell.itemId) {
    const animal = getAnimal(cell.itemId);
    return animal ? animal.cycleTimeMs : null;
  }
  return null;
}

export function cellState(cell: Cell, wateringLevel: number, now: number): CellStatus {
  if (cell.content === "barn") return "barn";
  if (cell.content === "empty" || !cell.itemId || !cell.timestamp) return "empty";
  const duration = cellDurationMs(cell, wateringLevel);
  if (duration == null) return "empty";
  const readyAt = new Date(cell.timestamp).getTime() + duration;
  return now >= readyAt ? "ready" : "growing";
}

export function cellProgress(cell: Cell, wateringLevel: number, now: number): number {
  if (cell.content === "empty" || cell.content === "barn" || !cell.itemId || !cell.timestamp) return 0;
  const duration = cellDurationMs(cell, wateringLevel);
  if (!duration) return 0;
  const elapsed = now - new Date(cell.timestamp).getTime();
  return Math.max(0, Math.min(1, elapsed / duration));
}

// The item a ready/growing cell will yield when collected — the crop
// itself, or the animal's product (not the animal).
export function cellSellableItemId(cell: Cell): string | null {
  if (cell.content === "crop" && cell.itemId) return cell.itemId;
  if (cell.content === "animal" && cell.itemId) {
    const animal = getAnimal(cell.itemId);
    return animal ? animal.productId : null;
  }
  return null;
}

export function plantCell(content: "crop" | "animal", itemId: string): Cell {
  return { content, itemId, timestamp: new Date().toISOString() };
}

// Harvesting a crop clears the cell back to empty (must replant). Collecting
// an animal keeps it in place and just resets its cycle — it was a one-time
// purchase, not a consumable.
export function harvestCropCell(): Cell {
  return emptyCell();
}

export function collectAnimalCell(cell: Cell): Cell {
  return { ...cell, timestamp: new Date().toISOString() };
}

export function emptyCellIndices(chunk: Chunk): number[] {
  return chunk.cells.reduce<number[]>((acc, c, i) => {
    if (c.content === "empty") acc.push(i);
    return acc;
  }, []);
}

// ---- Barns: built by dedicating 4 of a chunk's 9 cells ----
// A barn's physical footprint stays fixed (4 cells) — upgrading storage
// means building another barn elsewhere, not making an existing one bigger.
export const BARN_CELLS_REQUIRED = 4;
export const BARN_BUILD_COST = 300;
export const BARN_CAPACITY_PER_BUILD = 20;
export const BASE_BARN_CAPACITY = 20; // the original barn, already standing at spawn

export function canBuildBarn(chunk: Chunk): boolean {
  return emptyCellIndices(chunk).length >= BARN_CELLS_REQUIRED;
}

export function buildBarn(chunk: Chunk): Chunk {
  const indices = new Set(emptyCellIndices(chunk).slice(0, BARN_CELLS_REQUIRED));
  const cells = chunk.cells.map((c, i) => (indices.has(i) ? { content: "barn" as const, itemId: null, timestamp: null } : c));
  return { ...chunk, cells };
}

export function totalBarnCapacity(chunks: Chunk[]): number {
  const barnCells = chunks.reduce((sum, chunk) => sum + chunk.cells.filter((c) => c.content === "barn").length, 0);
  const builtBarns = Math.floor(barnCells / BARN_CELLS_REQUIRED);
  return BASE_BARN_CAPACITY + builtBarns * BARN_CAPACITY_PER_BUILD;
}

// Cost of the next individual animal of this type (rises with how many are
// already placed across every chunk).
export function countAnimalType(chunks: Chunk[], animalId: string): number {
  return chunks.reduce(
    (sum, chunk) => sum + chunk.cells.filter((c) => c.content === "animal" && c.itemId === animalId).length,
    0,
  );
}

export function animalCost(animal: Animal, currentCount: number): number {
  return animal.purchaseCost + currentCount * Math.round(animal.purchaseCost * 0.3);
}

// ---- Barn storage ----
export type Barn = Record<string, number>;

export function barnTotal(barn: Barn): number {
  return Object.values(barn).reduce((sum, n) => sum + n, 0);
}

// Adds one unit of itemId to the barn, respecting capacity. Returns whether
// it fit (callers use this to decide whether a harvest/collection actually
// happened, or the item stays on the plant/pen waiting for room).
export function addToBarn(barn: Barn, itemId: string, capacity: number): boolean {
  if (barnTotal(barn) >= capacity) return false;
  barn[itemId] = (barn[itemId] ?? 0) + 1;
  return true;
}

// ---- Basket ----
// Without auto-harvest, harvesting/collecting doesn't go straight into the
// barn — it goes into the basket the kid is physically carrying, which has
// to be walked over to a barn and deposited. Auto-harvest skips the basket
// entirely and deposits straight into a barn (that's the whole point of
// buying it). Capped so a barn trip is still eventually required, but high
// enough for a good long harvesting run without needing one.
export type Basket = Record<string, number>;
export const BASKET_CAPACITY = 100;

export function basketTotal(basket: Basket): number {
  return Object.values(basket).reduce((sum, n) => sum + n, 0);
}

export function addToBasket(basket: Basket, itemId: string, quantity: number): number {
  const room = Math.max(0, BASKET_CAPACITY - basketTotal(basket));
  const added = Math.min(room, quantity);
  if (added > 0) basket[itemId] = (basket[itemId] ?? 0) + added;
  return added;
}

// Moves as much of the basket into the barn as fits, leaving any overflow
// (barn full) still in the basket.
export function depositBasket(basket: Basket, barn: Barn, capacity: number): { basket: Basket; barn: Barn } {
  const nextBasket: Basket = { ...basket };
  const nextBarn: Barn = { ...barn };
  for (const [itemId, qty] of Object.entries(basket)) {
    const room = Math.max(0, capacity - barnTotal(nextBarn));
    const added = Math.min(room, qty);
    if (added > 0) nextBarn[itemId] = (nextBarn[itemId] ?? 0) + added;
    if (added >= qty) delete nextBasket[itemId];
    else nextBasket[itemId] = qty - added;
  }
  return { basket: nextBasket, barn: nextBarn };
}

export function basketToJson(basket: Basket): Prisma.InputJsonValue {
  return basket as unknown as Prisma.InputJsonValue;
}

// ---- Customer orders ----
// Selling only ever happens by fulfilling a customer's order — there's no
// "just sell whatever" option, and orders are only ever created or
// fulfilled from an explicit in-session action (never during the offline
// auto-harvest/auto-plant catch-up below). Up to MAX_CUSTOMERS wait at the
// stand at once.
export interface CustomerOrder {
  itemId: string;
  quantity: number;
  reward: number;
  createdAt: string;
}

export const MAX_CUSTOMERS = 3;
const ORDER_REWARD_MULTIPLIER = 1.4;

// How much land a kid owns is a simple stand-in for "how long they've been
// playing" — orders only draw from tier 1 (carrot, corn) until more land is
// bought, so the very first customers are always easy, then harder/pricier
// items phase in as the farm grows instead of showing up from turn one.
export function unlockedTierForChunks(chunkCount: number): number {
  if (chunkCount >= 3) return 3;
  if (chunkCount >= 2) return 2;
  return 1;
}

function itemTier(itemId: string): number {
  const crop = getCrop(itemId);
  if (crop) return crop.tier;
  const animal = ANIMALS.find((a) => a.productId === itemId);
  return animal?.tier ?? 1;
}

// Cheap tier-1 items only ever get asked for 1-2 at a time; pricier/slower
// items can ask for more since they're worth the wait.
function maxQuantityForTier(tier: number): number {
  if (tier >= 3) return 4;
  if (tier === 2) return 3;
  return 2;
}

// The full set of item ids customer orders may currently draw from: crops
// unlocked by land owned, plus products of animals the kid actually owns.
export function availableOrderItemIds(chunks: Chunk[]): string[] {
  const tier = unlockedTierForChunks(chunks.length);
  return [
    ...CROPS.filter((c) => c.tier <= tier).map((c) => c.id),
    ...ANIMALS.filter((a) => a.tier <= tier && countAnimalType(chunks, a.id) > 0).map((a) => a.productId),
  ];
}

export function generateOrder(availableItemIds: string[], rand: () => number): CustomerOrder | null {
  if (availableItemIds.length === 0) return null;
  const itemId = availableItemIds[Math.floor(rand() * availableItemIds.length)];
  const item = getSellableItem(itemId);
  if (!item) return null;
  const maxQuantity = maxQuantityForTier(itemTier(itemId));
  const quantity = 1 + Math.floor(rand() * maxQuantity);
  const reward = Math.round(item.sellPrice * quantity * ORDER_REWARD_MULTIPLIER);
  return { itemId, quantity, reward, createdAt: new Date().toISOString() };
}

// Drops any order that no longer fits the current tier rules — e.g. an
// account that already had orders sitting from before tiers existed, or
// from before more land was bought, could otherwise keep asking for a
// pumpkin x4 forever since orders only ever get topped up, never replaced.
export function pruneStaleOrders(orders: CustomerOrder[], chunks: Chunk[]): CustomerOrder[] {
  const available = new Set(availableOrderItemIds(chunks));
  return orders.filter((o) => available.has(o.itemId) && o.quantity <= maxQuantityForTier(itemTier(o.itemId)));
}

// Tops the order list back up to MAX_CUSTOMERS.
export function fillOrders(existing: CustomerOrder[], availableItemIds: string[], rand: () => number): CustomerOrder[] {
  const orders = [...existing];
  while (orders.length < MAX_CUSTOMERS) {
    const order = generateOrder(availableItemIds, rand);
    if (!order) break;
    orders.push(order);
  }
  return orders;
}

export function canFulfillOrder(barn: Barn, order: CustomerOrder): boolean {
  return (barn[order.itemId] ?? 0) >= order.quantity;
}

// A kid can sell toward an order with however much of the item they've got
// — they don't have to wait until they've grown the full quantity a
// customer asked for. Selling less than the full order pays out the same
// per-unit rate and leaves the order open for the rest at a reduced
// quantity/reward; selling the full remaining amount completes it (caller
// should drop the order from the list when result.order is null).
//
// Counts basket contents alongside the barn's — the barn can sit at total
// capacity with items no current order wants, which would otherwise leave a
// freshly-harvested, order-matching item stuck in the basket with no room to
// deposit it and no way to sell it either.
export function canSellTowardOrder(barn: Barn, basket: Basket, order: CustomerOrder): boolean {
  return (barn[order.itemId] ?? 0) + (basket[order.itemId] ?? 0) > 0;
}

export function sellTowardOrder(
  barn: Barn,
  basket: Basket,
  order: CustomerOrder,
): { barn: Barn; basket: Basket; order: CustomerOrder | null; earned: number } {
  const barnHave = barn[order.itemId] ?? 0;
  const basketHave = basket[order.itemId] ?? 0;
  const have = barnHave + basketHave;
  const amount = Math.min(have, order.quantity);
  if (amount <= 0) return { barn, basket, order, earned: 0 };

  // Draw from the barn first, then the basket for any remainder.
  const fromBarn = Math.min(barnHave, amount);
  const fromBasket = amount - fromBarn;

  const nextBarn = { ...barn };
  if (fromBarn > 0) {
    nextBarn[order.itemId] = barnHave - fromBarn;
    if (nextBarn[order.itemId] <= 0) delete nextBarn[order.itemId];
  }
  const nextBasket = { ...basket };
  if (fromBasket > 0) {
    nextBasket[order.itemId] = basketHave - fromBasket;
    if (nextBasket[order.itemId] <= 0) delete nextBasket[order.itemId];
  }

  const perUnit = order.reward / order.quantity;
  if (amount >= order.quantity) {
    return { barn: nextBarn, basket: nextBasket, order: null, earned: order.reward };
  }
  const earned = Math.round(perUnit * amount);
  const remainingQuantity = order.quantity - amount;
  return {
    barn: nextBarn,
    basket: nextBasket,
    order: { ...order, quantity: remainingQuantity, reward: Math.round(perUnit * remainingQuantity) },
    earned,
  };
}

export function ordersToJson(orders: CustomerOrder[]): Prisma.InputJsonValue {
  return orders as unknown as Prisma.InputJsonValue;
}

// ---- Automation (auto-harvest / auto-plant) ----
// Deliberately "super expensive" one-time purchases per the design brief —
// these are meant to be a late-game payoff, not an early convenience.
export const AUTO_HARVEST_COST = 500;
export const AUTO_PLANT_COST = 750; // requires auto-harvest already owned

// ---- Offline catch-up simulation ----
// Auto-harvest/auto-plant are allowed to run while the kid is away (that's
// the point of automation), but nothing is ever sold except through an
// explicit fulfillOrder action taken during an active session — this
// function only ever grows the barn/replants, never touches coins via a
// sale or generates/fulfills orders.
export interface FarmAutoState {
  coins: number;
  wateringLevel: number;
  autoHarvest: boolean;
  autoPlant: boolean;
  chunks: Chunk[];
  barn: Barn;
}

const MAX_AUTO_CYCLES_PER_CELL = 200; // safety bound, not a balance lever

export function simulateAutoCycles(state: FarmAutoState, nowMs: number): FarmAutoState {
  if (!state.autoHarvest) return state;

  const capacity = totalBarnCapacity(state.chunks);
  let coins = state.coins;
  const barn: Barn = { ...state.barn };
  const chunks = state.chunks.map((chunk) => ({ ...chunk, cells: chunk.cells.map((c) => ({ ...c })) }));

  for (const chunk of chunks) {
    for (const cell of chunk.cells) {
      for (let i = 0; i < MAX_AUTO_CYCLES_PER_CELL; i++) {
        if (cell.content === "crop" && cell.itemId && cell.timestamp) {
          const crop = getCrop(cell.itemId);
          if (!crop) break;
          const readyAt = new Date(cell.timestamp).getTime() + effectiveGrowTimeMs(crop, state.wateringLevel);
          if (readyAt > nowMs) break;
          if (!addToBarn(barn, crop.id, capacity)) break; // barn full — leave it standing ready
          if (state.autoPlant && coins >= crop.seedCost) {
            coins -= crop.seedCost;
            cell.timestamp = new Date(readyAt).toISOString();
          } else {
            cell.content = "empty";
            cell.itemId = null;
            cell.timestamp = null;
            break;
          }
        } else if (cell.content === "animal" && cell.itemId && cell.timestamp) {
          const animal = getAnimal(cell.itemId);
          if (!animal) break;
          const readyAt = new Date(cell.timestamp).getTime() + animal.cycleTimeMs;
          if (readyAt > nowMs) break;
          if (!addToBarn(barn, animal.productId, capacity)) break;
          cell.timestamp = new Date(readyAt).toISOString();
        } else {
          break;
        }
      }
    }
  }

  return { ...state, coins, barn, chunks };
}

// Prisma's Json input type wants each array/object element to satisfy an
// indexed InputJsonObject shape, which plain named interfaces don't
// structurally match — bridge it here once instead of casting at every
// call site.
export function chunksToJson(chunks: Chunk[]): Prisma.InputJsonValue {
  return chunks as unknown as Prisma.InputJsonValue;
}

export function barnToJson(barn: Barn): Prisma.InputJsonValue {
  return barn as unknown as Prisma.InputJsonValue;
}
