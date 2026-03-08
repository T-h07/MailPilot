import { FormEvent, useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/common/auth-shell";
import { Button } from "@/components/ui/button";
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
    <AuthShell
      badge="Local App Login"
      description="Use the local MailPilot password configured during onboarding to open this desktop workspace."
      title="Sign in to MailPilot"
    >
      <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
        <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          This password protects local MailPilot data only. It is separate from Gmail and can be
          recovered through your primary connected account.
        </p>
      </div>

      <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Local password
          </p>
          <Input
            autoComplete="current-password"
            disabled={isLoading}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter password"
            type="password"
            value={password}
          />
        </div>
        {(localError || error) && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {localError ?? error ?? "Login failed."}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button className="gap-2" disabled={isLoading} type="submit">
            <KeyRound className="h-4 w-4" />
            {isLoading ? "Unlocking..." : "Unlock MailPilot"}
          </Button>
          <Button
            className="gap-2"
            disabled={isLoading}
            onClick={onForgotPassword}
            type="button"
            variant="outline"
          >
            Forgot password?
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
