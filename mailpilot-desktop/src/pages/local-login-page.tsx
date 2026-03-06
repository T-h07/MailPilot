import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type LocalLoginPageProps = {
  isLoading: boolean;
  error: string | null;
  onLogin: (password: string) => Promise<void>;
  onForgotPassword: () => void;
};

export function LocalLoginPage({
  isLoading,
  error,
  onLogin,
  onForgotPassword,
}: LocalLoginPageProps) {
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (error) {
      setLocalError(error);
    }
  }, [error]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password.trim()) {
      setLocalError("Password is required.");
      return;
    }

    setLocalError(null);
    await onLogin(password);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription className="pt-1 text-sm text-muted-foreground">
            Unlock MailPilot with your local password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <Input
              autoComplete="current-password"
              disabled={isLoading}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              type="password"
              value={password}
            />
            {(localError || error) && (
              <p className="text-sm text-destructive">{localError ?? error ?? "Login failed."}</p>
            )}
            <Button className="w-full" disabled={isLoading} type="submit">
              {isLoading ? "Logging in..." : "Login"}
            </Button>
            <Button
              className="w-full"
              disabled={isLoading}
              onClick={onForgotPassword}
              type="button"
              variant="ghost"
            >
              Forgot password?
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
