import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { logger } from 'npm:hono/logger';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleAIAssistant } from './aiAssistant.ts';
import * as kv from './kv_store.ts';

const FUNCTION_SLUG = 'make-server-1573e40a';
const BASE = `/${FUNCTION_SLUG}`;

const app = new Hono();

// CORS Middleware with permissive defaults suitable for the frontend
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  allowHeaders: ['Content-Type','Authorization','X-Requested-With','Accept'],
  exposeHeaders: ['Content-Type','Authorization'],
  maxAge: 86400,
}));
app.use('*', logger(console.log));

// OPTIONS preflight handler - respond early for preflight requests
app.options('/*', (c) => {
  return c.text('', 204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Requested-With,Accept',
    'Access-Control-Max-Age': '86400',
  });
});

// Create Supabase client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ========================================
// Helper: get user from token
// ========================================
async function getUserFromToken(authHeader: string | undefined) {
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: userData } = await supabase
    .from('users')
    .select(`
      *,
      students(*),
      supervisors(*)
    `)
    .eq('auth_id', data.user.id)
    .maybeSingle();

  return userData;
}

// HEALTH
app.get(`${BASE}/health`, (c) => {
  return c.json({ status: 'ok', message: 'KKU Course Registration System - SQL Database', database: 'PostgreSQL via Supabase' });
});

// PUBLIC CLEANUP ENDPOINT
app.post(`${BASE}/public/cleanup-orphaned-user`, async (c) => {
  try {
    const { email } = await c.req.json();
    if (!email) return c.json({ error: 'Email is required' }, 400);

    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const authUser = authUsers?.users?.find(u => u.email === email);

    if (!authUser) return c.json({ success: true, message: 'User not found in Auth - nothing to clean', cleaned: false });

    const { data: dbUser } = await supabase.from('users').select('id, auth_id').eq('auth_id', authUser.id).maybeSingle();

    if (dbUser) return c.json({ success: true, message: 'User is not orphaned - account is complete', cleaned: false });

    const { error: deleteError } = await supabase.auth.admin.deleteUser(authUser.id);
    if (deleteError) return c.json({ error: 'Failed to delete orphaned user', details: deleteError.message }, 500);

    return c.json({ success: true, message: 'Orphaned user cleaned successfully. You can now register again.', cleaned: true });
  } catch (error: any) {
    console.error('Public cleanup error:', error);
    return c.json({ error: 'Cleanup failed: ' + (error?.message || String(error)) }, 500);
  }
});

// AUTH endpoints (login, logout, signup, session, me)
app.post(`${BASE}/auth/login`, async (c) => {
  try {
    const { identifier, password } = await c.req.json();
    let email = identifier;
    if (!identifier.includes('@')) {
      const { data: user } = await supabase.from('users').select('email').eq('student_id', identifier).maybeSingle();
      if (!user) return c.json({ error: 'Student ID not found' }, 401);
      email = user.email;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return c.json({ error: 'Invalid credentials' }, 401);

    const { data: userData, error: userError } = await supabase.from('users').select(`*, students(*), supervisors(*)`).eq('auth_id', data.user.id).maybeSingle();
    if (userError || !userData) return c.json({ error: 'User data not found' }, 404);

    return c.json({ success: true, user: userData, session: data.session, access_token: data.session.access_token });

  } catch (error: any) {
    console.error('Login error:', error);
    return c.json({ error: 'Login failed: ' + (error?.message || String(error)) }, 500);
  }
});

app.post(`${BASE}/auth/logout`, async (c) => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) return c.json({ error: 'Logout failed' }, 500);
    return c.json({ success: true });
  } catch (error: any) {
    console.error('Logout error:', error);
    return c.json({ error: 'Logout failed' }, 500);
  }
});

