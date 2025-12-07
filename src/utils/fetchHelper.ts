/**
 * Fetch Helper
 * مساعد ذكي للتعامل مع Supabase بأسلوب آمن
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * 🔄 fetch آمن دون كسر التطبيق
 */
export async function safeFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response | null> {
  try {
    if (!SUPABASE_URL) {
      console.error("❌ Supabase URL missing!");
      return null;
    }

    const url = endpoint.startsWith("http")
      ? endpoint
      : `${SUPABASE_URL}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        ...(options.headers || {}),
      },
    });

    return response;
  } catch (err) {
    console.warn("⚠️ safeFetch failed:", err);
    return null;
  }
}

/**
 * 🔍 fetch آمن ويرجع JSON
 */
export async function safeFetchJSON<T = any>(
  endpoint: string,
  options?: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  const response = await safeFetch(endpoint, options);

  if (!response) {
    return { data: null, error: "Server unavailable" };
  }

  if (!response.ok) {
    return { data: null, error: `HTTP ${response.status}` };
  }

  try {
    const json = await response.json();
    return { data: json, error: null };
  } catch {
    return { data: null, error: "Invalid JSON" };
  }
}
