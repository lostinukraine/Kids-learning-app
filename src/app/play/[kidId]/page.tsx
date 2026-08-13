import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { avatarEmoji } from "@/lib/avatars";
import { GAMES_CATALOG } from "@/lib/games-catalog";
import TimerGate from "@/components/TimerGate";

export default async function KidHomePage({
  params,
}: {
  params: Promise<{ kidId: string }>;
}) {
  const { kidId } = await params;
  const session = await auth();
  const parentId = session?.user?.id;
  if (!parentId) redirect("/login");

  const kid = await prisma.kid.findFirst({ where: { id: kidId, parentId } });
  if (!kid) redirect("/play");

  return (
    <TimerGate kidId={kid.id}>
      <main className="min-h-screen bg-gradient-to-b from-sky-100 to-emerald-50 px-6 py-10">
        <div className="mx-auto flex max-w-4xl flex-col gap-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-5xl">{avatarEmoji(kid.avatar)}</span>
              <h1 className="text-2xl font-extrabold text-slate-800">
                Hi, {kid.name}!
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/play" className="text-sm font-medium text-slate-500">
                Switch profile
              </Link>
              <Link
                href="/dashboard"
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
              >
                👤 Parent dashboard
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            {GAMES_CATALOG.map((game) => (
              <Link
                key={game.slug}
                href={`/play/${kid.id}/${game.slug}`}
                className="flex flex-col items-center gap-2 rounded-3xl bg-white p-6 text-center shadow-md transition hover:scale-105 hover:shadow-lg"
              >
                <span className="text-5xl">{game.emoji}</span>
                <span className="text-lg font-bold text-slate-800">
                  {game.name}
                </span>
                <span className="text-xs text-slate-400">
                  {game.description}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </TimerGate>
  );
}
