import type { Context } from "hono";

export type Role = "admin" | "manager" | "employee";

export interface SessionUser {
  userId: number;
  employeeId: number;
  role: Role;
  email: string;
  name: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser };
};

export type Ctx = Context<AppEnv>;

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const forbidden = (m = "この操作を行う権限がありません") => new HttpError(403, m);
export const notFound = (m = "見つかりません") => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

export function tzOffset(env: Env): number {
  return Number(env.APP_TIMEZONE_OFFSET_MINUTES ?? 540);
}
