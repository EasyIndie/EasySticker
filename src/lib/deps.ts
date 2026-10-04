import type { AlertEngine } from "./alertEngine";
import type { AssetStore } from "./assets";
import type { Mailer } from "./mailer";
import type { MonitorStore } from "./monitorStore";
import type { Security, SecurityConfig } from "./security";
import type { UserStore } from "./userStore";
import type { UsageStore } from "./usageStore";

/**
 * Application dependencies assembled at the composition root (server.ts) and
 * injected into route registrars. Routes/services must depend on this shape —
 * never on the Fastify instance — so each module can be tested in isolation.
 */
export type AppDeps = {
  dataDir: string;
  assetStore: AssetStore;
  security: Security;
  securityConfig: SecurityConfig;
  userStore: UserStore;
  usageStore: UsageStore;
  monitorStore: MonitorStore;
  alertEngine?: AlertEngine;
  mailer?: Mailer;
};
