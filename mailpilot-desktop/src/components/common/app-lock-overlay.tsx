import { FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type AppLockOverlayProps = {
  isUnlocking: boolean;
  error: string | null;
  onUnlock: (password: string) => Promise<void>;
};

export function AppLockOverlay({ isUnlocking, error, onUnlock }: AppLockOverlayProps) {
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md border-border bg-card/95">
        <CardHeader>
          <CardTitle>Locked</CardTitle>
          <CardDescription>Enter your password to unlock MailPilot.</CardDescription>
        </CardHeader>
        <CardContent>
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
              <p className="text-sm text-destructive">{localError ?? error ?? "Unlock failed."}</p>
            )}
            <Button className="w-full" disabled={isUnlocking} type="submit">
              {isUnlocking ? "Unlocking..." : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
