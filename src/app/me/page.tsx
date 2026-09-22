import { AccountPage } from "@/components/AccountPage";
import { returnPath } from "@/lib/account/navigation";

export default async function MePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  return <AccountPage back={returnPath((await searchParams).from)} />;
}
