// Supabase Edge Function: admin-manage-sell
// Deploy with: supabase functions deploy admin-manage-sell
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return reply({ error: "Thiếu cấu hình secrets của Edge Function." }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return reply({ error: "Bạn cần đăng nhập Admin." }, 401);

    const userClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user: caller }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !caller || caller.app_metadata?.role !== "admin") {
      return reply({ error: "Chỉ Admin mới được quản lý tài khoản Sellkey." }, 403);
    }

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "Email không hợp lệ." }, 400);
      if (password.length < 8) return reply({ error: "Mật khẩu phải có ít nhất 8 ký tự." }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, app_metadata: { role: "sell" },
      });
      if (error) return reply({ error: error.message }, 400);
      return reply({ user: { id: data.user.id, email: data.user.email } });
    }

    const userId = String(body.user_id || "");
    if (!userId) return reply({ error: "Thiếu user_id." }, 400);
    const { data: found, error: getError } = await admin.auth.admin.getUserById(userId);
    if (getError || !found.user) return reply({ error: "Không tìm thấy tài khoản." }, 404);
    if (found.user.app_metadata?.role === "admin") return reply({ error: "Không thể thao tác tài khoản Admin." }, 403);

    if (action === "disable" || action === "enable") {
      if (found.user.app_metadata?.role !== "sell" && found.user.app_metadata?.role !== "disabled") {
        return reply({ error: "Tài khoản này không phải Sellkey." }, 400);
      }
      const nextMeta = { ...(found.user.app_metadata || {}), role: action === "enable" ? "sell" : "disabled" };
      const { error } = await admin.auth.admin.updateUserById(userId, {
        app_metadata: nextMeta,
        ban_duration: action === "enable" ? "none" : "876000h",
      });
      if (error) return reply({ error: error.message }, 400);
      return reply({ success: true });
    }

    if (action === "delete") {
      if (found.user.app_metadata?.role !== "sell" && found.user.app_metadata?.role !== "disabled") {
        return reply({ error: "Tài khoản này không phải Sellkey." }, 400);
      }
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return reply({ error: error.message }, 400);
      return reply({ success: true });
    }

    if (action === "list") {
      const all: Array<{ id: string; email?: string; disabled: boolean }> = [];
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) return reply({ error: error.message }, 400);
        for (const u of data.users) {
          const role = u.app_metadata?.role;
          if (role === "sell" || role === "disabled") all.push({ id: u.id, email: u.email, disabled: role === "disabled" || Boolean(u.banned_until) });
        }
        if (data.users.length < 1000) break;
      }
      return reply({ users: all });
    }
    return reply({ error: "Action không hợp lệ." }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
