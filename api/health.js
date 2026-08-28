export default function handler(request, response) {
  const supabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const auth = Boolean(process.env.AUTH_SECRET && process.env.ADMIN_PASSWORD);
  response.status(supabase && auth ? 200 : 503).json({
    ok: supabase && auth,
    services: { vercel: true, supabase, auth },
  });
}
