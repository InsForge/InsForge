import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Lock, Mail, AlertCircle } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components';
import { Button, Input } from '@insforge/ui';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { loginFormSchema, LoginForm } from '@/lib/utils/schemaValidations';
import InsForgeLogoDark from '@/assets/logos/insforge_dark.svg';

export default function LoginPage() {
  const navigate = useNavigate();
  const { loginWithPassword, isAuthenticated } = useAuth();
  const { hasCompletedOnboarding, isLoading: isMcpUsageLoading } = useMcpUsage();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: 'admin@example.com',
      password: 'change-this-password',
    },
  });

  const onSubmit = async (data: LoginForm) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const success = await loginWithPassword(data.email, data.password);
      if (!success) throw new Error('Invalid email or password');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && !isMcpUsageLoading) {
      const redirectPath = hasCompletedOnboarding ? '/dashboard' : '/dashboard/onboard';
      void navigate(redirectPath, { replace: true });
    }
  }, [hasCompletedOnboarding, isAuthenticated, isMcpUsageLoading, navigate]);

  return (
    // Force dark class so CSS tokens resolve to obsidian values
    <div
      className="dark min-h-screen bg-canvas flex items-center justify-center px-6"
      style={{
        backgroundImage: 'radial-gradient(circle, var(--alpha-8) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="w-full max-w-sm">

        {/* Logo & Heading */}
        <div className="flex flex-col items-center mb-10">
          <img
            src={InsForgeLogoDark}
            alt="InsForge"
            className="h-9 w-auto mb-8"
          />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome back
          </h1>
          <p className="text-sm mt-2 text-muted-foreground">
            Sign in to access your dashboard
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl bg-surface border border-border p-6 space-y-5">

          <Form {...form}>
            <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-4">

              {/* Email */}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <label htmlFor="login-email" className="block text-sm font-medium text-muted-foreground">
                      Email
                    </label>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <Input
                          {...field}
                          id="login-email"
                          type="email"
                          placeholder="admin@example.com"
                          className="pl-9"
                          autoComplete="email"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Password */}
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <label htmlFor="login-password" className="block text-sm font-medium text-muted-foreground">
                      Password
                    </label>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <Input
                          {...field}
                          id="login-password"
                          type="password"
                          placeholder="Enter your password"
                          className="pl-9"
                          autoComplete="current-password"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Error */}
              {submitError && (
                <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-alpha-4 border border-destructive/30 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                  <p className="text-sm text-destructive">{submitError}</p>
                </div>
              )}

              {/* Submit */}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...</>
                  : 'Sign in'
                }
              </Button>

            </form>
          </Form>
        </div>

        {/* Footer hint */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Use credentials from your{' '}
          <span className="text-primary font-medium">.env</span> file
        </p>

      </div>
    </div>
  );
}
