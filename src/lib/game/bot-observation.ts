import type { Card, GameState, Player } from "./types";

/** The strategy gets public positions and one seat's knowledge, never the deck. */
export type BotObservation = Pick<GameState,
  "phase" | "round" | "turnsTaken" | "turn" | "pendingPower" | "pendingGives" |
  "discard" | "botKnown" | "botHints" | "botMissedTop"
> & {
  players: Pick<Player, "id" | "seat" | "name" | "isBot" | "isHost" | "difficulty" | "hand">[];
  /** Unobserved faces are absent, including the bot's own unpeeked cards. */
  cards: Partial<Record<string, Card>>;
};

export function observeBot(state: GameState, botId: string): BotObservation {
  const remembered = (state.botKnown[botId] ?? []).filter((id) => !!state.cards[id]);
  const drawn = state.turn?.playerId === botId ? state.turn.drawnCardId : null;
  const power = state.pendingPower?.playerId === botId ? state.pendingPower : null;
  const visible = new Set([...state.discard, ...remembered]);
  if (drawn) visible.add(drawn);
  if (power?.looked) { visible.add(power.looked.a); visible.add(power.looked.b); }
  const cards: BotObservation["cards"] = {};
  for (const id of visible) {
    if (state.cards[id]) cards[id] = { ...state.cards[id] };
  }
  return {
    phase: state.phase,
    round: state.round,
    turnsTaken: state.turnsTaken,
    players: state.players.map(({ id, seat, name, isBot, isHost, difficulty, hand }) => ({
      id, seat, name, isBot, isHost, difficulty, hand: [...hand],
    })),
    cards,
    discard: [...state.discard],
    turn: state.turn ? { ...state.turn, drawnCardId: drawn } : null,
    pendingPower: power ? { ...power, ...(power.looked ? { looked: { ...power.looked } } : {}) } : null,
    pendingGives: state.pendingGives.map((give) => ({ ...give })),
    botKnown: { [botId]: remembered },
    botHints: { ...state.botHints },
    botMissedTop: state.botMissedTop?.[botId] ? { [botId]: state.botMissedTop[botId] } : {},
  };
}
