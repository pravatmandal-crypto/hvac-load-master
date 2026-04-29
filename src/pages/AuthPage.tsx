import { useState } from 'react';
import { signInWithPopup, signInWithEmailAndPassword } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { toast } from 'sonner';
import { Mail, Lock, ShieldCheck } from 'lucide-react';

interface AuthPageProps {
  onAuthSuccess?: () => void;
}

export default function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showError, setShowError] = useState('');

  const handleGoogleAuth = async () => {
    try {
      setLoading(true);
      setShowError('');
      await signInWithPopup(auth, googleProvider);
      onAuthSuccess?.();
    } catch (error: any) {
      const errorMsg = error?.message || 'Authentication failed';
      setShowError(`Google Sign-in failed: ${errorMsg}`);
      toast.error(errorMsg);
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }
    try {
      setLoading(true);
      setShowError('');
      await signInWithEmailAndPassword(auth, email, password);
      toast.success('Signed in successfully!');
      onAuthSuccess?.();
    } catch (error: any) {
      const errorMsg = error?.message || 'Authentication failed';
      setShowError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 px-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 p-4">
            <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">HVAC Load Master</h1>
          <p className="mt-2 text-gray-600">Professional HVAC Load Calculation Software</p>
        </div>

        {/* Auth Card */}
        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle>Sign In</CardTitle>
            <CardDescription>
              Access is restricted to authorized team members only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* Error */}
            {showError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
                {showError}
              </div>
            )}

            {/* Google Sign-in */}
            <Button
              onClick={handleGoogleAuth}
              disabled={loading}
              variant="outline"
              className="w-full"
            >
              <Mail className="mr-2 h-4 w-4" />
              Continue with Google
            </Button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-gray-400">or sign in with email</span>
              </div>
            </div>

            {/* Email / Password */}
            <form onSubmit={handleEmailAuth} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <Input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
              </div>
              <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700">
                <Lock className="mr-2 h-4 w-4" />
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>

            {/* Info note */}
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  This application is for authorized team members only. Contact your administrator to request access.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Feature highlights */}
        <div className="mt-8 grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-white p-4 text-center shadow">
            <div className="text-2xl font-bold text-blue-600">ASHRAE</div>
            <p className="text-xs text-gray-600">Based Calculations</p>
          </div>
          <div className="rounded-lg bg-white p-4 text-center shadow">
            <div className="text-2xl font-bold text-indigo-600">Cloud</div>
            <p className="text-xs text-gray-600">Save & Sync</p>
          </div>
          <div className="rounded-lg bg-white p-4 text-center shadow">
            <div className="text-2xl font-bold text-purple-600">Export</div>
            <p className="text-xs text-gray-600">PDF & Excel</p>
          </div>
          <div className="rounded-lg bg-white p-4 text-center shadow">
            <div className="text-2xl font-bold text-pink-600">IS Code</div>
            <p className="text-xs text-gray-600">Compliant</p>
          </div>
        </div>
      </div>
    </div>
  );
}
