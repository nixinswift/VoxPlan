import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import voxplanLogo from "@/assets/voxplan-logo-dark.png";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [isMagicLink, setIsMagicLink] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const hashParams = new URLSearchParams(
      window.location.hash.replace(/^#/, "")
    );
    const searchParams = new URLSearchParams(location.search);
    const type = searchParams.get("type") || hashParams.get("type");

    if (type === "recovery") {
      setIsRecoveryMode(true);
      setIsLogin(false);
      setIsResetPassword(false);
      setIsMagicLink(false);
    }
  }, [location.search]);

  useEffect(() => {
    const hashParams = new URLSearchParams(
      window.location.hash.replace(/^#/, "")
    );
    const searchParams = new URLSearchParams(location.search);
    const isRecoveryLink =
      (searchParams.get("type") || hashParams.get("type")) === "recovery";

    // Check if user is already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !isRecoveryLink && !isRecoveryMode) {
        navigate("/");
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryMode(true);
        setIsLogin(false);
        setIsResetPassword(false);
        setIsMagicLink(false);
        return;
      }
      if (session && !isRecoveryLink && !isRecoveryMode) {
        navigate("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, isRecoveryMode, location.search]);


  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isRecoveryMode) {
        if (newPassword !== confirmNewPassword) {
          toast({
            title: "Passwords don't match",
            description: "Please make sure your new passwords match.",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }

        if (newPassword.length < 6) {
          toast({
            title: "Password too short",
            description: "Password must be at least 6 characters long.",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }

        const { error } = await supabase.auth.updateUser({
          password: newPassword,
        });

        if (error) throw error;

        toast({
          title: "Password updated",
          description:
            "Your password has been changed. You can now sign in with your new password.",
        });

        setIsRecoveryMode(false);
        setNewPassword("");
        setConfirmNewPassword("");
        navigate("/");
      } else if (isMagicLink) {
        const { data: approved } = await supabase.rpc("is_email_approved", { _email: email });
        if (!approved) {
          toast({
            title: "Email not approved",
            description: "This email isn't approved for a VoxPlan account. Contact your administrator.",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            shouldCreateUser: true,
          },
        });

        if (error) throw error;

        toast({
          title: "Magic link sent!",
          description: "Check your email for the sign-in link.",
        });
        setEmail("");
      } else if (isResetPassword) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth`,
        });

        if (error) throw error;

        toast({
          title: "Password reset email sent!",
          description: "Check your email for the password reset link.",
        });
        setIsResetPassword(false);
        setIsLogin(true);
      } else if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        toast({
          title: "Welcome back!",
          description: "You've successfully signed in.",
        });
      } else {
        const { data: approved } = await supabase.rpc("is_email_approved", { _email: email });
        if (!approved) {
          toast({
            title: "Email not approved",
            description: "This email isn't approved for a VoxPlan account. Contact your administrator.",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
          },
        });

        if (error) throw error;

        toast({
          title: "Account created!",
          description: "You've successfully signed up. You can now sign in.",
        });
        setIsLogin(true);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="flex justify-center">
            <img src={voxplanLogo} alt="VoxPlan" className="h-20" />
          </div>
          <CardTitle className="text-center text-2xl">
            {isRecoveryMode
              ? "Set a new password"
              : isResetPassword
              ? "Reset your password"
              : isMagicLink
              ? "Magic link sign in"
              : isLogin
              ? "Welcome back"
              : "Create an account"}
          </CardTitle>
          <CardDescription className="text-center">
            {isRecoveryMode
              ? "Choose a new password for your VoxPlan account."
              : isMagicLink
              ? "Enter your email to receive a magic sign-in link."
              : isResetPassword
              ? "Enter your email to receive a password reset link."
              : isLogin
              ? "Sign in to your VoxPlan account."
              : "Sign up to start using VoxPlan."}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleAuth}>
          <CardContent className="space-y-4">
            {!isRecoveryMode && (
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            )}
            {!isResetPassword && !isMagicLink && !isRecoveryMode && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            )}
            {isRecoveryMode && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-new-password">Confirm New Password</Label>
                  <Input
                    id="confirm-new-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? "Loading..."
                : isRecoveryMode
                ? "Set New Password"
                : isMagicLink
                ? "Send Magic Link"
                : isResetPassword
                ? "Send Reset Link"
                : isLogin
                ? "Sign In"
                : "Sign Up"}
            </Button>
            {isLogin && !isResetPassword && !isMagicLink && !isRecoveryMode && (
              <Button
                type="button"
                variant="link"
                className="w-full text-sm"
                onClick={() => setIsMagicLink(true)}
              >
                Sign in with magic link instead
              </Button>
            )}
            {isLogin && !isResetPassword && !isMagicLink && !isRecoveryMode && (
              <Button
                type="button"
                variant="link"
                className="w-full text-sm"
                onClick={() => setIsResetPassword(true)}
              >
                Forgot password?
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setIsResetPassword(false);
                setIsMagicLink(false);
                setIsRecoveryMode(false);
                setPassword("");
                setNewPassword("");
                setConfirmNewPassword("");
                setIsLogin(!isLogin);
              }}
            >
              {isRecoveryMode || isMagicLink || isResetPassword
                ? "Back to sign in"
                : isLogin
                ? "Don't have an account? Sign up"
                : "Already have an account? Sign in"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default Auth;
