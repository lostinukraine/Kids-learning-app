"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type TimerState = "loading" | "none" | "active" | "locked";

export default function TimerGate({
  kidId,
  children,
}: {
  kidId: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<TimerState>("loading");
  const [remaining, setRemaining] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/timer/status?kidId=${kidId}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (cancelled) return;
        setState(data.state);
        if (data.state === "active") {
          setRemaining(data.remainingSeconds);
        }
      } catch {
        // network hiccup — keep current state, try again next poll
      }
    }

    poll();
    const pollInterval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(pollInterval);
    };
  }, [kidId]);

  useEffect(() => {
    if (state !== "active") return;
    tickRef.current = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [state]);

  if (state === "loading") {
    return null;
  }

  if (state === "locked") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-800 text-center text-white">
        <span className="text-7xl">⏰</span>
        <h1 className="text-3xl font-bold">Time&rsquo;s up!</h1>
        <p className="text-slate-300">
          Ask a parent to start a new timer to keep playing.
        </p>
        <div className="mt-4 flex gap-3">
          <Link
            href="/play"
            className="rounded-lg bg-white px-4 py-2 font-semibold text-slate-800"
          >
            Back to profiles
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-white px-4 py-2 font-semibold text-white hover:bg-white/10"
          >
            👤 Parent dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      {state === "active" && (
        <div className="fixed right-3 top-3 z-50 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-slate-700 shadow">
          ⏱ {formatTime(remaining)}
        </div>
      )}
      {children}
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
