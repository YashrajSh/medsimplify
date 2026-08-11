import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken, validCredentials } from "@/lib/auth";

export async function POST(request: Request) {
  let input: { email?: string; password?: string };
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!validCredentials(input.email || "", input.password || "")) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return NextResponse.json({ error: "The email or password is incorrect." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken(process.env.AUTH_EMAIL!), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 60 * 60 * 8 });
  return response;
}
