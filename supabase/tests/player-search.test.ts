import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asClient, createDb, createUser, expectDbError, one, resetState } from "./helpers.ts";

interface Found {
  user_id: string;
  username: string;
  avatar: string;
  rating: number;
  status: "none" | "outgoing" | "incoming" | "friends";
}

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());

let me: string;
beforeEach(async () => {
  await resetState(db);
  me = await createUser(db, "sharif");
  for (const name of ["sharma", "Shark_Bite", "ashar_dev", "sha1", "khasim", "sh_x_y"]) {
    await createUser(db, name);
  }
});

const search = async (query: string, user = me) =>
  (await one<{ r: Found[] }>(db, "select public.search_players($1, $2) as r", [user, query])).r;

describe("player search", () => {
  it("finds names starting with the text first, then names containing it", async () => {
    expect((await search("sha")).map((p) => p.username)).toEqual([
      "sha1",
      "sharma",
      "Shark_Bite",
      "ashar_dev",
    ]);
  });

  it("ignores case and never returns yourself", async () => {
    const found = await search("SHAR");
    expect(found.map((p) => p.username)).toEqual(["sharma", "Shark_Bite", "ashar_dev"]);
    expect(found[0]).toMatchObject({ username: "sharma", rating: 1200, status: "none" });
  });

  it("treats _ as a normal character, not a wildcard", async () => {
    expect((await search("sh_")).map((p) => p.username)).toEqual(["sh_x_y"]);
  });

  it("shows how you stand with each player", async () => {
    const sharma = (await search("sharma"))[0]!.user_id;
    const khasim = (await search("khasim"))[0]!.user_id;
    await db.query("select public.send_friend_request($1, 'sharma')", [me]);
    await db.query("select public.send_friend_request($1, 'sharif')", [khasim]);
    expect((await search("sharma"))[0]!.status).toBe("outgoing");
    expect((await search("khasim"))[0]!.status).toBe("incoming");
    await db.query("select public.respond_friend_request($1, $2, true)", [me, khasim]);
    expect((await search("khasim"))[0]!.status).toBe("friends");
    expect(sharma).toBeTruthy();
  });

  it("returns at most 8 players", async () => {
    for (let i = 0; i < 12; i++) await createUser(db, `player_${i}`);
    expect(await search("player")).toHaveLength(8);
  });

  it("needs 3 to 20 letters, digits or _", async () => {
    await expectDbError(search("sh"), "INVALID_INPUT");
    await expectDbError(search("sh%"), "INVALID_INPUT");
    await expectDbError(search("a".repeat(21)), "INVALID_INPUT");
    expect(await search("zzz")).toEqual([]);
  });

  it("is for the Worker only", async () => {
    await expect(
      asClient(db, me, () => db.query("select public.search_players($1, 'sha')", [me])),
    ).rejects.toThrow(/permission denied/);
  });
});
