import { AccountAccess } from "@/components/AccountAccess";
import { returnPath } from "@/lib/account/navigation";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; mode?: string }> }) {
  const query = await searchParams;
  return <AccountAccess next={returnPath(query.next)} initialMode={query.mode === "register" ? "register" : "login"} />;
}
