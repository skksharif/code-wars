import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, createDb, createUser, expectDbError, findMatch, one, resetState } from "./helpers.ts";

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());
beforeEach(() => resetState(db));

describe("sign-up", () => {
  it("creates a profile with rating 1200", async () => {
    const id = await createUser(db, "alice");
    const profile = await one<{ username: string; rating: number; wins: number }>(
      db,
      "select username, rating, wins from public.profiles where id = $1",
      [id],
    );
    expect(profile).toEqual({ username: "alice", rating: 1200, wins: 0 });
  });

  it("rejects invalid usernames", async () => {
    await expectDbError(createUser(db, "ab"), "INVALID_USERNAME");
    await expectDbError(createUser(db, "has space"), "INVALID_USERNAME");
    await expectDbError(createUser(db, "<script>"), "INVALID_USERNAME");
    await expectDbError(
      db.query("insert into auth.users (email) values ('nobody@example.test')"),
      "INVALID_USERNAME",
    );
  });

  it("rejects duplicate usernames regardless of case", async () => {
    await createUser(db, "Alice");
    await expectDbError(createUser(db, "alice"), "USERNAME_TAKEN");
  });

  it("reports username availability", async () => {
    await createUser(db, "Alice");
    const check = async (name: string) =>
      (await one<{ ok: boolean }>(db, "select public.is_username_available($1) as ok", [name])).ok;
    expect(await check("ALICE")).toBe(false);
    expect(await check("bob")).toBe(true);
    expect(await check("no")).toBe(false);
  });
});

