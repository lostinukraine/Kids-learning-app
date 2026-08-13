import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CELLS_PER_CHUNK,
  addToBasket,
  basketToJson,
  cellSellableItemId,
  cellState,
  chunksToJson,
  collectAnimalCell,
  getSellableItem,
  harvestCropCell,
  type Basket,
  type Chunk,
} from "@/lib/farm";

const bodySchema = z.object({
  kidId: z.string().min(1),
  chunkIndex: z.number().int().min(0),
  cellIndex: z.number().int().min(0).max(CELLS_PER_CHUNK - 1),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const parentId = session?.user?.id;
  if (!parentId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { kidId, chunkIndex, cellIndex } = parsed.data;

  const kid = await prisma.kid.findFirst({ where: { id: kidId, parentId } });
  if (!kid) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const progress = await prisma.farmProgress.findUnique({ where: { kidId } });
  if (!progress) {
    return NextResponse.json({ error: "no farm yet" }, { status: 400 });
  }

  const chunks = progress.chunks as unknown as Chunk[];
  const chunk = chunks[chunkIndex];
  const cell = chunk?.cells[cellIndex];
  if (!cell) {
    return NextResponse.json({ error: "unknown cell" }, { status: 400 });
  }
  if (cellState(cell, progress.wateringLevel, Date.now()) !== "ready") {
    return NextResponse.json({ error: "not ready" }, { status: 400 });
  }
  const itemId = cellSellableItemId(cell);
  const item = itemId ? getSellableItem(itemId) : undefined;
  if (!itemId || !item) {
    return NextResponse.json({ error: "unknown item" }, { status: 400 });
  }

  const nextCell = cell.content === "crop" ? harvestCropCell() : collectAnimalCell(cell);
  const nextChunks = chunks.map((c, ci) =>
    ci !== chunkIndex ? c : { ...c, cells: c.cells.map((cell2, i) => (i === cellIndex ? nextCell : cell2)) },
  );

  // Interactive harvesting always goes to the basket, regardless of owning
  // auto-harvest — see the matching comment in Farm.tsx's harvestCell.
  const basket = progress.basket as unknown as Basket;
  if (addToBasket(basket, itemId, 1) === 0) {
    return NextResponse.json({ error: "basket full" }, { status: 400 });
  }
  const data: Prisma.FarmProgressUpdateInput = { chunks: chunksToJson(nextChunks), basket: basketToJson(basket) };

  const updated = await prisma.farmProgress.update({ where: { kidId }, data });

  return NextResponse.json({ progress: updated });
}
