import { AccountPage } from "@/components/AccountPage";
import { returnPath } from "@/lib/account/navigation";

export default async function MePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const from = (await searchParams).from;
  return <AccountPage back={from === "record" ? "record" : returnPath(from)} />;
}
