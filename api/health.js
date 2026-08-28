export default function handler(request, response) {
  response.status(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 200 : 503).json({
    ok: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    services: { vercel: true, supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) },
  });
}
