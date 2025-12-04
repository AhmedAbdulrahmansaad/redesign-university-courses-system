import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function getUserFromToken(authHeader: string | undefined) {
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: userData } = await supabase.from('users').select(`*, students(*), supervisors(*), admins(*)`).eq('auth_id', data.user.id).single();
  return userData;
}

async function getStudentData(studentId: number) {
  try {
    const { data: student } = await supabase.from('students').select('*').eq('id', studentId).single();
    if (!student) return null;

    const { data: registrations } = await supabase.from('registrations').select(`*, courses ( id, code, name_ar, name_en, credits, level, semester, department )`).eq('student_id', studentId);

    const approvedCourses = registrations?.filter(r => r.status === 'approved') || [];
    const pendingCourses = registrations?.filter(r => r.status === 'pending') || [];
    const rejectedCourses = registrations?.filter(r => r.status === 'rejected') || [];

    const registeredCredits = approvedCourses.reduce((sum, r) => sum + (r.courses?.credits || 0), 0);
    const completedCredits = student.completed_credits || 0;
    const remainingCredits = 140 - completedCredits;

    const { data: availableCourses } = await supabase.from('courses').select('*').lte('level', student.level || 1).eq('active', true).order('level', { ascending: true });

    return {
      student,
      registrations: { all: registrations || [], approved: approvedCourses, pending: pendingCourses, rejected: rejectedCourses, count: { total: registrations?.length || 0, approved: approvedCourses.length, pending: pendingCourses.length, rejected: rejectedCourses.length } },
      credits: { completed: completedCredits, registered: registeredCredits, remaining: remainingCredits, total: 140 },
      availableCourses: availableCourses || []
    };
  } catch (error) {
    console.error('Error fetching student data:', error);
    return null;
  }
}

async function getSupervisorData(supervisorId: number) {
  try {
    const { data: supervisor } = await supabase.from('supervisors').select('*').eq('id', supervisorId).single();
    if (!supervisor) return null;

    const { data: pendingRequests } = await supabase.from('registrations').select(`*, students ( id, student_id, major, level, gpa, users (name, email) ), courses ( id, code, name_ar, name_en, credits, level )`).eq('supervisor_id', supervisorId).eq('status', 'pending').order('created_at', { ascending: false });

    const { data: allRequests } = await supabase.from('registrations').select('id, status').eq('supervisor_id', supervisorId);

    const { data: supervisedStudents } = await supabase.from('students').select(`*, users (name, email)`).eq('supervisor_id', supervisorId);

    return { supervisor, requests: { pending: pendingRequests || [], all: allRequests || [], count: { total: allRequests?.length || 0, pending: pendingRequests?.length || 0, approved: allRequests?.filter(r => r.status === 'approved').length || 0, rejected: allRequests?.filter(r => r.status === 'rejected').length || 0 } }, students: supervisedStudents || [] };
  } catch (error) {
    console.error('Error fetching supervisor data:', error);
    return null;
  }
}

async function getAdminStats() {
  try {
    const { data: allStudents } = await supabase.from('students').select('id, major, level, gpa, completed_credits');
    const { data: allCourses } = await supabase.from('courses').select('id, code, name_ar, name_en, active, credits, level');
    const { data: allRegistrations } = await supabase.from('registrations').select('id, status, created_at');
    const { data: allSupervisors } = await supabase.from('supervisors').select('id, department');
    const { data: allUsers } = await supabase.from('users').select('id, role, active');

    const stats: any = { students: { total: allStudents?.length || 0, byMajor: {}, byLevel: {}, averageGPA: 0 }, courses: { total: allCourses?.length || 0, active: allCourses?.filter(c => c.active).length || 0, inactive: allCourses?.filter(c => !c.active).length || 0, byLevel: {} }, registrations: { total: allRegistrations?.length || 0, pending: allRegistrations?.filter(r => r.status === 'pending').length || 0, approved: allRegistrations?.filter(r => r.status === 'approved').length || 0, rejected: allRegistrations?.filter(r => r.status === 'rejected').length || 0 }, supervisors: { total: allSupervisors?.length || 0, byDepartment: {} }, users: { total: allUsers?.length || 0, active: allUsers?.filter(u => u.active).length || 0, inactive: allUsers?.filter(u => !u.active).length || 0, students: allUsers?.filter(u => u.role === 'student').length || 0, supervisors: allUsers?.filter(u => u.role === 'supervisor').length || 0, admins: allUsers?.filter(u => u.role === 'admin').length || 0 } };

    allStudents?.forEach((s: any) => { const major = s.major || 'غير محدد'; stats.students.byMajor[major] = (stats.students.byMajor[major] || 0) + 1; const level = `${s.level || 1}`; stats.students.byLevel[level] = (stats.students.byLevel[level] || 0) + 1; });
    const totalGPA = allStudents?.reduce((sum: number, s: any) => sum + (s.gpa || 0), 0) || 0; stats.students.averageGPA = allStudents?.length ? totalGPA / allStudents.length : 0;
    allCourses?.forEach((c: any) => { const level = `${c.level || 1}`; stats.courses.byLevel[level] = (stats.courses.byLevel[level] || 0) + 1; });
    allSupervisors?.forEach((s: any) => { const dept = s.department || 'غير محدد'; stats.supervisors.byDepartment[dept] = (stats.supervisors.byDepartment[dept] || 0) + 1; });

    return stats;
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    return null;
  }
}

export function buildAIContext(role: string, userName: string, data: any, language: string) {
  // ... keep original implementation or simplified context builder
  if (role === 'admin') {
    const stats = data || {};
    return { system: `Admin context for ${userName}`, user: '' };
  }
  if (role === 'supervisor') return { system: `Supervisor context for ${userName}`, user: '' };
  return { system: `Student context for ${userName}`, user: '' };
}

export async function handleAIAssistant(authHeader: string | undefined, message: string, language: string) {
  try {
    const user = await getUserFromToken(authHeader);
    if (!user) return { success: false, response: language === 'ar' ? 'يرجى تسجيل الدخول أولاً' : 'Please login first', type: 'error' };

    const role = user.role || 'student';
    const userName = user.name || (language === 'ar' ? 'المستخدم' : 'User');

    let contextData: any = null;
    if (role === 'student') { const studentId = user.students?.[0]?.id; if (studentId) contextData = await getStudentData(studentId); }
    else if (role === 'supervisor') { const supervisorId = user.supervisors?.[0]?.id; if (supervisorId) contextData = await getSupervisorData(supervisorId); }
    else if (role === 'admin') { contextData = await getAdminStats(); }

    const context = buildAIContext(role, userName, contextData, language);

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (openaiApiKey) {
      try {
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: context.system }, { role: 'user', content: `${context.user}\n\nالسؤال: ${message}` }], temperature: 0.7, max_tokens: 600 }) });
        if (openaiResponse.ok) { const openaiData = await openaiResponse.json(); const aiResponse = openaiData.choices[0]?.message?.content || ''; return { success: true, response: aiResponse, type: 'ai' }; }
      } catch (error) { console.warn('OpenAI error:', error); }
    }

    return { success: true, response: generateFallbackResponse(role, userName, message, language, contextData), type: 'fallback' };
  } catch (error) {
    console.error('AI Assistant error:', error);
    return { success: false, response: language === 'ar' ? 'عذراً، حدث خطأ.' : 'Sorry, an error occurred.', type: 'error' };
  }
}

function generateFallbackResponse(role: string, userName: string, message: string, language: string, data: any) {
  return language === 'ar' ? 'مرحباً، كيف أساعدك؟' : 'Hello, how can I help?';
}
