import { Leaderboard } from "@/components/Leaderboard";

export const metadata = { title: "Leaderboard | Cambio" };

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope } = await searchParams;
  return <Leaderboard initialScope={scope === "all" || scope === "friends" ? scope : null} />;
}
