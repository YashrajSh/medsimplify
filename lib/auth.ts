import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "medsimplify_session";

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionToken(email: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return createHmac("sha256", secret).update(`medsimplify:${email}`).digest("hex");
}

export function validCredentials(email: string, password: string): boolean {
  const allowedEmail = process.env.AUTH_EMAIL || "";
  const allowedPassword = process.env.AUTH_PASSWORD || "";
  return Boolean(allowedEmail && allowedPassword) && safeEqual(email.trim().toLowerCase(), allowedEmail.toLowerCase()) && safeEqual(password, allowedPassword);
}

export async function isAuthenticated(): Promise<boolean> {
  const email = process.env.AUTH_EMAIL;
  if (!email || !process.env.AUTH_SECRET) return false;
  const provided = (await cookies()).get(SESSION_COOKIE)?.value || "";
  return safeEqual(provided, sessionToken(email));
}
