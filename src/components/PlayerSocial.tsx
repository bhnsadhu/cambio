"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { loginHref } from "@/lib/account/navigation";
import type { SocialHook } from "@/lib/client/social";
import { useTableProfiles } from "@/lib/client/tableProfiles";
import type { PlayerPublic, PublicView } from "@/lib/game/types";
import type { TableProfile } from "@/lib/social/types";
import { RankBadge } from "./RankBadge";
import { Button, buttonClass, Chip } from "./ui";

interface TableSocial {
  code: string;
  social: SocialHook;
  profiles: Record<string, TableProfile>;
}

const TableSocialContext = createContext<TableSocial | null>(null);

/** One metadata read and the table's existing social subscription serve every seat. */
export function TableSocialProvider({ code, view, social, children }: {
  code: string;
  view: PublicView | null;
  social: SocialHook;
  children: ReactNode;
}) {
  const profiles = useTableProfiles(code, view);
  const value = useMemo(() => ({ code, social, profiles }), [code, social, profiles]);
  return <TableSocialContext.Provider value={value}>{children}</TableSocialContext.Provider>;
}

function profileForPlayer(table: TableSocial, profileId: string) {
  return (table.social.profile?.id === profileId ? table.social.profile : null)
    ?? table.social.social.friends.find((friend) => friend.id === profileId)
    ?? table.profiles[profileId];
}

export function PlayerRankBadge({ player }: { player: PlayerPublic }) {
  const table = useContext(TableSocialContext);
  if (!table || player.isBot || !player.profileId) return null;
  const profile = profileForPlayer(table, player.profileId);
  return profile ? <RankBadge points={profile.points} size={20} /> : null;
}

export function PlayerSocial({ player, isMe = false }: { player: PlayerPublic; isMe?: boolean }) {
  const table = useContext(TableSocialContext);
  if (!table || player.isBot || !player.profileId) return null;
  return <AccountSocial key={`${table.social.profile?.id ?? "guest"}:${player.profileId}`} table={table} player={player} profileId={player.profileId} isMe={isMe} />;
}

const actionClass = "h-7! max-w-full px-2.5! text-[11.5px]!";

function AccountSocial({ table, player, profileId, isMe }: { table: TableSocial; player: PlayerPublic; profileId: string; isMe: boolean }) {
  const { code, social } = table;
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: "friend" | "outgoing"; snapshot: SocialHook["social"] } | null>(null);
  const self = isMe || social.profile?.id === profileId;
  const friend = social.social.friends.find((p) => p.id === profileId);
  const incoming = social.social.incoming.find((p) => p.id === profileId);
  const outgoing = social.social.outgoing.find((p) => p.id === profileId);
  const profile = profileForPlayer(table, profileId);
  // If the write succeeds but refreshing fails, retain its confirmed outcome
  // until the next social snapshot arrives instead of offering a second send.
  const relationship = result?.snapshot === social.social ? result.status
    : friend ? "friend" : incoming ? "incoming" : outgoing ? "outgoing" : null;

  const connect = async () => {
    if (working.current || !social.profile || self || (!incoming && !profile?.handle)) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      if (incoming) {
        await social.respond(profileId, true);
        setResult({ status: "friend", snapshot: social.social });
      } else {
        const outcome = await social.addFriend(profile!.handle, profileId);
        setResult({ status: outcome === "accepted" || outcome === "friends" ? "friend" : "outgoing", snapshot: social.social });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this friend. Try again.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  if (self) return null;

  return (
    <div role="group" aria-label={`${player.name}'s social details`} className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      {!social.profile ? (
        <Link href={loginHref(`/g/${code}`)} className={buttonClass({ variant: "ghost", size: "sm", className: actionClass })}>Add friend</Link>
      ) : relationship === "friend" ? (
        <Chip tone="accent">Friend</Chip>
      ) : relationship === "outgoing" ? (
        <span role="status" className="text-[11.5px] leading-4 text-ink-3">Request sent</span>
      ) : (
        <Button variant="ghost" size="sm" className={actionClass} disabled={busy || social.loading || (!incoming && !profile?.handle)} onClick={() => void connect()}>
          {busy ? (incoming ? "Accepting" : "Sending") : incoming ? "Accept friend" : "Add friend"}
        </Button>
      )}
      {error ? <p role="alert" className="w-full break-words text-[11.5px] leading-4 text-red">{error}</p> : null}
    </div>
  );
}
