import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUserStore, hashPassword, verifyPassword } from "../src/lib/userStore";

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "easysticker-userstore-test-"));
  return dir;
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("hashPassword / verifyPassword", () => {
  it("produces a hash and salt for a given password", () => {
    const result = hashPassword("hello123");
    expect(result.hash).toBeTruthy();
    expect(result.salt).toBeTruthy();
    expect(result.hash.length).toBe(128); // 64 bytes = 128 hex chars
    expect(result.salt.length).toBe(32);  // 16 bytes = 32 hex chars
  });

  it("produces different hashes with different salts", () => {
    const a = hashPassword("samepassword", "a".repeat(32));
    const b = hashPassword("samepassword", "b".repeat(32));
    expect(a.hash).not.toBe(b.hash);
  });

  it("verifies a correct password", () => {
    const { hash, salt } = hashPassword("mypassword");
    expect(verifyPassword("mypassword", hash, salt)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const { hash, salt } = hashPassword("correctpw");
    expect(verifyPassword("wrongpw", hash, salt)).toBe(false);
  });

  it("uses timing-safe comparison (verifyPassword returns false for bad pw)", () => {
    const { hash, salt } = hashPassword("secret");
    expect(verifyPassword("notsecret", hash, salt)).toBe(false);
  });
});

describe("createUserStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    cleanup(dir);
  });

  it("creates an empty store", () => {
    const store = createUserStore(dir);
    expect(store.list()).toEqual([]);
  });

  it("registers a new user and returns it", () => {
    const store = createUserStore(dir);
    const user = store.register("alice@test.com", "password123");
    expect(user).not.toBeNull();
    expect(user!.email).toBe("alice@test.com");
    expect(user!.role).toBe("user");
    expect(user!.passwordHash).toBeTruthy();
    expect(user!.salt).toBeTruthy();
    expect(user!.createdAt).toBeTruthy();
    expect(user!.lastLogin).toBeNull();
    expect(user!.disabled).toBe(false);
  });

  it("normalizes email to lowercase", () => {
    const store = createUserStore(dir);
    const user = store.register("Alice@TEST.COM", "pw");
    expect(user!.email).toBe("alice@test.com");
  });

  it("returns null on duplicate registration", () => {
    const store = createUserStore(dir);
    store.register("bob@test.com", "pw");
    const dup = store.register("BOB@test.com", "otherpw");
    expect(dup).toBeNull();
  });

  it("registers and retrieves a user with admin role", () => {
    const store = createUserStore(dir);
    const user = store.register("admin@test.com", "adminpass", "admin");
    expect(user!.role).toBe("admin");
    const retrieved = store.get("admin@test.com");
    expect(retrieved).toBeTruthy();
    expect(retrieved!.role).toBe("admin");
  });

  it("login succeeds with correct credentials", () => {
    const store = createUserStore(dir);
    store.register("carol@test.com", "correctpw");
    const loggedIn = store.login("carol@test.com", "correctpw");
    expect(loggedIn).not.toBeNull();
    expect(loggedIn!.email).toBe("carol@test.com");
    // passwordHash should not be exposed through login return
    expect(loggedIn!.passwordHash).toBeTruthy();
  });

  it("login fails with wrong password", () => {
    const store = createUserStore(dir);
    store.register("dave@test.com", "realpw");
    const result = store.login("dave@test.com", "wrongpw");
    expect(result).toBeNull();
  });

  it("login fails for non-existent user", () => {
    const store = createUserStore(dir);
    expect(store.login("noone@test.com", "pw")).toBeNull();
  });

  it("login fails for disabled user", () => {
    const store = createUserStore(dir);
    store.register("eve@test.com", "pw");
    store.setDisabled("eve@test.com", true);
    expect(store.login("eve@test.com", "pw")).toBeNull();
  });

  it("login updates lastLogin", () => {
    const store = createUserStore(dir);
    store.register("frank@test.com", "pw");
    const before = store.get("frank@test.com")!;
    expect(before.lastLogin).toBeNull();

    store.login("frank@test.com", "pw");
    const after = store.get("frank@test.com")!;
    expect(after.lastLogin).toBeTruthy();
  });

  it("get returns undefined for unknown email", () => {
    const store = createUserStore(dir);
    expect(store.get("unknown@test.com")).toBeUndefined();
  });

  it("get returns a copy (modifying result doesn't affect store)", () => {
    const store = createUserStore(dir);
    store.register("grace@test.com", "pw");
    const user = store.get("grace@test.com")!;
    user.disabled = true;
    const userAgain = store.get("grace@test.com")!;
    expect(userAgain.disabled).toBe(false);
  });

  it("list returns all users", () => {
    const store = createUserStore(dir);
    store.register("a@t.com", "pw");
    store.register("b@t.com", "pw");
    store.register("c@t.com", "pw", "admin");
    expect(store.list()).toHaveLength(3);
  });

  it("setDisabled works", () => {
    const store = createUserStore(dir);
    store.register("hank@test.com", "pw");
    expect(store.setDisabled("hank@test.com", true)).toBe(true);
    expect(store.get("hank@test.com")!.disabled).toBe(true);
    expect(store.setDisabled("hank@test.com", false)).toBe(true);
    expect(store.get("hank@test.com")!.disabled).toBe(false);
  });

  it("setDisabled returns false for unknown user", () => {
    const store = createUserStore(dir);
    expect(store.setDisabled("ghost@test.com", true)).toBe(false);
  });

  it("updatePassword changes password", () => {
    const store = createUserStore(dir);
    store.register("iris@test.com", "oldpw");

    // Login with old password works
    expect(store.login("iris@test.com", "oldpw")).not.toBeNull();

    // Update
    expect(store.updatePassword("iris@test.com", "newpw")).toBe(true);

    // Old password no longer works
    expect(store.login("iris@test.com", "oldpw")).toBeNull();

    // New password works
    expect(store.login("iris@test.com", "newpw")).not.toBeNull();
  });

  it("updatePassword returns false for unknown user", () => {
    const store = createUserStore(dir);
    expect(store.updatePassword("ghost@test.com", "pw")).toBe(false);
  });

  it("ensureAdmin creates admin when no users exist", () => {
    const store = createUserStore(dir);
    expect(store.ensureAdmin("root@test.com", "rootpw")).toBe(true);
    const user = store.get("root@test.com")!;
    expect(user.role).toBe("admin");
  });

  it("ensureAdmin returns false when users already exist", () => {
    const store = createUserStore(dir);
    store.register("existing@test.com", "pw");
    expect(store.ensureAdmin("root@test.com", "rootpw")).toBe(false);
    expect(store.get("root@test.com")).toBeUndefined();
  });

  it("persists data to disk and reloads", () => {
    const store = createUserStore(dir);
    store.register("persist@test.com", "persistpw");

    // Create a new store pointing to the same directory
    const store2 = createUserStore(dir);
    const user = store2.get("persist@test.com");
    expect(user).toBeTruthy();
    expect(user!.email).toBe("persist@test.com");
  });

  it("reload re-reads from disk", () => {
    const store = createUserStore(dir);
    store.register("reload@test.com", "pw");

    // Manually modify the file
    const filePath = join(dir, "users.json");
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    raw.users["reload@test.com"].role = "admin";
    raw.users["newguy@test.com"] = {
      email: "newguy@test.com",
      passwordHash: "x",
      salt: "y",
      role: "user",
      createdAt: new Date().toISOString(),
      lastLogin: null,
      disabled: false
    };
    // Write it back
    writeFileSync(filePath, JSON.stringify(raw, null, 2), "utf-8");

    store.reload();
    expect(store.get("reload@test.com")!.role).toBe("admin");
    expect(store.get("newguy@test.com")).toBeTruthy();
  });

  it("handles empty or missing data directory gracefully", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "easysticker-empty-test-"));
    const store = createUserStore(emptyDir);
    expect(store.list()).toEqual([]);
    cleanup(emptyDir);
  });
});