describe("matchmaking", () => {
  it("queues the first player and matches the second", async () => {
    const a = await createUser(db, "alice");
    const b = await createUser(db, "bob");

    const first = await findMatch(db, a);
    expect(first.status).toBe("queued");

    const second = await findMatch(db, b);
    expect(second.status).toBe("matched");

    const players = await all<{ user_id: string; rating_before: number; is_active: boolean }>(
      db,
      "select user_id, rating_before, is_active from public.battle_players where battle_id = $1",
      [second.battle_id],
    );
    expect(players.map((p) => p.user_id).sort()).toEqual([a, b].sort());
    expect(players.every((p) => p.is_active && p.rating_before === 1200)).toBe(true);

    const queue = await all(db, "select 1 from public.matchmaking_queue");
    expect(queue).toHaveLength(0);
  });

  it("tells the waiting player about the battle on their next heartbeat", async () => {
    const a = await createUser(db, "alice");
    const b = await createUser(db, "bob");
    await findMatch(db, a);
    const matched = await findMatch(db, b);
    expect(await findMatch(db, a)).toEqual({ status: "matched", battle_id: matched.battle_id });
  });

  it("uses database time: 10 s get-ready, then 15 minutes", async () => {
    const a = await createUser(db, "alice");
    const b = await createUser(db, "bob");
    await findMatch(db, a);
    const { battle_id } = await findMatch(db, b);
    const timing = await one<{ ready: number; length: number }>(
      db,
      `select extract(epoch from (starts_at - created_at))::int as ready,
              extract(epoch from (ends_at - starts_at))::int as length
       from public.battles where id = $1`,
      [battle_id],
    );
    expect(timing).toEqual({ ready: 10, length: 900 });
  });

  it("does not match players more than 100 apart at first", async () => {
    const a = await createUser(db, "alice", 1200);
    const b = await createUser(db, "bob", 1350);
    await findMatch(db, a);
    expect((await findMatch(db, b)).status).toBe("queued");
  });

  it("widens the window by 50 every 10 seconds for both players", async () => {
    const a = await createUser(db, "alice", 1200);
    const b = await createUser(db, "bob", 1350);
    await findMatch(db, a);
    await findMatch(db, b);

    // Only one of them has waited long enough: still no match.
    await db.query(
      "update public.matchmaking_queue set joined_at = now() - interval '10 seconds' where user_id = $1",
      [a],
    );
    expect((await findMatch(db, a)).status).toBe("queued");

    await db.query(
      "update public.matchmaking_queue set joined_at = now() - interval '10 seconds' where user_id = $1",
      [b],
    );
    expect((await findMatch(db, a)).status).toBe("matched");
  });

  it("prefers the closest-rated opponent", async () => {
    const far = await createUser(db, "far", 1100);
    const near = await createUser(db, "near", 1210);
    const me = await createUser(db, "mia", 1200);
    await findMatch(db, far);
    await findMatch(db, near);
    const { battle_id } = await findMatch(db, me);
    const opponents = await all<{ user_id: string }>(
      db,
      "select user_id from public.battle_players where battle_id = $1 and user_id <> $2",
      [battle_id, me],
    );
    expect(opponents).toEqual([{ user_id: near }]);
  });

  it("ignores opponents whose heartbeat stopped", async () => {
    const a = await createUser(db, "alice");
    const b = await createUser(db, "bob");
    await findMatch(db, a);
    await db.exec(
      "update public.matchmaking_queue set heartbeat_at = now() - interval '16 seconds'",
    );
    expect((await findMatch(db, b)).status).toBe("queued");
    const queue = await all<{ user_id: string }>(
      db,
      "select user_id from public.matchmaking_queue",
    );
    expect(queue).toEqual([{ user_id: b }]);
  });

  it("times out after 60 seconds in the queue", async () => {
    const a = await createUser(db, "alice");
    await findMatch(db, a);
    await db.exec("update public.matchmaking_queue set joined_at = now() - interval '61 seconds'");
    expect((await findMatch(db, a)).status).toBe("timeout");
    expect(await all(db, "select 1 from public.matchmaking_queue")).toHaveLength(0);
  });

  it("cancels", async () => {
    const a = await createUser(db, "alice");
    const b = await createUser(db, "bob");
    await findMatch(db, a);
    await db.query("select public.cancel_matchmaking($1)", [a]);
    expect((await findMatch(db, b)).status).toBe("queued");
  });

  it("returns the existing battle instead of creating a second one", async () => {
    const a = await createUser(db, "alice");
    const b = await createUser(db, "bob");
    const c = await createUser(db, "carol");
    await findMatch(db, a);
    const { battle_id } = await findMatch(db, b);
    await findMatch(db, c);

    expect(await findMatch(db, a)).toEqual({ status: "matched", battle_id });
    const count = await one<{ n: number }>(db, "select count(*)::int as n from public.battles");
    expect(count.n).toBe(1);
  });

  it("makes a second active battle impossible at the database level", async () => {
    const a = await createUser(db, "alice");
    const b = await createUser(db, "bob");
    await findMatch(db, a);
    const { battle_id } = await findMatch(db, b);
    const other = await one<{ id: string }>(
      db,
      `insert into public.battles (problem_id, starts_at, ends_at)
       select problem_id, starts_at, ends_at from public.battles where id = $1 returning id`,
      [battle_id],
    );
    await expectDbError(
      db.query(
        "insert into public.battle_players (battle_id, user_id, rating_before) values ($1, $2, 1200)",
        [other.id, a],
      ),
      "battle_players_one_active_per_user",
    );
  });

  it("picks an easy problem for 1200-rated players and avoids repeats", async () => {
    const a = await createUser(db, "alice");
    const b = await createUser(db, "bob");
    const seen = new Set<string>();
    for (let round = 0; round < 6; round++) {
      await findMatch(db, a);
      const { battle_id } = await findMatch(db, b);
      const problem = await one<{ slug: string; difficulty: string }>(
        db,
        `select p.slug, p.difficulty from public.battles b
         join public.problems p on p.id = b.problem_id where b.id = $1`,
        [battle_id],
      );
      expect(problem.difficulty).toBe("easy");
      seen.add(problem.slug);
      await db.query("select public.forfeit_battle($1, $2)", [a, battle_id]);
      await db.exec("update public.profiles set rating = 1200");
    }
    expect(seen.size).toBe(6);
  });
});
