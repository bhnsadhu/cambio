import { GameScreen } from "@/components/GameScreen";

export default async function GamePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <GameScreen key={code.toUpperCase()} code={code.toUpperCase()} />;
}
