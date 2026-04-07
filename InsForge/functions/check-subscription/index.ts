import { createClient } from "npm:@insforge/sdk";

const MONTHLY_TOKEN_LIMIT = 2_000_000;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export default async function (req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const userToken = authHeader ? authHeader.replace("Bearer ", "") : null;

    if (!userToken) {
      return jsonResponse({ error: "Authorization required" }, 401);
    }

    const authClient = createClient({
      baseUrl: Deno.env.get("INSFORGE_BASE_URL"),
      edgeFunctionToken: userToken,
    });

    const { data: userData } = await authClient.auth.getCurrentUser();
    if (!userData?.user?.id) {
      return jsonResponse({ error: "Invalid or expired token" }, 401);
    }

    // ... queries subscriptions table using userData.user.id
    return jsonResponse({ subscription_status: "none", tier: null });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
