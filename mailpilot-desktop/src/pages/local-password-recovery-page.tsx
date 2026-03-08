import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiClientError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { configCheck, startGmailOAuth } from "@/lib/api/oauth";
import {
  getRecoveryOptions,
  requestRecoveryCode,
  verifyRecoveryCode,
  type RecoveryReason,
} from "@/lib/api/app-state";
import { openGmailOAuthUrl, waitForGmailOAuthOutcome } from "@/lib/oauth/gmail-oauth-flow";
import { toApiErrorMessage } from "@/utils/api-error";

type RecoveryStage =
  | "LOADING"
  | "INTRO"
  | "SENDING"
  | "CODE_SENT"
  | "VERIFYING"
  | "SUCCESS"
  | "UNAVAILABLE";
function unavailableReasonText(reason: RecoveryReason | null): string {
  if (reason === "NO_PRIMARY") {
    return "No primary account is connected.";
  }
  if (reason === "PRIMARY_REAUTH_REQUIRED") {
    return "Your primary Gmail account needs to be reconnected to enable recovery sending.";
  }
  if (reason === "SEND_DISABLED") {
    return "Your primary Gmail account needs to be reconnected to enable recovery sending.";
  }
  return "Recovery is currently unavailable.";
}

export function LocalPasswordRecoveryPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<RecoveryStage>("LOADING");
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [primaryEmail, setPrimaryEmail] = useState<string | null>(null);
  const [reason, setReason] = useState<RecoveryReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [showResetHelp, setShowResetHelp] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadOptions = async () => {
      setError(null);
      setStage("LOADING");
      try {
        const options = await getRecoveryOptions();
        if (cancelled) {
          return;
        }
        setMaskedEmail(options.maskedEmail);
        setPrimaryEmail(options.primaryEmail);
        setReason(options.reason);
        setStage(options.canRecover ? "INTRO" : "UNAVAILABLE");
      } catch (requestError) {
        if (cancelled) {
          return;
        }
        setError(toApiErrorMessage(requestError));
        setStage("UNAVAILABLE");
      }
    };
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setCooldownSeconds((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [cooldownSeconds]);

  const canSubmitReset = useMemo(
    () => code.trim().length > 0 && newPassword.length >= 8 && confirmPassword.length >= 8,
    [code, newPassword, confirmPassword]
  );

  const handleSendCode = async () => {
    setError(null);
    setStage("SENDING");
    try {
      const response = await requestRecoveryCode();
      setCooldownSeconds(response.cooldownSeconds ?? 60);
      setStage("CODE_SENT");
    } catch (requestError) {
      setError(toApiErrorMessage(requestError));
      setStage("INTRO");
    }
  };

  const handleResetPassword = async () => {
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Password confirmation does not match.");
      return;
    }
    setError(null);
    setStage("VERIFYING");
    try {
      await verifyRecoveryCode(code.trim(), newPassword, confirmPassword);
      setStage("SUCCESS");
    } catch (requestError) {
      setError(toApiErrorMessage(requestError));
      setStage("CODE_SENT");
    }
  };

  const refreshRecoveryOptions = async () => {
    const options = await getRecoveryOptions();
    setMaskedEmail(options.maskedEmail);
    setPrimaryEmail(options.primaryEmail);
    setReason(options.reason);
    setStage(options.canRecover ? "INTRO" : "UNAVAILABLE");
  };

  const handleReconnectGmail = async () => {
    setError(null);
    setIsReconnecting(true);
    try {
      const oauthConfig = await configCheck();
      if (!oauthConfig.configured) {
        throw new ApiClientError(oauthConfig.message || "Google OAuth configuration is missing.");
      }

      const startResponse = await startGmailOAuth({
        mode: "SEND",
        context: "RECOVERY_REAUTH",
        accountHint: primaryEmail ?? undefined,
      });

      await openGmailOAuthUrl(startResponse.authUrl, {
        errorMessage: "Unable to open the browser for Google OAuth.",
      });
      await waitForGmailOAuthOutcome(startResponse.state, {
        timeoutMessage: "Gmail reconnect timed out. Complete consent and retry.",
      });
      await refreshRecoveryOptions();
    } catch (requestError) {
      setError(toApiErrorMessage(requestError));
    } finally {
      setIsReconnecting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg border-border bg-card">
        <CardHeader>
          <CardTitle className="text-2xl">Reset local app password</CardTitle>
          <CardDescription>
            Recover access to MailPilot using your primary connected Gmail account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stage === "LOADING" && (
            <p className="text-sm text-muted-foreground">Loading recovery options...</p>
          )}

          {(stage === "INTRO" || stage === "SENDING") && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                We can send a one-time recovery code to your primary MailPilot account.
              </p>
              <div className="rounded-md border border-border bg-background/70 px-3 py-2 text-sm">
                Recovery email: <span className="font-medium">{maskedEmail ?? "Unavailable"}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={stage === "SENDING"} onClick={() => void handleSendCode()}>
                  {stage === "SENDING" ? "Sending..." : "Send recovery code"}
                </Button>
                <Button onClick={() => navigate("/login", { replace: true })} variant="ghost">
                  Back to login
                </Button>
              </div>
            </div>
          )}

          {(stage === "CODE_SENT" || stage === "VERIFYING") && (
            <div className="space-y-3">
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
                We sent a code to{" "}
                <span className="font-medium">{maskedEmail ?? "your primary account"}</span>.
              </div>
              <Input
                disabled={stage === "VERIFYING"}
                maxLength={8}
                onChange={(event) => setCode(event.target.value)}
                placeholder="6-digit recovery code"
                value={code}
              />
              <Input
                autoComplete="new-password"
                disabled={stage === "VERIFYING"}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="New password"
                type="password"
                value={newPassword}
              />
              <Input
                autoComplete="new-password"
                disabled={stage === "VERIFYING"}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm new password"
                type="password"
                value={confirmPassword}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!canSubmitReset || stage === "VERIFYING"}
                  onClick={() => void handleResetPassword()}
                >
                  {stage === "VERIFYING" ? "Resetting..." : "Reset password"}
                </Button>
                <Button
                  disabled={cooldownSeconds > 0 || stage === "VERIFYING"}
                  onClick={() => void handleSendCode()}
                  variant="outline"
                >
                  {cooldownSeconds > 0 ? `Resend in ${cooldownSeconds}s` : "Resend code"}
                </Button>
                <Button onClick={() => navigate("/login", { replace: true })} variant="ghost">
                  Back
                </Button>
              </div>
            </div>
          )}

          {stage === "SUCCESS" && (
            <div className="space-y-3">
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
                Your local app password has been updated.
              </div>
              <Button className="w-full" onClick={() => navigate("/login", { replace: true })}>
                Return to login
              </Button>
            </div>
          )}

          {stage === "UNAVAILABLE" && (
            <div className="space-y-3">
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                MailPilot can&apos;t send a recovery code right now.
                <p className="pt-1 text-muted-foreground">{unavailableReasonText(reason)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => navigate("/login", { replace: true })} variant="ghost">
                  Back to login
                </Button>
                {reason !== "NO_PRIMARY" && (
                  <Button
                    disabled={isReconnecting}
                    onClick={() => void handleReconnectGmail()}
                    variant="outline"
                  >
                    {isReconnecting ? "Reconnecting..." : "Reconnect Gmail"}
                  </Button>
                )}
                <Button onClick={() => setShowResetHelp((previous) => !previous)} variant="outline">
                  Reset app instead
                </Button>
              </div>
              {showResetHelp && (
                <div className="rounded-md border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                  If recovery stays unavailable, use the existing reset flow from Settings &gt;
                  Danger Zone when you can access the app, or use your ops reset procedure to return
                  to onboarding.
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
