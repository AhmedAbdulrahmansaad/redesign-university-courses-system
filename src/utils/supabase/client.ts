import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// قراءة المتغيرات من Vite (من Vercel)
const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// منع التشغيل بدون المفاتيح (يساعد على اكتشاف الخطأ)
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ Supabase environment variables are missing!");
}

// إنشاء Supabase client
export const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// إرجاع نفس الـ client (سينغل تون)
export const createClient = () => supabase;
