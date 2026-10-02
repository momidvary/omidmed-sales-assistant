import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        supabaseResponse = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  // Keep this call immediately after creating the client. It validates and
  // refreshes the authentication session used by Server Components.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims);
  const isLoginPage = request.nextUrl.pathname.startsWith("/login");
  const isAuthRoute = request.nextUrl.pathname.startsWith("/auth");
  const isHoloAgentRoute = request.nextUrl.pathname.startsWith(
    "/api/holo-agent/",
  );
  // Meta calls the webhook without a session; the route verifies the
  // challenge token (GET) and the X-Hub-Signature-256 HMAC (POST) itself.
  const isWhatsAppWebhookRoute =
    request.nextUrl.pathname === "/api/whatsapp/webhook";

  if (
    !isAuthenticated &&
    !isLoginPage &&
    !isAuthRoute &&
    !isHoloAgentRoute &&
    !isWhatsAppWebhookRoute
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isAuthenticated && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