app.post(`${BASE}/auth/signup`, async (c) => {
  try {
    const bodyData = await c.req.json();
    const { studentId, email, password, name, phone, role, level, major, gpa } = bodyData;

    const { data: existingUser } = await supabase.from('users').select('id, auth_id').or(`student_id.eq.${studentId},email.eq.${email}`).maybeSingle();
    if (existingUser) return c.json({ error: 'Student ID or email already exists' }, 400);

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { student_id: studentId, name } });
    if (authError) return c.json({ error: authError.message }, 400);

    const { data: userData, error: userError } = await supabase.from('users').insert({ auth_id: authData.user.id, student_id: studentId, email, name, phone, role: role || 'student', active: true }).select().single();
    if (userError) {
      await supabase.auth.admin.deleteUser(authData.user.id);
      return c.json({ error: 'Failed to create user record: ' + userError.message }, 500);
    }

    if (role === 'student' || !role) {
      if (!level || !major) {
        await supabase.from('users').delete().eq('id', userData.id);
        await supabase.auth.admin.deleteUser(authData.user.id);
        return c.json({ error: 'Student data incomplete', code: 'MISSING_STUDENT_DATA' }, 400);
      }

      const studentInsertData = { user_id: userData.id, level: parseInt(level), gpa: gpa ? parseFloat(gpa) : 0.0, total_credits: 0, completed_credits: 0, major: major, status: 'active', enrollment_year: new Date().getFullYear() };
      const { error: studentError } = await supabase.from('students').insert(studentInsertData);
      if (studentError) {
        await supabase.from('users').delete().eq('id', userData.id);
        await supabase.auth.admin.deleteUser(authData.user.id);
        return c.json({ error: 'Failed to create student record: ' + studentError.message }, 500);
      }
    }

    return c.json({ success: true, message: 'Account created successfully', user: userData });
  } catch (error: any) {
    console.error('Signup error:', error);
    return c.json({ error: 'Signup failed: ' + (error?.message || String(error)) }, 500);
  }
});

app.get(`${BASE}/auth/session`, async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: 'No authorization header' }, 401);
    const token = authHeader.replace('Bearer ', '');
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return c.json({ error: 'Invalid session' }, 401);

    const { data: userData, error: userError } = await supabase.from('users').select(`*, students(*), supervisors(*)`).eq('auth_id', data.user.id).single();
    if (userError || !userData) return c.json({ error: 'User not found' }, 404);

    return c.json({ success: true, user: userData });
  } catch (error: any) {
    console.error('Session error:', error);
    return c.json({ error: 'Session check failed' }, 500);
  }
});

app.get(`${BASE}/auth/me`, async (c) => {
  try {
    const user = await getUserFromToken(c.req.header('Authorization'));
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    return c.json({ success: true, user });
  } catch (error: any) {
    console.error('Get user error:', error);
    return c.json({ error: 'Failed to get user' }, 500);
  }
});

app.post(`${BASE}/auth/agreement`, async (c) => {
  try {
    const { accepted } = await c.req.json();
    const user = await getUserFromToken(c.req.header('Authorization'));
    if (!user) return c.json({ success: true, message: 'Agreement saved locally' });

    const { error } = await supabase.from('users').update({ agreement_accepted: accepted, agreement_accepted_at: new Date().toISOString() }).eq('id', user.id);
    if (error) return c.json({ success: true, message: 'Agreement saved locally (DB save failed)' });
    return c.json({ success: true, message: 'Agreement saved successfully' });
  } catch (error: any) {
    console.error('Agreement error:', error);
    return c.json({ success: true, message: 'Agreement saved locally' });
  }
});

app.post(`${BASE}/agreements`, async (c) => {
  try {
    const { fullName, ipAddress, userAgent, timestamp, language } = await c.req.json();
    const agreementKey = `agreement_${Date.now()}_${(fullName || '').replace(/\s+/g, '_')}`;
    const agreementData = { fullName, ipAddress, userAgent, timestamp, language, acceptedAt: new Date().toISOString() };
    try { await kv.set(agreementKey, agreementData); } catch (kvError) { console.error('KV save failed:', kvError); }
    return c.json({ success: true, message: 'Agreement accepted successfully' });
  } catch (error: any) {
    console.error('Agreement save error:', error);
    return c.json({ success: true, message: 'Agreement accepted (saved locally)' });
  }
});

