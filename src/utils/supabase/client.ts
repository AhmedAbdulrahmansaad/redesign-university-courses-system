import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// ✅ استخدام environment variables (تلقائياً من Vercel)
const SUPABASE_URL = typeof window !== 'undefined' && (window as any).ENV?.SUPABASE_URL
  ? (window as any).ENV.SUPABASE_URL
  : import.meta.env?.VITE_SUPABASE_URL || 'https://cndqifvqdospvetdmzom.supabase.co';

const SUPABASE_ANON_KEY = typeof window !== 'undefined' && (window as any).ENV?.SUPABASE_ANON_KEY
  ? (window as any).ENV.SUPABASE_ANON_KEY
  : import.meta.env?.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNuZHFpZnZxZG9zcHZldGRtem9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NjEzMzgsImV4cCI6MjA3ODUzNzMzOH0.P4ufx9jn3h2MErfcaIXzpVF53ncChm2t1OZDGvvY3q8';

// إنشاء Supabase client (singleton)
export const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// Export createClient function for compatibility
export const createClient = () => supabase;

// Export configuration
export const supabaseConfig = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
};