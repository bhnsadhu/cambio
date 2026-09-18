import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase access.
 *
 * The server uses the same anon key as the browser; what sets it apart is
 * `CAMBIO_SERVER_SECRET`, which every `game_*` RPC verifies inside a
 * SECURITY DEFINER function before touching the secret `games` table. The
 * browser never sees this secret and can only read the public projection.
 */

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

let client: RpcClient | null = null;

function supabase(): RpcClient {
  if (!client) {
    client = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }) as unknown as RpcClient;
  }
  return client;
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, { p_secret: env("CAMBIO_SERVER_SECRET"), ...args });
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
