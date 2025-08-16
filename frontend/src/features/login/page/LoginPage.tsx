import { useEffect, useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Database, Lock, Mail } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/radix/Card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/radix/Form';
import { Input } from '@/components/radix/Input';
import { ButtonWithLoading } from '@/components/ButtonWithLoading';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useStandardForm } from '@/lib/hooks/useStandardForm';
import { useOnboardingCompletion } from '@/lib/hooks/useOnboardingCompletion';
import { loginFormSchema, LoginFormData } from '@/lib/utils/validation-schemas';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { loginWithPassword, loginWithAuthorizationCode, isAuthenticated } = useAuth();
  const { isCompleted } = useOnboardingCompletion();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Determine where to redirect based on onboarding completion status
  const getRedirectPath = useCallback(() => {
    return isCompleted ? '/dashboard' : '/dashboard/onboard';
  }, [isCompleted]);

  const form = useStandardForm<LoginFormData>({
    schema: loginFormSchema,
    defaultValues: {
      email: 'admin@example.com',
      password: 'change-this-password',
    },
    onSubmit: async (data) => {
      const success = await loginWithPassword(data.email, data.password);

      if (success) {
        void navigate(getRedirectPath(), { replace: true });
      } else {
        throw new Error('Invalid email or password');
      }
    },
  });

  // Handle authorization token exchange
  useEffect(() => {
    const authorizationCode = searchParams.get('authorizationCode');

    if (authorizationCode && !isAuthenticating && !isAuthenticated) {
      setIsAuthenticating(true);
      setAuthError(null);

      // Clear the token from URL to prevent reuse
      setSearchParams({}, { replace: true });

      // Exchange the authorization code for an access token
      loginWithAuthorizationCode(authorizationCode)
        .then((success) => {
          if (success) {
            // Notify parent of success
            if (window.parent !== window) {
              window.parent.postMessage({
                type: 'AUTH_SUCCESS',
              });
            }
          } else {
            setAuthError(
              'Failed to authenticate with authorization code. Please try again or use email/password.'
            );
            if (window.parent !== window) {
              window.parent.postMessage({
                type: 'AUTH_ERROR',
                message: 'Authorization code validation failed',
              });
            }
          }
        })
        .catch((error) => {
          console.error('Authorization code exchange failed:', error);
          setAuthError(
            'Authentication failed. The authorization code may have expired or already been used.'
          );
          if (window.parent !== window) {
            window.parent.postMessage({
              type: 'AUTH_ERROR',
              message: 'Authorization code validation failed',
            });
          }
        })
        .finally(() => {
          setIsAuthenticating(false);
        });
    }
  }, [
    searchParams,
    setSearchParams,
    loginWithAuthorizationCode,
    navigate,
    getRedirectPath,
    isAuthenticating,
    isAuthenticated,
  ]);

  useEffect(() => {
    if (isAuthenticated) {
      void navigate(getRedirectPath(), { replace: true });
    }
  }, [isAuthenticated, navigate, getRedirectPath]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-black rounded-lg mb-4">
            <Database className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Insforge Admin</h1>
          <p className="text-sm text-muted-foreground mt-2">Sign in to access your dashboard</p>
        </div>

        {/* Login Card */}
        <Card>
          {isAuthenticating ? (
            <CardContent className="py-12">
              <div className="text-center space-y-4">
                <div className="animate-pulse">
                  <Database className="h-12 w-12 text-primary mx-auto mb-4" />
                </div>
                <p className="text-lg font-medium">Authenticating...</p>
                <p className="text-sm text-muted-foreground">
                  Please wait while we verify your identity
                </p>
              </div>
            </CardContent>
          ) : (
            <Form {...form}>
              <form onSubmit={(e) => void form.onSubmit(e)}>
                <CardHeader>
                  <CardTitle>Sign In</CardTitle>
                  <CardDescription>Enter your admin credentials to continue</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {authError && (
                    <Alert variant="destructive">
                      <AlertDescription>{authError}</AlertDescription>
                    </Alert>
                  )}
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              {...field}
                              type="email"
                              placeholder="admin@example.com"
                              className="pl-10"
                              autoComplete="email"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              {...field}
                              type="password"
                              placeholder="Enter your password"
                              className="pl-10"
                              autoComplete="current-password"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {form.submitError && (
                    <Alert variant="destructive">
                      <AlertDescription>{form.submitError}</AlertDescription>
                    </Alert>
                  )}
                </CardContent>
                <CardFooter className="flex flex-col space-y-4">
                  <ButtonWithLoading
                    type="submit"
                    className="w-full"
                    loading={form.isSubmitting}
                    disabled={form.isSubmitting}
                  >
                    Sign in
                  </ButtonWithLoading>
                  <p className="text-xs text-center text-muted-foreground">
                    Use the credentials configured in your .env file
                  </p>
                </CardFooter>
              </form>
            </Form>
          )}
        </Card>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-muted-foreground">
            Insforge - Self-hosted Backend as a Service
          </p>
        </div>
      </div>
    </div>
  );
}
