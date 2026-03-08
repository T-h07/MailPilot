import { FormEvent, useEffect, useRef, useState } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type AppLockOverlayProps = {
  isUnlocking: boolean;
  error: string | null;
  onUnlock: (password: string) => Promise<void>;
  onForgotPassword: () => void;
};

export function AppLockOverlay({
  isUnlocking,
  error,
  onUnlock,
  onForgotPassword,
}: AppLockOverlayProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    await onUnlock(password);
    setPassword("");
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(234,179,8,0.14),_transparent_30%)]" />
      <Card className="relative w-full max-w-md border-border/80 bg-card/95 shadow-2xl">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-border/70 bg-background/80 p-2.5 text-sky-300">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>MailPilot is locked</CardTitle>
              <CardDescription className="pt-1">
                Enter your local app password to return to the inbox.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              This password only unlocks MailPilot on this device. It is not your Gmail password.
            </p>
          </div>
          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <Input
              autoComplete="current-password"
              disabled={isUnlocking}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              ref={inputRef}
              type="password"
              value={password}
            />
            {(localError || error) && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {localError ?? error ?? "Unlock failed."}
              </div>
            )}
            <Button className="w-full" disabled={isUnlocking} type="submit">
              {isUnlocking ? "Unlocking..." : "Unlock"}
            </Button>
            <Button
              className="w-full"
              disabled={isUnlocking}
              onClick={onForgotPassword}
              type="button"
              variant="outline"
            >
              Use recovery code
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
