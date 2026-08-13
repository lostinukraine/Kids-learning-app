import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  availableOrderItemIds,
  barnToJson,
  basketToJson,
  canSellTowardOrder,
  fillOrders,
  ordersToJson,
  pruneStaleOrders,
  sellTowardOrder,
  type Barn,
  type Basket,
  type Chunk,
  type CustomerOrder,
} from "@/lib/farm";

const bodySchema = z.object({
  kidId: z.string().min(1),
  orderIndex: z.number().int().min(0),
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
  const { kidId, orderIndex } = parsed.data;

  const kid = await prisma.kid.findFirst({ where: { id: kidId, parentId } });
  if (!kid) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const progress = await prisma.farmProgress.findUnique({ where: { kidId } });
  if (!progress) {
    return NextResponse.json({ error: "no farm yet" }, { status: 400 });
  }

  const orders = progress.currentOrders as unknown as CustomerOrder[];
  const order = orders[orderIndex];
  if (!order) {
    return NextResponse.json({ error: "no active order" }, { status: 400 });
  }
  const barn = progress.barn as unknown as Barn;
  const basket = progress.basket as unknown as Basket;
  if (!canSellTowardOrder(barn, basket, order)) {
    return NextResponse.json({ error: "not enough stock" }, { status: 400 });
  }

  const sale = sellTowardOrder(barn, basket, order);

  const chunks = progress.chunks as unknown as Chunk[];
  // A completed order (sale.order === null) drops out of the list; a
  // partially-sold order stays put with its reduced quantity/reward.
  const openOrders = orders.map((o, i) => (i === orderIndex ? sale.order : o)).filter((o): o is CustomerOrder => o !== null);
  const remainingOrders = pruneStaleOrders(openOrders, chunks);
  const nextOrders = fillOrders(remainingOrders, availableOrderItemIds(chunks), Math.random);

  const updated = await prisma.farmProgress.update({
    where: { kidId },
    data: {
      coins: progress.coins + sale.earned,
      barn: barnToJson(sale.barn),
      basket: basketToJson(sale.basket),
      currentOrders: ordersToJson(nextOrders),
    },
  });

  return NextResponse.json({ progress: updated, earned: sale.earned });
}
