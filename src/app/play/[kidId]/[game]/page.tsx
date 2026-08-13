import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getGame, isGameAvailable } from "@/lib/games-catalog";
import { tierForGrade } from "@/lib/grade-tiers";
import TimerGate from "@/components/TimerGate";
import GameShell from "@/components/GameShell";

export default async function GamePage({
  params,
}: {
  params: Promise<{ kidId: string; game: string }>;
}) {
  const { kidId, game } = await params;
  const session = await auth();
  const parentId = session?.user?.id;
  if (!parentId) redirect("/login");

  const kid = await prisma.kid.findFirst({ where: { id: kidId, parentId } });
  if (!kid) redirect("/play");

  const entry = getGame(game);
  if (!entry) notFound();
  // A bookmarked/direct URL could still point at a game hidden from this
  // kid's grade range (see games-catalog.ts) — the tile list already
  // filters these out, but re-check here too rather than trusting the URL.
  if (!isGameAvailable(entry, kid.mathGradeLevel, kid.readingGradeLevel)) redirect(`/play/${kid.id}`);

  return (
    <TimerGate kidId={kid.id}>
      <GameShell
        kidId={kid.id}
        slug={entry.slug}
        gameName={entry.name}
        mathTier={tierForGrade(kid.mathGradeLevel)}
        mathGrade={kid.mathGradeLevel}
        readingGrade={kid.readingGradeLevel}
      />
    </TimerGate>
  );
}
