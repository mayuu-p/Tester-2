import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("DASHBOARD_ORIGIN") ?? "https://mayuu-p.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isWriteQuery(sql: string) {
  return /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COMMENT|VACUUM|REINDEX|REFRESH|CALL|DO|COPY|SET|RESET)\b/i.test(sql) || /\bSELECT\b[\s\S]*\bINTO\b/i.test(sql);
}

function validateSql(sql: unknown) {
  if (typeof sql !== "string" || !sql.trim()) throw new Error("Enter a SQL query.");
  if (sql.length > 20000) throw new Error("SQL is limited to 20,000 characters.");
  // This endpoint executes one statement at a time. Strip trailing semicolons before checking.
  const normalized = sql.trim().replace(/;+\s*$/, "");
  if (normalized.includes(";")) throw new Error("Run one SQL statement at a time.");
  if (/\b(DROP\s+DATABASE|ALTER\s+ROLE|CREATE\s+ROLE|ALTER\s+SYSTEM|CREATE\s+EXTENSION|SET\s+ROLE|RESET\s+ROLE|GRANT\s+ALL\s+ON\s+ALL|pg_read_file|pg_write_file|pg_terminate_backend|pg_cancel_backend|lo_import|lo_export|COPY[\s\S]*\bPROGRAM\b)/i.test(normalized)) {
    throw new Error("This high-risk server/role operation is blocked from the dashboard.");
  }
  return normalized;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);

  try {
    const origin = req.headers.get("origin");
    const allowedOrigin = Deno.env.get("DASHBOARD_ORIGIN") ?? "https://mayuu-p.github.io";
    if (origin && origin !== allowedOrigin) return reply({ error: "Origin not allowed." }, 403);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return reply({ error: "Sign in required." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const managementToken = Deno.env.get("CONTROL_SUPABASE_ACCESS_TOKEN");
    const adminEmails = (Deno.env.get("CONTROL_ADMIN_EMAILS") ?? "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
    if (!supabaseUrl || !anonKey || !managementToken || adminEmails.length === 0) {
      return reply({ error: "Backend is not configured. Set CONTROL_SUPABASE_ACCESS_TOKEN, CONTROL_ADMIN_EMAILS, and DASHBOARD_ORIGIN as Edge Function secrets." }, 503);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(authHeader.slice(7));
    if (userError || !userData.user?.email) return reply({ error: "Invalid or expired session." }, 401);
    if (!adminEmails.includes(userData.user.email.toLowerCase())) return reply({ error: "Your account is not authorized for the Control Centre." }, 403);

    const payload = await req.json();
    const action = payload?.action;
    const apiBase = "https://api.supabase.com/v1";
    const managementFetch = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(apiBase + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const text = await response.text();
      let data: unknown;
      try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
      if (!response.ok) {
        const detail = (data as { message?: string; error?: string })?.message ?? (data as { error?: string })?.error ?? `Management API returned ${response.status}`;
        throw new Error(detail);
      }
      return data;
    };

    if (action === "projects") {
      const projects = await managementFetch("/projects") as Array<Record<string, unknown>>;
      return reply({ projects: projects.map(p => ({
        id: String(p.id ?? p.ref ?? ""),
        name: String(p.name ?? "Supabase project"),
        region: String(p.region ?? "—"),
        status: String(p.status ?? p.status_message ?? "unknown"),
        created_at: p.created_at ?? null,
      })) });
    }

    const projectRef = String(payload?.projectRef ?? "");
    if (!/^[a-z0-9]{15,30}$/i.test(projectRef)) return reply({ error: "Invalid project reference." }, 400);
    const accessibleProjects = await managementFetch("/projects") as Array<Record<string, unknown>>;
    const projectExists = accessibleProjects.some(p => String(p.id ?? p.ref ?? "") === projectRef);
    if (!projectExists) return reply({ error: "This project is not accessible to the configured Supabase Management API token." }, 403);

    if (action === "project") {
      const project = await managementFetch(`/projects/${encodeURIComponent(projectRef)}`);
      return reply({ project });
    }

    if (action === "query") {
      const sql = validateSql(payload?.sql);
      const write = isWriteQuery(sql);
      if (write && payload?.confirmWrite !== true) {
        return reply({ error: "This query may modify data or schema. Confirm the operation before running it.", confirmationRequired: true }, 409);
      }
      const result = await managementFetch(`/projects/${encodeURIComponent(projectRef)}/database/query`, {
        method: "POST",
        body: JSON.stringify({ query: sql }),
      });
      return reply({ result, readOnly: !write, executedAt: new Date().toISOString() });
    }

    return reply({ error: "Unknown action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return reply({ error: message }, 500);
  }
});
