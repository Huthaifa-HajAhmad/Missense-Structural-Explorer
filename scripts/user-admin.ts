/**
 * user-admin.ts — create or reset an account from a terminal. A developer fallback: the owner creates
 * the first admin at /setup and everyone else from the admin page, with no terminal.
 *
 *   npm run user:create -- --email a@b.org --name "A Person" [--role admin|member]
 *   npm run user:reset  -- --email a@b.org
 *
 * The password is read from USER_PASSWORD, or asked for without echo. Works inside the production
 * container (`docker compose exec app npm run user:create -- …`); it writes the same
 * `data/accounts.sqlite` (or ACCOUNTS_DB_PATH) the server reads.
 */
import readline from "readline";
import { hashPassword, passwordProblem } from "../server/auth/password.ts";
import { isValidEmail } from "../src/shared/accountPolicy.ts";
import { clearAttempt, closeAccountsDb, createUser, deleteUserSessions, emailExists, getUserCredentials, setPasswordHash } from "../server/auth/store.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    out._writeToOutput = (s: string) => {
      if (!prompted) {
        out.output.write(s);
        prompted = true;
      }
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readPassword(): Promise<string> {
  const password = process.env.USER_PASSWORD ?? (await askHidden("Password (12+ characters): "));
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  return password;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const email = arg("email")?.trim().toLowerCase();
  if (!email || !isValidEmail(email)) throw new Error("Pass --email with a valid address.");

  if (command === "create") {
    const name = arg("name")?.trim();
    const role = (arg("role") ?? "member") as "admin" | "member";
    if (!name) throw new Error('Pass --name "Their Name".');
    if (role !== "admin" && role !== "member") throw new Error("--role must be admin or member.");
    if (emailExists(email)) throw new Error(`${email} already has an account. Use user:reset to change the password.`);
    const user = createUser({ email, displayName: name, passwordHash: await hashPassword(await readPassword()), role, now: Date.now() });
    console.log(`Created ${user.role} ${user.email}.`);
    return;
  }

  if (command === "reset") {
    const found = getUserCredentials(email);
    if (!found) throw new Error(`No account for ${email}.`);
    setPasswordHash(found.user.id, await hashPassword(await readPassword()));
    deleteUserSessions(found.user.id);
    clearAttempt(`email:${found.user.email}`); // a reset also lifts a sign-in lockout
    console.log(`Password changed for ${email}; their other sessions were signed out.`);
    return;
  }

  throw new Error("Usage: user-admin.ts create|reset --email <address> [--name <name>] [--role admin|member]");
}

main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closeAccountsDb());
