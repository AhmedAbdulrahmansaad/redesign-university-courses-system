import React, { useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { GraduationCap, Lock, Eye, EyeOff, Mail, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner@2.0.3';
import { ImageWithFallback } from '../figma/ImageWithFallback';
import { supabase } from '../../utils/supabase/client';
import { projectId, publicAnonKey } from '../../utils/supabase/info';

export const LoginPage: React.FC = () => {
  const { language, t, setCurrentPage, setIsLoggedIn, setUserInfo } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!email || !password) {
        toast.error(
          language === 'ar' 
            ? 'يرجى إدخال البريد الإلكتروني وكلمة المرور' 
            : 'Please enter email and password'
        );
        setLoading(false);
        return;
      }

      console.log('🔐 [Login] Attempting login for:', email);

      // ✅ تسجيل الدخول عبر Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });

      if (authError || !authData?.user || !authData?.session) {
        console.error('❌ [Login] Auth error:', authError?.message);
        
        // رسالة خطأ مفصلة
        let errorTitle = language === 'ar' ? '❌ فشل تسجيل الدخول' : '❌ Login failed';
        let errorDescription = language === 'ar' 
          ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' 
          : 'Invalid email or password';

        // إذا كان الخطأ "Invalid login credentials"
        if (authError?.message?.includes('Invalid login credentials')) {
          errorDescription = language === 'ar'
            ? '⚠️ البريد الإلكتروني أو كلمة المرور غير صحيحة. يرجى التحقق والمحاولة مرة أخرى.'
            : '⚠️ Invalid email or password. Please check and try again.';
        }
        
        toast.error(errorTitle, {
          description: errorDescription,
          duration: 5000,
        });
        setLoading(false);
        return;
      }

      console.log('✅ [Login] Supabase auth successful, auth_id:', authData.user.id);

      // ✅ جلب بيانات المستخدم من قاعدة البيانات
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select(`
          *,
          students(*),
          supervisors(*)
        `)
        .eq('auth_id', authData.user.id)
        .single();

      if (userError || !userData) {
        console.error('❌ [Login] User data not found in database:', userError);
        console.error('❌ [Login] Searched for auth_id:', authData.user.id);
        
        toast.error(
          language === 'ar'
            ? '❌ خطأ في بيانات المستخدم'
            : '❌ User data error',
          {
            description: language === 'ar'
              ? 'لم يتم العثور على بيانات المستخدم في قاعدة البيانات. يرجى التواصل مع الإدارة.'
              : 'User data not found in database. Please contact administration.',
            duration: 8000,
          }
        );
        setLoading(false);
        return;
      }

      console.log('✅ [Login] User data fetched successfully:', {
        id: userData.id,
        email: userData.email,
        role: userData.role,
        hasStudents: userData.students?.length > 0,
        hasSupervisors: userData.supervisors?.length > 0,
      });
      
      // ✅ حفظ بيانات المستخدم
      localStorage.setItem('isLoggedIn', 'true');
      localStorage.setItem('userInfo', JSON.stringify(userData));
      localStorage.setItem('userRole', userData.role);
      localStorage.setItem('userEmail', userData.email);
      localStorage.setItem('accessToken', authData.session.access_token);
      
      setUserInfo(userData);
      setIsLoggedIn(true);

      toast.success(
        language === 'ar'
          ? `✅ مرحباً ${userData.name}!`
          : `✅ Welcome ${userData.name}!`,
        {
          description: language === 'ar'
            ? `تم تسجيل الدخول بنجاح`
            : `Logged in successfully`,
        }
      );

      // ✅ الانتقال للوحة التحكم حسب الدور
      setTimeout(() => {
        if (userData.role === 'student') {
          setCurrentPage('student-dashboard');
        } else if (userData.role === 'advisor') {
          setCurrentPage('supervisor-dashboard');
        } else if (userData.role === 'admin') {
          setCurrentPage('admin-dashboard');
        }
      }, 1000);

    } catch (error: any) {
      console.error('❌ [Login] Unexpected error:', error);
      toast.error(
        language === 'ar'
          ? '❌ حدث خطأ أثناء تسجيل الدخول'
          : '❌ An error occurred during login',
        {
          description: error?.message || 'Unknown error',
        }
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{
      background: 'linear-gradient(135deg, #184A2C 0%, #0d2416 100%)',
    }}>
      <Card className="w-full max-w-md p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-full" style={{ backgroundColor: '#184A2C' }}>
              <GraduationCap className="w-12 h-12" style={{ color: '#D4AF37' }} />
            </div>
          </div>
          <h1 className="mb-2" style={{ color: '#184A2C' }}>
            {language === 'ar' ? 'تسجيل الدخول' : 'Login'}
          </h1>
          <p className="text-gray-600">
            {language === 'ar' 
              ? 'نظام تسجيل المقررات - جامعة الملك خالد' 
              : 'Course Registration System - KKU'}
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email" className="flex items-center gap-2">
              <Mail className="w-4 h-4" />
              {language === 'ar' ? 'البريد الجامعي' : 'University Email'}
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={language === 'ar' ? 'example@kku.edu.sa' : 'example@kku.edu.sa'}
              required
              disabled={loading}
              className="text-left"
              dir="ltr"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="flex items-center gap-2">
              <Lock className="w-4 h-4" />
              {language === 'ar' ? 'كلمة المرور' : 'Password'}
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={language === 'ar' ? '••••••••' : '••••••••'}
                required
                disabled={loading}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                style={{ [language === 'ar' ? 'left' : 'right']: '0.75rem' }}
                disabled={loading}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full text-white"
            style={{ backgroundColor: '#184A2C' }}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {language === 'ar' ? 'جاري تسجيل الدخول...' : 'Logging in...'}
              </>
            ) : (
              <>
                <Lock className="w-4 h-4 mr-2" />
                {language === 'ar' ? 'تسجيل الدخول' : 'Login'}
              </>
            )}
          </Button>

          <div className="text-center space-y-2">
            <p className="text-gray-600">
              {language === 'ar' ? 'ليس لديك حساب؟' : 'Don\'t have an account?'}
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setCurrentPage('signup')}
              disabled={loading}
              style={{ borderColor: '#184A2C', color: '#184A2C' }}
            >
              {language === 'ar' ? '📝 إنشاء حساب جديد' : '📝 Create New Account'}
            </Button>
          </div>
        </form>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm text-blue-800">
                {language === 'ar'
                  ? '💡 نظام حقيقي متصل بقاعدة البيانات'
                  : '💡 Real system connected to database'}
              </p>
              <p className="text-xs text-blue-600">
                {language === 'ar'
                  ? 'يجب إنشاء حساب جديد أولاً قبل تسجيل الدخول'
                  : 'You must create a new account before logging in'}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};