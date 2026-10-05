import type {
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  QuotaResponse
} from "../../../src/shared/contracts";
import { request } from "./client";

/** POST /api/auth/login */
export function login(input: LoginRequest) {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

/** POST /api/auth/register */
export function register(input: RegisterRequest) {
  return request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

/** GET /api/auth/quota */
export function getQuota() {
  return request<QuotaResponse>("/api/auth/quota");
}
