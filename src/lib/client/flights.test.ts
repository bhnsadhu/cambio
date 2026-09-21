import { describe, expect, it } from "vitest";
import { land, NOTHING_FLYING, takeFlights, type FlightSpec } from "./flights";

/**
 * The bookkeeping for cards crossing the table. The rest of the flight layer
 * is DOM work; this is the part that decides what is in the air, and getting
 * it wrong shows up as a movement played twice.
 */

const spec = (version: number, card: string, to = `slot:p1:0`): FlightSpec =>
  ({ id: `${version}:${card}`, from: "deck", to, face: null, delay: 0, duration: 280 });

/** A round's deal: sixteen cards from the deck into four hands. */
const deal = (version: number): FlightSpec[] =>
  Array.from({ length: 16 }, (_, i) => spec(version, `c${i}`, `slot:p${i % 4}:${Math.floor(i / 4)}`));

describe("what is in the air", () => {
  it("takes up a batch once", () => {
    const batch = deal(2);
    const air = takeFlights(NOTHING_FLYING, batch, "peek");
    expect(air.list).toHaveLength(16);
    // The same batch offered again is already spoken for.
    expect(takeFlights(air, batch, "peek")).toBe(air);
  });

  it("does not deal the round a second time when the peek ends", () => {
    // The phase moves a render before the specs that belong with it do, so
    // the batch on hand at the peek's end is still the deal that has already
    // flown and landed. Changing phase must not put it back in the air.
    const batch = deal(2);
    const dealt = takeFlights(NOTHING_FLYING, batch, "peek");
    const landed = land(dealt, new Set(batch.map((s) => s.id)));
    expect(landed.list).toHaveLength(0);

    const playing = takeFlights(landed, batch, "playing");
    expect(playing.list).toHaveLength(0);
    expect(playing.phase).toBe("playing");

    // And the empty batch that arrives on the next render changes nothing.
    expect(takeFlights(playing, [], "playing").list).toHaveLength(0);
  });

  it("keeps a card that is still in the air when the phase changes", () => {
    const batch = [spec(4, "c1", "slot:p2:1")];
    const air = takeFlights(NOTHING_FLYING, batch, "playing");
    expect(takeFlights(air, batch, "final").list).toEqual(batch);
  });

  it("clears the air at a round boundary", () => {
    const air = takeFlights(NOTHING_FLYING, deal(2), "peek");
    expect(takeFlights(air, [], "scoring").list).toHaveLength(0);
    expect(takeFlights(air, [], "lobby").list).toHaveLength(0);
  });

  it("a card moving again replaces its own flight rather than doubling it", () => {
    const first = takeFlights(NOTHING_FLYING, [spec(4, "c1", "slot:p2:1")], "playing");
    const again = takeFlights(first, [spec(5, "c1", "discard")], "playing");
    expect(again.list).toHaveLength(1);
    expect(again.list[0].id).toBe("5:c1");
  });

  it("leaves other cards alone while one of them moves again", () => {
    const first = takeFlights(NOTHING_FLYING, [spec(4, "c1"), spec(4, "c2", "slot:p3:0")], "playing");
    const again = takeFlights(first, [spec(5, "c1", "discard")], "playing");
    expect(again.list.map((s) => s.id).sort()).toEqual(["4:c2", "5:c1"]);
  });

  it("a landing nobody is waiting on changes nothing", () => {
    const air = takeFlights(NOTHING_FLYING, [spec(4, "c1")], "playing");
    expect(land(air, new Set(["9:nope"]))).toBe(air);
  });
});
