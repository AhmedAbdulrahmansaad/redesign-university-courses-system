import React, { useState } from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Trash2, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner@2.0.3';
import { projectId, publicAnonKey } from '../../utils/supabase/info';

export const CleanupPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCleanup = async () => {
    if (!email || !email.includes('@')) {
      toast.error('يرجى إدخال بريد إلكتروني صحيح');
      return;
    }

    setLoading(true);

    try {
      console.log('🧹 [Cleanup] Starting cleanup for:', email);

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-1573e40a/public/cleanup-orphaned-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({ email }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        console.error('❌ [Cleanup] Error:', result);
        toast.error('❌ فشل التنظيف', {
          description: result.error || 'حدث خطأ أثناء التنظيف',
        });
        setLoading(false);
        return;
      }

      console.log('✅ [Cleanup] Result:', result);

      if (result.cleaned) {
        toast.success('✅ تم تنظيف الحساب بنجاح!', {
          description: 'يمكنك الآن إنشاء حساب جديد بنفس البريد',
          duration: 5000,
        });
      } else {
        toast.info('ℹ️ لا يوجد حساب يحتاج تنظيف', {
          description: result.message,
          duration: 5000,
        });
      }

    } catch (error: any) {
      console.error('❌ [Cleanup] Error:', error);
      toast.error('❌ حدث خطأ', {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-full bg-orange-100">
              <Trash2 className="w-12 h-12 text-orange-600" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            🧹 تنظيف الحساب اليتيم
          </h1>
          <p className="text-gray-600 text-sm">
            إذا فشل تسجيل الدخول بعد إنشاء الحساب، استخدم هذه الأداة
          </p>
        </div>

        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-yellow-800">
              <p className="font-semibold mb-1">ما هذه الأداة؟</p>
              <p className="text-xs">
                إذا أنشأت حساباً لكن لم تتمكن من تسجيل الدخول، قد يكون الحساب "يتيماً" 
                (موجود في Auth لكن ليس في قاعدة البيانات). هذه الأداة تحذف الحساب اليتيم 
                لتتمكن من إنشاء حساب جديد.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student1@kku.edu.sa"
              disabled={loading}
              className="mt-2 text-left"
              dir="ltr"
            />
          </div>

          <Button
            onClick={handleCleanup}
            disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                جاري التنظيف...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-2" />
                تنظيف الحساب
              </>
            )}
          </Button>
        </div>

        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-1">الخطوات التالية:</p>
              <ol className="text-xs space-y-1 list-decimal list-inside">
                <li>اضغط "تنظيف الحساب"</li>
                <li>انتظر رسالة التأكيد</li>
                <li>اذهب لصفحة "إنشاء حساب جديد"</li>
                <li>أنشئ حساب جديد بنفس البريد</li>
                <li>سجل دخول بالبيانات الجديدة</li>
              </ol>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};