// COURSES
app.get(`${BASE}/courses`, async (c) => {
  try {
    const level = c.req.query('level');
    const department = c.req.query('department');

    let query = supabase.from('courses').select('*').eq('active', true);
    if (level) query = query.eq('level', parseInt(level));
    if (department) {
      const { data: dept } = await supabase.from('departments').select('id').eq('code', department).single();
      if (dept) query = query.eq('department_id', dept.id);
    }

    const { data, error } = await query.order('level').order('code');
    if (error) return c.json({ error: 'Failed to fetch courses' }, 500);
    return c.json({ success: true, courses: data, count: data.length });
  } catch (error: any) {
    console.error('Courses error:', error);
    return c.json({ error: 'Failed to fetch courses' }, 500);
  }
});

app.get(`${BASE}/courses/available`, async (c) => {
  try {
    const studentId = c.req.query('studentId');
    if (!studentId) return c.json({ error: 'Student ID is required' }, 400);

    const { data: user } = await supabase.from('users').select(`*, students(*)`).eq('id', parseInt(studentId)).single();
    if (!user) return c.json({ error: 'Student not found' }, 404);

    const studentLevel = user.students?.[0]?.level || 1;
    const { data: courses, error: coursesError } = await supabase.from('courses').select('*').eq('active', true).lte('level', studentLevel).order('level').order('code');
    if (coursesError) return c.json({ error: 'Failed to fetch courses' }, 500);

    const formattedCourses = courses.map((course: any) => ({ course_id: String(course.id), id: course.id, code: course.code, name_ar: course.name_ar, name_en: course.name_en, credit_hours: course.credits, credits: course.credits, level: course.level, department: 'MIS', description_ar: course.description_ar, description_en: course.description_en, prerequisites: course.prerequisite_codes || [] }));

    return c.json({ success: true, courses: formattedCourses, count: formattedCourses.length });
  } catch (error: any) {
    console.error('Available courses error:', error);
    return c.json({ error: 'Failed to fetch available courses' }, 500);
  }
});

// STUDENT registrations
app.get(`${BASE}/student/registrations`, async (c) => {
  try {
    const user = await getUserFromToken(c.req.header('Authorization'));
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const { data: registrations, error } = await supabase.from('enrollments').select(`*, courses ( id, code, name_ar, name_en, credits, level )`).eq('user_id', user.id).order('created_at', { ascending: false });
    if (error) return c.json({ success: true, registrations: [], count: 0 });
    return c.json({ success: true, registrations: registrations || [], count: registrations?.length || 0 });
  } catch (error: any) {
    console.error('Registrations error:', error);
    return c.json({ success: true, registrations: [], count: 0 });
  }
});

app.post(`${BASE}/register-course`, async (c) => {
  try {
    const user = await getUserFromToken(c.req.header('Authorization'));
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const { courseId, semester, year } = await c.req.json();

    const { data: existingEnrollment } = await supabase.from('enrollments').select('id').eq('user_id', user.id).eq('course_id', courseId).eq('status', 'pending').maybeSingle();
    if (existingEnrollment) return c.json({ error: 'You are already registered for this course' }, 400);

    const { data: enrollment, error: enrollError } = await supabase.from('enrollments').insert({ user_id: user.id, course_id: courseId, semester: semester || 'Fall 2024', year: year || 2024, status: 'pending', registered_at: new Date().toISOString() }).select().single();
    if (enrollError) return c.json({ error: 'Failed to register for course: ' + enrollError.message }, 500);

    return c.json({ success: true, message: 'Successfully registered for course. Awaiting supervisor approval', enrollment });
  } catch (error: any) {
    console.error('Register course error:', error);
    return c.json({ error: 'Registration failed: ' + (error?.message || String(error)) }, 500);
  }
});

