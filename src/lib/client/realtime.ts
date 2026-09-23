import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PublicView } from "@/lib/game/types";

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}

export type ConnectionStatus = "connecting" | "live" | "offline";

/** Refresh authenticated social data when its opaque signal changes. */
export function subscribeSocial(channelId: string, onChange: () => void, onStatus: (status: ConnectionStatus) => void): () => void {
  const channel = supabase().channel(`social:${channelId}`, { config: { postgres_changes_options: { wait: true } } })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "social_signals", filter: `channel_id=eq.${channelId}` }, onChange)
    .subscribe((status) => {
      onStatus(status === "SUBSCRIBED" ? "live" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting");
    });
  return () => { void supabase().removeChannel(channel); };
}

/**
 * Subscribe to the public projection of one game. Every committed action
 * updates `game_views`, and Postgres Changes streams the new row to every
 * seat within a couple hundred milliseconds — no polling on the hot path.
 */
export function subscribeGame(
  code: string,
  onView: (view: PublicView) => void,
  onStatus: (s: ConnectionStatus) => void,
): () => void {
  const channel = supabase()
    .channel(`game:${code}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "game_views", filter: `code=eq.${code}` },
      (payload) => {
        const row = payload.new as { view?: PublicView };
        if (row.view) onView(row.view);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onStatus("live");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") onStatus("offline");
      else onStatus("connecting");
    });
  return () => {
    supabase().removeChannel(channel);
  };
}
