import { beforeEach, describe, expect, it } from "vitest";
import { accountsDb, closeAccountsDb, createUser, purgeRetiredSecrets } from "./store.ts";

beforeEach(() => closeAccountsDb());

describe("purgeRetiredSecrets", () => {
  it("deletes saved tokens of a provider the app no longer calls and keeps the rest", () => {
    const user = createUser({ email: `r${Math.random()}@lab.org`, displayName: "R", passwordHash: null, role: "member", now: 1 }).id;
    const insert = accountsDb().prepare(
      "INSERT INTO user_secrets (user_id, kind, ciphertext, hint, updated_at) VALUES (?, ?, 'x', 'abcd', 1)"
    );
    insert.run(user, "huggingface");
    insert.run(user, "biohub");
    insert.run(user, "tamarind");

    purgeRetiredSecrets(accountsDb());

    const kinds = accountsDb().prepare("SELECT kind FROM user_secrets WHERE user_id = ?").all(user) as { kind: string }[];
    expect(kinds.map((k) => k.kind)).toEqual(["tamarind"]);
  });
});
