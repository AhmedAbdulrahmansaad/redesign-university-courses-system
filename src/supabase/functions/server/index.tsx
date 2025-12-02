import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { logger } from 'npm:hono/logger';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleAIAssistant } from './aiAssistant.tsx';
import * as kv from './kv_store.tsx';

const app = new Hono();

// Middleware
app.use('*', cors());
app.use('*', logger(console.log));

// Create Supabase client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ========================================
// HELPER FUNCTIONS
// ========================================

async function getUserFromToken(authHeader: string | undefined) {
  if (!authHeader) return null;
  
  const token = authHeader.replace('Bearer ', '');
  const { data, error } = await supabase.auth.getUser(token);
  
  if (error || !data.user) return null;
  
  // Get user details from database
  const { data: userData } = await supabase
    .from('users')
    .select(`
      *,
      students(*),
      supervisors(*)
    `)
    .eq('auth_id', data.user.id)
    .single();
  
  return userData;
}

// ========================================
// AUTHENTICATION ROUTES
// ========================================

// 📝 تسجيل مستخدم جديد
app.post('/make-server-1573e40a/auth/signup', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password, name, studentId, role, major, level, gpa, phone } = body;

    console.log('📝 [Signup] Starting signup for:', email);

    // 1. التحقق من البيانات المطلوبة
    if (!email || !password || !name) {
      return c.json({ 
        success: false, 
        error: 'Email, password, and name are required' 
      }, 400);
    }

    // 2. التحقق من أن البريد ينتهي بـ @kku.edu.sa
    if (!email.endsWith('@kku.edu.sa')) {
      return c.json({
        success: false,
        error: 'Must use KKU email (@kku.edu.sa)'
      }, 400);
    }

    // 3. حذف أي مستخدم يتيم بنفس البريد
    console.log('🧹 [Signup] Cleaning up any orphaned users...');
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const existingAuthUser = authUsers?.users?.find(u => u.email === email);
    
    if (existingAuthUser) {
      console.log('⚠️ [Signup] Found orphaned auth user, deleting:', existingAuthUser.id);
      await supabase.auth.admin.deleteUser(existingAuthUser.id);
      console.log('✅ [Signup] Orphaned user deleted');
      // انتظار قصير للتأكد من الحذف
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 4. التحقق من أن المستخدم غير موجود في قاعدة البيانات
    const { data: existingDbUser } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (existingDbUser) {
      console.log('❌ [Signup] User exists in database, deleting...');
      await supabase.from('users').delete().eq('id', existingDbUser.id);
      console.log('✅ [Signup] Database user deleted');
    }

    // 5. إنشاء مستخدم في Auth
    console.log('🔐 [Signup] Creating auth user...');
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // ✅ تأكيد البريد تلقائياً
      user_metadata: { name }
    });

    if (authError || !authData?.user) {
      console.error('❌ [Signup] Auth error:', authError);
      return c.json({ 
        success: false, 
        error: authError?.message || 'Failed to create auth user' 
      }, 500);
    }

    const authUserId = authData.user.id;
    console.log('✅ [Signup] Auth user created:', authUserId);

    // 6. إنشاء مستخدم في جدول users
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        auth_id: authUserId,
        email,
        name,
        name_ar: name,
        name_en: name,
        student_id: studentId || null,
        role: role || 'student',
        phone: phone || null,
      })
      .select()
      .single();

    if (userError || !user) {
      console.error('❌ [Signup] User creation error:', userError);
      // حذف المستخدم من Auth إذا فشل إنشاء السجل
      await supabase.auth.admin.deleteUser(authUserId);
      return c.json({ 
        success: false, 
        error: userError?.message || 'Failed to create user record' 
      }, 500);
    }

    console.log('✅ [Signup] User record created:', user.id);

    // 7. إذا كان طالب، إنشاء سجل في جدول students
    if (role === 'student') {
      const { data: student, error: studentError } = await supabase
        .from('students')
        .insert({
          user_id: user.id,
          major: major || 'نظم المعلومات الإدارية',
          major_en: major || 'Management Information Systems',
          level: level ? parseInt(level) : 1,
          gpa: gpa ? parseFloat(gpa) : 0.0,
          total_credits: 0,
          completed_credits: 0,
        })
        .select()
        .single();

      if (studentError) {
        console.error('⚠️ [Signup] Student record creation failed:', studentError);
        // لا نحذف المستخدم، فقط نسجل الخطأ
      } else {
        console.log('✅ [Signup] Student record created:', student.id);
      }
    }

    // 8. إذا كان مشرف، إنشاء سجل في جدول supervisors
    if (role === 'advisor') {
      const { data: supervisor, error: supervisorError } = await supabase
        .from('supervisors')
        .insert({
          user_id: user.id,
          department: 'قسم المعلوماتية الإدارية',
          department_en: 'MIS Department',
        })
        .select()
        .single();

      if (supervisorError) {
        console.error('⚠️ [Signup] Supervisor record creation failed:', supervisorError);
      } else {
        console.log('✅ [Signup] Supervisor record created:', supervisor.id);
      }
    }

    console.log('🎉 [Signup] SIGNUP COMPLETE - User can now login!');

    return c.json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });

  } catch (error) {
    console.error('❌ [Signup] Unexpected error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// 🔐 تسجيل الدخول
app.post('/make-server-1573e40a/auth/login', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password } = body;

    console.log('🔐 [Login] Login attempt for:', email);

    if (!email || !password) {
      return c.json({ 
        success: false, 
        error: 'Email and password are required' 
      }, 400);
    }

    // 1. تسجيل الدخول عبر Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      console.error('❌ [Login] Auth error:', authError?.message);
      return c.json({ 
        success: false, 
        error: 'Invalid email or password' 
      }, 401);
    }

    console.log('✅ [Login] Auth successful for:', authData.user.id);

    // 2. الحصول على بيانات المستخدم من قاعدة البيانات
    const { data: user, error: userError } = await supabase
      .from('users')
      .select(`
        *,
        students(*)
      `)
      .eq('auth_id', authData.user.id)
      .single();

    if (userError || !user) {
      console.error('❌ [Login] User not found in database:', userError);
      return c.json({ 
        success: false, 
        error: 'User data not found' 
      }, 404);
    }

    console.log('✅ [Login] Login successful:', {
      id: user.id,
      email: user.email,
      role: user.role,
      hasStudentData: user.students && user.students.length > 0,
    });

    return c.json({
      success: true,
      user: {
        id: user.id,
        auth_id: user.auth_id,
        email: user.email,
        name: user.name,
        student_id: user.student_id,
        role: user.role,
        phone: user.phone,
        students: user.students || [],
      },
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
    });

  } catch (error) {
    console.error('❌ [Login] Unexpected error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// 🚪 تسجيل الخروج
app.post('/make-server-1573e40a/auth/logout', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ success: false, error: 'No authorization header' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const { error } = await supabase.auth.admin.signOut(token);

    if (error) {
      console.error('❌ [Logout] Error:', error);
      return c.json({ success: false, error: error.message }, 500);
    }

    console.log('✅ [Logout] Successful');
    return c.json({ success: true, message: 'Logged out successfully' });

  } catch (error) {
    console.error('❌ [Logout] Unexpected error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// 📋 حفظ تعهد الاستخدام
app.post('/make-server-1573e40a/agreements', async (c) => {
  try {
    const body = await c.req.json();
    const { fullName, ipAddress, userAgent, timestamp, language } = body;

    console.log('📋 [Agreement] Received agreement from:', fullName);

    if (!fullName) {
      return c.json({ 
        success: false, 
        error: 'Full name is required' 
      }, 400);
    }

    // ✅ نجحت الموافقة - نحفظها في localStorage على الفرونت إند
    // لا حاجة لحفظها في قاعدة البيانات الآن (جدول agreements غير موجود)
    console.log('✅ [Agreement] Agreement accepted by:', fullName);
    console.log('📊 [Agreement] Details:', {
      ipAddress: ipAddress || 'Unknown',
      userAgent: userAgent || 'Unknown',
      language: language || 'ar',
      timestamp: timestamp || new Date().toISOString(),
    });

    return c.json({
      success: true,
      message: 'Agreement accepted successfully',
      // نعيد بيانات وهمية للحفاظ على توافق الكود
      agreementId: `agreement-${Date.now()}`,
    });

  } catch (error: any) {
    console.error('❌ [Agreement] Error:', error);
    return c.json({ 
      success: false,
      error: error?.message || 'Failed to save agreement' 
    }, 500);
  }
});

// ========================================
// HEALTH CHECK
// ========================================

app.get('/make-server-1573e40a/health', (c) => {
  return c.json({ 
    status: 'ok', 
    message: 'KKU Course Registration System - SQL Database',
    database: 'PostgreSQL via Supabase'
  });
});

// ========================================
// PUBLIC CLEANUP ENDPOINT (للمستخدمين الذين يواجهون مشكلة)
// ========================================

// 🧹 تنظيف مستخدم يتيم محدد بالبريد الإلكتروني (عام - بدون مصادقة)
app.post('/make-server-1573e40a/public/cleanup-orphaned-user', async (c) => {
  try {
    const { email } = await c.req.json();
    
    if (!email) {
      return c.json({ error: 'Email is required' }, 400);
    }

    console.log('🧹 [Public Cleanup] Attempting to clean orphaned user:', email);

    // 1. التحقق مما إذا كان المستخدم موجود في Auth
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const authUser = authUsers?.users?.find(u => u.email === email);
    
    if (!authUser) {
      console.log('ℹ️ [Public Cleanup] User not found in Auth');
      return c.json({
        success: true,
        message: 'User not found in Auth - nothing to clean',
        cleaned: false,
      });
    }

    // 2. التحقق مما إذا كان المسخدم موجود في DB
    const { data: dbUser } = await supabase
      .from('users')
      .select('id, auth_id')
      .eq('auth_id', authUser.id)
      .maybeSingle();
    
    if (dbUser) {
      console.log('ℹ️ [Public Cleanup] User is not orphaned - exists in both Auth and DB');
      return c.json({
        success: true,
        message: 'User is not orphaned - account is complete',
        cleaned: false,
      });
    }

    // 3. المستخدم يتيم - حذفه من Auth
    console.log('🗑️ [Public Cleanup] Deleting orphaned user from Auth:', authUser.id);
    const { error: deleteError } = await supabase.auth.admin.deleteUser(authUser.id);
    
    if (deleteError) {
      console.error('❌ [Public Cleanup] Failed to delete user:', deleteError);
      return c.json({ 
        error: 'Failed to delete orphaned user',
        details: deleteError.message 
      }, 500);
    }

    console.log('✅ [Public Cleanup] Successfully deleted orphaned user');
    
    return c.json({
      success: true,
      message: 'Orphaned user cleaned successfully. You can now register again.',
      cleaned: true,
    });

  } catch (error: any) {
    console.error('❌ [Public Cleanup] Error:', error);
    return c.json({ error: 'Cleanup failed: ' + error.message }, 500);
  }
});

// 🧹 تنظيف جميع المستخدمين اليتامى (عام - للطوارئ)
app.post('/make-server-1573e40a/public/cleanup-all-orphaned-users', async (c) => {
  try {
    console.log('🧹 [Public Cleanup All] Starting cleanup of all orphaned users...');

    // 1. جلب جميع المستخدمين من Auth
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    
    if (authError) {
      console.error('❌ [Public Cleanup All] Failed to list auth users:', authError);
      return c.json({ error: 'Failed to list auth users' }, 500);
    }

    console.log(`ℹ️ [Public Cleanup All] Found ${authUsers?.users?.length || 0} users in Auth`);

    // 2. جلب جميع المستخدمين من قاعدة البيانات
    const { data: dbUsers, error: dbError } = await supabase
      .from('users')
      .select('auth_id, email, student_id');
    
    if (dbError) {
      console.error('❌ [Public Cleanup All] Failed to list DB users:', dbError);
      return c.json({ error: 'Failed to list database users' }, 500);
    }

    console.log(`ℹ️ [Public Cleanup All] Found ${dbUsers?.length || 0} users in Database`);

    // 3. تحديد المستخدمين اليتامى
    const dbAuthIds = new Set(dbUsers?.map(u => u.auth_id) || []);
    const orphanedUsers = authUsers?.users?.filter(authUser => !dbAuthIds.has(authUser.id)) || [];

    console.log(`🔍 [Public Cleanup All] Found ${orphanedUsers.length} orphaned users`);

    if (orphanedUsers.length === 0) {
      return c.json({
        success: true,
        message: 'No orphaned users found',
        cleaned: 0,
        orphanedUsers: [],
      });
    }

    // 4. حذف المستخدمين اليتامى
    const cleanupResults = [];
    let successCount = 0;
    let failCount = 0;

    for (const orphan of orphanedUsers) {
      try {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(orphan.id);
        
        if (deleteError) {
          console.error(`❌ [Public Cleanup All] Failed to delete ${orphan.email}:`, deleteError);
          cleanupResults.push({
            email: orphan.email,
            status: 'failed',
            error: deleteError.message,
          });
          failCount++;
        } else {
          console.log(`✅ [Public Cleanup All] Deleted ${orphan.email}`);
          cleanupResults.push({
            email: orphan.email,
            status: 'deleted',
          });
          successCount++;
        }
        
        // انتظار قليل بين كل عملية حذف
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err: any) {
        console.error(`❌ [Public Cleanup All] Exception deleting ${orphan.email}:`, err);
        failCount++;
      }
    }

    console.log(`✅ [Public Cleanup All] Cleanup complete - Success: ${successCount}, Failed: ${failCount}`);

    return c.json({
      success: true,
      message: `Cleaned up ${successCount} orphaned users`,
      cleaned: successCount,
      failed: failCount,
      results: cleanupResults,
    });

  } catch (error: any) {
    console.error('❌ [Public Cleanup All] Error:', error);
    return c.json({ error: 'Cleanup failed: ' + error.message }, 500);
  }
});

// ========================================
// ADMIN ENDPOINTS - CLEANUP TOOLS
// ========================================

// 🧹 تنظيف المستخدمين اليتامى (Admin فقط)
app.post('/make-server-1573e40a/admin/cleanup-orphaned-users', async (c) => {
  try {
    const user = await getUserFromToken(c.req.header('Authorization'));
    
    if (!user || user.role !== 'admin') {
      return c.json({ error: 'Unauthorized - Admin access required' }, 403);
    }

    console.log('🧹 [Cleanup] Starting orphaned users cleanup...');

    // 1. جلب جميع المستخدمين من Auth
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    
    if (authError) {
      console.error('❌ [Cleanup] Failed to list auth users:', authError);
      return c.json({ error: 'Failed to list auth users' }, 500);
    }

    console.log(`ℹ️ [Cleanup] Found ${authUsers?.users?.length || 0} users in Auth`);

    // 2. جلب جميع المستخدمين من قاعدة البيانات
    const { data: dbUsers, error: dbError } = await supabase
      .from('users')
      .select('auth_id, email, student_id');
    
    if (dbError) {
      console.error('❌ [Cleanup] Failed to list DB users:', dbError);
      return c.json({ error: 'Failed to list database users' }, 500);
    }

    console.log(`ℹ️ [Cleanup] Found ${dbUsers?.length || 0} users in Database`);

    // 3. تحديد المستخدمين اليتامى
    const dbAuthIds = new Set(dbUsers?.map(u => u.auth_id) || []);
    const orphanedUsers = authUsers?.users?.filter(authUser => !dbAuthIds.has(authUser.id)) || [];

    console.log(`🔍 [Cleanup] Found ${orphanedUsers.length} orphaned users`);

    if (orphanedUsers.length === 0) {
      return c.json({
        success: true,
        message: 'No orphaned users found',
        cleaned: 0,
        orphanedUsers: [],
      });
    }

    // 4. حذف المستخدمين اليتامى
    const cleanupResults = [];
    let successCount = 0;
    let failCount = 0;

    for (const orphan of orphanedUsers) {
      try {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(orphan.id);
        
        if (deleteError) {
          console.error(`❌ [Cleanup] Failed to delete ${orphan.email}:`, deleteError);
          cleanupResults.push({
            email: orphan.email,
            id: orphan.id,
            status: 'failed',
            error: deleteError.message,
          });
          failCount++;
        } else {
          console.log(`✅ [Cleanup] Deleted ${orphan.email}`);
          cleanupResults.push({
            email: orphan.email,
            id: orphan.id,
            status: 'deleted',
          });
          successCount++;
        }
      } catch (err: any) {
        console.error(`❌ [Cleanup] Exception deleting ${orphan.email}:`, err);
        cleanupResults.push({
          email: orphan.email,
          id: orphan.id,
          status: 'failed',
          error: err.message,
        });
        failCount++;
      }
    }

    console.log(`✅ [Cleanup] Cleanup complete - Success: ${successCount}, Failed: ${failCount}`);

    return c.json({
      success: true,
      message: `Cleaned up ${successCount} orphaned users`,
      cleaned: successCount,
      failed: failCount,
      results: cleanupResults,
    });

  } catch (error: any) {
    console.error('❌ [Cleanup] Error:', error);
    return c.json({ error: 'Cleanup failed: ' + error.message }, 500);
  }
});

// 🔍 عرض المستخدمين اليتامى بدون حذف (Admin فقط)
app.get('/make-server-1573e40a/admin/list-orphaned-users', async (c) => {
  try {
    const user = await getUserFromToken(c.req.header('Authorization'));
    
    if (!user || user.role !== 'admin') {
      return c.json({ error: 'Unauthorized - Admin access required' }, 403);
    }

    console.log('🔍 [List Orphans] Checking for orphaned users...');

    // جلب المستخدمين من Auth والـ DB
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const { data: dbUsers } = await supabase
      .from('users')
      .select('auth_id, email, student_id');

    const dbAuthIds = new Set(dbUsers?.map(u => u.auth_id) || []);
    const orphanedUsers = authUsers?.users?.filter(authUser => !dbAuthIds.has(authUser.id)) || [];

    console.log(`🔍 [List Orphans] Found ${orphanedUsers.length} orphaned users`);

    return c.json({
      success: true,
      count: orphanedUsers.length,
      orphanedUsers: orphanedUsers.map(u => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
      })),
    });

  } catch (error: any) {
    console.error('❌ [List Orphans] Error:', error);
    return c.json({ error: 'Failed to list orphaned users' }, 500);
  }
});

// ========================================
// AI ASSISTANT ENDPOINT
// ========================================

app.post('/make-server-1573e40a/ai-assistant', handleAIAssistant);

// ========================================
// START SERVER
// ========================================

Deno.serve(app.fetch);