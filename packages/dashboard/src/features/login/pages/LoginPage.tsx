import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Lock, Mail } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '#components';
import { Button, Input } from '@insforge/ui';
import { useAuth } from '#lib/contexts/AuthContext';
import { loginFormSchema, LoginForm } from '#lib/utils/schemaValidations';

export default function LoginPage() {
  const navigate = useNavigate();
  const { loginWithPassword, isAuthenticated } = useAuth();
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

      if (!success) {
        throw new Error('Invalid email or password');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      setSubmitError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      void navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  return (
    <div className="min-h-screen bg-[rgb(var(--page))] flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-lg mb-4">
            <Lock className="h-8 w-8 text-[rgb(var(--inverse))]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Insforge Admin</h1>
          <p className="text-sm text-muted-foreground mt-2">Sign in to access your dashboard</p>
        </div>

        {/* Login Card */}
        <Card>
          <Form {...form}>
            <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}>
              <CardHeader>
                <CardTitle>Sign In</CardTitle>
                <CardDescription>Enter your admin credentials to continue</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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

                {submitError && (
                  <Alert variant="destructive">
                    <AlertDescription>{submitError}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
              <CardFooter className="flex flex-col space-y-4">
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isSubmitting ? 'Signing in...' : 'Sign in'}
                </Button>
                <p className="text-xs text-center text-muted-foreground">
                  Use the credentials configured in your .env file
                </p>
              </CardFooter>
            </form>
          </Form>
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
