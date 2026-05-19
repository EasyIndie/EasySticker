import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type UserRole = "user" | "admin";

export interface User {
  email: string;
  passwordHash: string;
  salt: string;
  role: UserRole;
  createdAt: string;
  lastLogin: string | null;
  disabled: boolean;
}

interface UserStoreData {
  users: Record<string, User>;
}

const KEY_LEN = 64;
const HASH_ALGO = "sha512";
const ITERATIONS = 100_000;

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, s, ITERATIONS, KEY_LEN, HASH_ALGO).toString("hex");
  return { hash, salt: s };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const { hash: computed } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}

export function createUserStore(dataPath: string) {
  const filePath = path.join(dataPath, "users.json");
  let data: UserStoreData = { users: {} };

  function load() {
    try {
      if (fs.existsSync(filePath)) {
        data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }
    } catch (err) {
      console.error("Failed to load user store:", err);
      data = { users: {} };
    }
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to save user store:", err);
    }
  }

  load();

  return {
    /** Register a new user. Returns null if email already exists. */
    register(email: string, password: string, role: UserRole = "user"): User | null {
      const lower = email.toLowerCase().trim();
      if (data.users[lower]) return null;

      const { hash, salt } = hashPassword(password);
      const user: User = {
        email: lower,
        passwordHash: hash,
        salt,
        role,
        createdAt: new Date().toISOString(),
        lastLogin: null,
        disabled: false
      };
      data.users[lower] = user;
      save();
      return { ...user };
    },

    /** Authenticate. Returns user if credentials match. */
    login(email: string, password: string): User | null {
      const lower = email.toLowerCase().trim();
      const user = data.users[lower];
      if (!user || user.disabled) return null;
      if (!verifyPassword(password, user.passwordHash, user.salt)) return null;
      user.lastLogin = new Date().toISOString();
      save();
      return { ...user };
    },

    /** Get user by email. */
    get(email: string): User | undefined {
      const user = data.users[email.toLowerCase().trim()];
      return user ? { ...user } : undefined;
    },

    /** List all users (admin use). */
    list(): User[] {
      return Object.values(data.users).map(u => ({ ...u }));
    },

    /** Set user disabled status. */
    setDisabled(email: string, disabled: boolean): boolean {
      const lower = email.toLowerCase().trim();
      const user = data.users[lower];
      if (!user) return false;
      user.disabled = disabled;
      save();
      return true;
    },

    /** Create default admin if no users exist */
    ensureAdmin(email: string, password: string): boolean {
      if (Object.keys(data.users).length > 0) return false;
      this.register(email, password, "admin");
      return true;
    },

    /** Reload from disk (for external changes). */
    reload() {
      load();
    }
  };
}

export type UserStore = ReturnType<typeof createUserStore>;