app.delete(`${BASE}/student/registrations/:enrollmentId`, async (c) => {
  try {
    const user = await getUserFromToken(c.req.header('Authorization'));
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const enrollmentId = c.req.param('enrollmentId');

    const { data: enrollment, error: fetchError } = await supabase.from('enrollments').select('*').eq('id', enrollmentId).eq('user_id', user.id).single();
    if (fetchError || !enrollment) return c.json({ error: 'Enrollment not found' }, 404);
    if (enrollment.status === 'completed') return c.json({ error: 'Cannot cancel completed enrollments' }, 400);

    const { error: deleteError } = await supabase.from('enrollments').delete().eq('id', enrollmentId);
    if (deleteError) return c.json({ error: 'Failed to cancel registration' }, 500);

    return c.json({ success: true, message: 'Registration cancelled successfully' });
  } catch (error: any) {
    console.error('Cancel registration error:', error);
    return c.json({ error: 'Failed to cancel registration' }, 500);
  }
});

// ADMIN cleanup endpoints
app.post(`${BASE}/admin/cleanup-orphaned-users`, async (c) => {
  try {
    const user = await getUserFromToken(c.req.header('Authorization'));
    if (!user || user.role !== 'admin') return c.json({ error: 'Unauthorized - Admin access required' }, 403);

    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    if (authError) return c.json({ error: 'Failed to list auth users' }, 500);

    const { data: dbUsers, error: dbError } = await supabase.from('users').select('auth_id, email, student_id');
    if (dbError) return c.json({ error: 'Failed to list database users' }, 500);

    const dbAuthIds = new Set(dbUsers?.map((u: any) => u.auth_id) || []);
    const orphanedUsers = authUsers?.users?.filter((authUser: any) => !dbAuthIds.has(authUser.id)) || [];

    if (orphanedUsers.length === 0) return c.json({ success: true, message: 'No orphaned users found', cleaned: 0, orphanedUsers: [] });

    const cleanupResults: any[] = [];
    for (const orphan of orphanedUsers) {
      try {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(orphan.id);
        if (deleteError) cleanupResults.push({ email: orphan.email, id: orphan.id, status: 'failed', error: deleteError.message });
        else cleanupResults.push({ email: orphan.email, id: orphan.id, status: 'deleted' });
      } catch (err: any) { cleanupResults.push({ email: orphan.email, id: orphan.id, status: 'failed', error: err.message }); }
    }

    return c.json({ success: true, message: `Cleaned up ${cleanupResults.filter(r => r.status === 'deleted').length} orphaned users`, cleaned: cleanupResults.filter(r => r.status === 'deleted').length, failed: cleanupResults.filter(r => r.status === 'failed').length, results: cleanupResults });
  } catch (error: any) {
    console.error('Cleanup error:', error);
    return c.json({ error: 'Cleanup failed: ' + (error?.message || String(error)) }, 500);
  }
});

app.get(`${BASE}/admin/list-orphaned-users`, async (c) => {
  try {
    const user = await getUserFromToken(c.req.header('Authorization'));
    if (!user || user.role !== 'admin') return c.json({ error: 'Unauthorized - Admin access required' }, 403);

    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const { data: dbUsers } = await supabase.from('users').select('auth_id, email, student_id');
    const dbAuthIds = new Set(dbUsers?.map((u: any) => u.auth_id) || []);
    const orphanedUsers = authUsers?.users?.filter((authUser: any) => !dbAuthIds.has(authUser.id)) || [];

    return c.json({ success: true, count: orphanedUsers.length, orphanedUsers: orphanedUsers.map((u: any) => ({ id: u.id, email: u.email, created_at: u.created_at })) });
  } catch (error: any) {
    console.error('List orphans error:', error);
    return c.json({ error: 'Failed to list orphaned users' }, 500);
  }
});

// AI ASSISTANT endpoint uses handler from aiAssistant.ts
app.post(`${BASE}/ai-assistant`, async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    const { message, language } = await c.req.json();
    const result = await handleAIAssistant(authHeader, message, language || 'en');
    return c.json(result);
  } catch (error: any) {
    console.error('AI assistant endpoint error:', error);
    return c.json({ success: false, response: 'Error processing AI assistant' }, 500);
  }
});

// Start server
Deno.serve(app.fetch);
