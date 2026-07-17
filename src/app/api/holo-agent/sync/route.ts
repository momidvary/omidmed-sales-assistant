import crypto from "node:crypto";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 2_500_000;
const MAX_CUSTOMERS = 150;
const MAX_INVOICES = 25;

type SyncPayload = {
  runId?: string;
  mode?: "initial" | "incremental" | "weekly_full" | "manual_full";
  batchType?: "customers" | "invoices" | "finish";
  sourceServer?: string;
  sourceDatabase?: string;
  final?: boolean;
  customers?: unknown[];
  invoices?: unknown[];
};

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is missing.",
    );
  }

  return createAdminClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function resolveOwnerId(
  admin: ReturnType<typeof getAdminClient>,
) {
  const configuredOwnerId =
    process.env.HOLO_SYNC_OWNER_ID?.trim();

  if (configuredOwnerId) {
    return configuredOwnerId;
  }

  const { data, error } = await admin
    .from("customers")
    .select("owner_id")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Owner lookup failed: ${error.message}`,
    );
  }

  if (!data?.owner_id) {
    throw new Error(
      "No owner was found. Set HOLO_SYNC_OWNER_ID on the server.",
    );
  }

  return String(data.owner_id);
}

function authorize(request: NextRequest) {
  const expectedSecret =
    process.env.HOLO_SYNC_AGENT_SECRET?.trim();
  const providedSecret = getBearerToken(request);

  if (
    !expectedSecret ||
    !providedSecret ||
    !secureEqual(expectedSecret, providedSecret)
  ) {
    return false;
  }

  return true;
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const admin = getAdminClient();
    const ownerId = await resolveOwnerId(admin);

    return NextResponse.json({
      ok: true,
      receiver: "omidmed-holoo-sync",
      ownerResolved: Boolean(ownerId),
      now: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Receiver is not ready.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const contentLength = Number(
    request.headers.get("content-length") ?? 0,
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_BODY_BYTES
  ) {
    return NextResponse.json(
      { ok: false, error: "Payload is too large." },
      { status: 413 },
    );
  }

  let payload: SyncPayload;

  try {
    payload = (await request.json()) as SyncPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  if (
    !payload.runId ||
    typeof payload.runId !== "string" ||
    payload.runId.length > 160
  ) {
    return NextResponse.json(
      { ok: false, error: "A valid runId is required." },
      { status: 400 },
    );
  }

  if (
    payload.customers &&
    (!Array.isArray(payload.customers) ||
      payload.customers.length > MAX_CUSTOMERS)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Maximum ${MAX_CUSTOMERS} customers per batch.`,
      },
      { status: 400 },
    );
  }

  if (
    payload.invoices &&
    (!Array.isArray(payload.invoices) ||
      payload.invoices.length > MAX_INVOICES)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Maximum ${MAX_INVOICES} invoices per batch.`,
      },
      { status: 400 },
    );
  }

  try {
    const admin = getAdminClient();
    const ownerId = await resolveOwnerId(admin);

    const { data, error } = await admin.rpc(
      "sync_holoo_agent_batch",
      {
        p_owner_id: ownerId,
        p_payload: payload,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json(data ?? { ok: true });
  } catch (error) {
    console.error("Holoo sync receiver failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Holoo sync failed.",
      },
      { status: 500 },
    );
  }
}
