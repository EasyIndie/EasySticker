import type { AuthUser } from "../../../src/shared/contracts";

const TOKEN_KEY = "easysticker_token";
const USER_KEY = "easysticker_user";

export type { AuthUser };

export type AuthState = {
  token: string | null;
  user: AuthUser | null;
};

type Listener = (state: AuthState) => void;

function readStoredState(): AuthState {
  let token: string | null = null;
  let user: AuthUser | null = null;

  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }

  try {
    const raw = localStorage.getItem(USER_KEY);
    user = raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    user = null;
  }

  // A token without a user (or vice-versa) is not a valid session.
  if (!token || !user) {
    return { token: null, user: null };
  }

  return { token, user };
}

function persist(state: AuthState): void {
  try {
    if (state.token) localStorage.setItem(TOKEN_KEY, state.token);
    else localStorage.removeItem(TOKEN_KEY);

    if (state.user) localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // Storage may be unavailable (private mode / sandboxed iframe); auth still
    // works for the lifetime of this tab.
  }
}

/**
 * Single source of truth for the authenticated user.
 *
 * P5 frontend migration: this replaces the auth IIFE in public/app.js with a
 * framework-agnostic store that owns localStorage persistence and cross-tab
 * synchronisation. The DOM layer (features/auth.ts) subscribes to state changes.
 */
class AuthStore {
  private state: AuthState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = readStoredState();
    if (typeof window !== "undefined") {
      window.addEventListener("storage", (event) => this.onStorage(event));
    }
  }

  get token(): string | null {
    return this.state.token;
  }

  get user(): AuthUser | null {
    return this.state.user;
  }

  get isLoggedIn(): boolean {
    return Boolean(this.state.token && this.state.user);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  login(token: string, user: AuthUser): void {
    this.setState({ token, user });
    try {
      // Clear the admin panel's logged-out marker so /admin.html can re-enter.
      sessionStorage.removeItem("admin_logged_out");
    } catch {
      // sessionStorage unavailable — ignore.
    }
  }

  logout(): void {
    this.setState({ token: null, user: null });
    try {
      // Keep the admin panel logout state in sync.
      sessionStorage.removeItem("admin_token");
      sessionStorage.removeItem("admin_user");
      sessionStorage.setItem("admin_logged_out", "1");
    } catch {
      // sessionStorage unavailable — ignore.
    }
  }

  private setState(next: AuthState): void {
    const changed =
      this.state.token !== next.token ||
      JSON.stringify(this.state.user) !== JSON.stringify(next.user);
    if (!changed) return;

    this.state = next;
    persist(next);
    this.emit();
  }

  private emit(): void {
    const snapshot = { ...this.state };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private onStorage(event: StorageEvent): void {
    if (event.key !== TOKEN_KEY && event.key !== USER_KEY) return;

    const stored = readStoredState();
    if (
      stored.token !== this.state.token ||
      JSON.stringify(stored.user) !== JSON.stringify(this.state.user)
    ) {
      this.state = stored;
      this.emit();
    }
  }
}

export const authStore = new AuthStore();
