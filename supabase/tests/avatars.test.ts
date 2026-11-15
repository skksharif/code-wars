import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  all,
  asClient,
  createDb,
  createUser,
  expectDbError,
  makeBattle,
  one,
  resetState,
} from "./helpers.ts";

const AVATARS = ["cipher", "kernel", "vector", "nova", "pixel", "echo"];

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());
beforeEach(() => resetState(db));

const avatarOf = async (user: string) =>
  (await one<{ avatar: string }>(db, "select avatar from public.profiles where id = $1", [user]))
    .avatar;

describe("avatars", () => {
  it("gives every new player a valid avatar, spread across all six", async () => {
    const users = [];
    for (let i = 0; i < 40; i++) users.push(await createUser(db, `player_${i}`));
    const avatars = await Promise.all(users.map(avatarOf));
    expect(avatars.every((a) => AVATARS.includes(a))).toBe(true);
    expect(new Set(avatars).size).toBeGreaterThanOrEqual(4);
  });

  it("uses the avatar chosen at sign-up when it is valid", async () => {
    const chosen = await one<{ id: string }>(
      db,
      `insert into auth.users (email, raw_user_meta_data)
       values ('n@example.test', '{"username": "nova_fan", "avatar": "nova"}') returning id`,
    );
    expect(await avatarOf(chosen.id)).toBe("nova");

    const bogus = await one<{ id: string }>(
      db,
      `insert into auth.users (email, raw_user_meta_data)
       values ('b@example.test', '{"username": "bogus_pick", "avatar": "<script>"}') returning id`,
    );
    expect(AVATARS).toContain(await avatarOf(bogus.id));
  });

  it("lets the server change an avatar, and only to one of the six", async () => {
    const a = await createUser(db, "alice");
    await db.query("select public.set_avatar($1, 'echo')", [a]);
    expect(await avatarOf(a)).toBe("echo");
    await expectDbError(db.query("select public.set_avatar($1, 'dragon')", [a]), "INVALID_INPUT");
    await expectDbError(
      db.query("select public.set_avatar('00000000-0000-4000-8000-000000000000', 'echo')"),
      "NOT_FOUND",
    );
    expect(await avatarOf(a)).toBe("echo");
  });

  it("does not let players change avatars directly", async () => {
    const a = await createUser(db, "alice");
    const b = await createUser(db, "bob");
    await asClient(db, a, async () => {
      await expectDbError(
        db.query("select public.set_avatar($1, 'echo')", [b]),
        /permission denied/,
      );
      await expectDbError(
        db.query("update public.profiles set avatar = 'echo' where id = $1", [a]),
        /permission denied/,
      );
    });
  });

  it("shows avatars in the leaderboard, battles and public profiles", async () => {
    const a = await createUser(db, "alice");
    const b = await createUser(db, "bob");
    await db.query("select public.set_avatar($1, 'pixel')", [a]);
    await db.query("select public.set_avatar($1, 'kernel')", [b]);

    await asClient(db, null, async () => {
      const board = await all<{ username: string; avatar: string }>(
        db,
        "select username, avatar from public.leaderboard order by username",
      );
      expect(board).toEqual([
        { username: "alice", avatar: "pixel" },
        { username: "bob", avatar: "kernel" },
      ]);
    });

    const battle = await makeBattle(db, a, b);
    const state = await one<{ s: { players: { username: string; avatar: string }[] } }>(
      db,
      "select public.get_battle_state($1, $2) as s",
      [a, battle],
    );
    expect(state.s.players.map((p) => [p.username, p.avatar])).toEqual([
      ["alice", "pixel"],
      ["bob", "kernel"],
    ]);

    await db.query("select public.forfeit_battle($1, $2)", [b, battle]);
    const profile = await one<{
      p: { avatar: string; recent_battles: { opponent: string; opponent_avatar: string }[] };
    }>(db, "select public.get_public_profile('alice') as p");
    expect(profile.p.avatar).toBe("pixel");
    expect(profile.p.recent_battles[0]).toMatchObject({
      opponent: "bob",
      opponent_avatar: "kernel",
    });
  });
});
