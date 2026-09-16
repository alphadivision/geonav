import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PROJECT_SHUTDOWN_ENABLED } from "@/lib/shutdown";

export function proxy(request: NextRequest): NextResponse {
  if (!PROJECT_SHUTDOWN_ENABLED) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error:
          "TeslaNav is currently shut down. API access is temporarily disabled.",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  if (pathname === "/") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";

  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
