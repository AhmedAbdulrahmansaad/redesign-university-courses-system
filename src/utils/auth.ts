/**
 * Authentication Utilities
 * يحتوي على دوال مساعدة للمصادقة وإدارة الجلسات
 */

import { supabase } from './client';

// ❗ قراءة متغيرات البيئة من Vite
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/**
 * فحص صلاحية الـ access token
 */
export async function isTokenValid(): Promise<boolean> {
  try {
    const accessToken = localStorage.getItem('access_token');
    if (!accessToken) return false;

    console.log('🔍 Checking token validity...');

    // ❗ الطلب الصحيح يكون إلى REST API وليس functions
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
    });

    if (response.ok) return true;

    return false;
  } catch (error) {
    console.error('❌ Error checking token:', error);
    return false;
  }
}

/**
 * تسجيل الخروج
 */
export function logout(): void {
  console.log('🚪 Logging out user...');
  localStorage.removeItem('access_token');
  localStorage.removeItem('userInfo');
  localStorage.removeItem('isLoggedIn');
  localStorage.removeItem('hasPledgeAccepted');
}

/**
 * الحصول على التوكن
 */
export function getAccessToken(): string | null {
  return localStorage.getItem('access_token');
}

/**
 * حفظ التوكن
 */
export function setAccessToken(token: string): void {
  localStorage.setItem('access_token', token);
}

/**
 * فحص الدخول
 */
export function isLoggedIn(): boolean {
  return Boolean(
    localStorage.getItem('access_token') &&
    localStorage.getItem('userInfo') &&
    localStorage.getItem('isLoggedIn') === 'true'
  );
}

/**
 * معلومات المستخدم
 */
export function getUserInfo(): any | null {
  try {
    const userInfo = localStorage.getItem('userInfo');
    return userInfo ? JSON.parse(userInfo) : null;
  } catch {
    return null;
  }
}

/**
 * فحص الجلسة
 */
export async function validateSessionOrLogout(): Promise<boolean> {
  if (!isLoggedIn()) return false;

  const valid = await isTokenValid();
  if (!valid) {
    logout();
    return false;
  }

  return true;
}
