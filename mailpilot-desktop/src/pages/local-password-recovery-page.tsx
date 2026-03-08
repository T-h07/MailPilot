import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, LifeBuoy, MailCheck, ShieldAlert, ShieldCheck } from "lucide-react";
import { ApiClientError } from "@/api/client";
import { AuthShell } from "@/components/common/auth-shell";
import { StatePanel } from "@/components/common/state-panel";
import { Button } from "@/components/ui/button";
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
    <AuthShell
      badge="Recovery"
      description="Recover the local MailPilot password through the primary Gmail account connected to this desktop install."
      title="Reset local app password"
    >
      {stage === "LOADING" && (
        <StatePanel
          description="Checking whether the connected primary account can deliver recovery codes."
          title="Loading recovery options"
          variant="loading"
        />
      )}

      {(stage === "INTRO" || stage === "SENDING") && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
            <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
              MailPilot can email a one-time recovery code to your primary connected account.
            </p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm">
            Recovery email: <span className="font-medium">{maskedEmail ?? "Unavailable"}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button disabled={stage === "SENDING"} onClick={() => void handleSendCode()}>
              {stage === "SENDING" ? "Sending..." : "Send recovery code"}
            </Button>
            <Button onClick={() => navigate("/login", { replace: true })} variant="outline">
              Back to login
            </Button>
          </div>
        </div>
      )}

      {(stage === "CODE_SENT" || stage === "VERIFYING") && (
        <div className="space-y-4">
          <StatePanel
            compact
            description={
              <>
                We sent a recovery code to{" "}
                <span className="font-medium text-foreground">
                  {maskedEmail ?? "your primary account"}
                </span>
                . Enter it below and choose a new local app password.
              </>
            }
            icon={MailCheck}
            title="Recovery code sent"
            variant="success"
          />
          <div className="space-y-3">
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
              placeholder="New local password"
              type="password"
              value={newPassword}
            />
            <Input
              autoComplete="new-password"
              disabled={stage === "VERIFYING"}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm new local password"
              type="password"
              value={confirmPassword}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button
              className="gap-2"
              disabled={!canSubmitReset || stage === "VERIFYING"}
              onClick={() => void handleResetPassword()}
            >
              <KeyRound className="h-4 w-4" />
              {stage === "VERIFYING" ? "Resetting..." : "Reset password"}
            </Button>
            <Button
              disabled={cooldownSeconds > 0 || stage === "VERIFYING"}
              onClick={() => void handleSendCode()}
              variant="outline"
            >
              {cooldownSeconds > 0 ? `Resend in ${cooldownSeconds}s` : "Resend code"}
            </Button>
            <Button onClick={() => navigate("/login", { replace: true })} variant="outline">
              Back
            </Button>
          </div>
        </div>
      )}

      {stage === "SUCCESS" && (
        <div className="space-y-4">
          <StatePanel
            description="Your local app password has been updated. Return to login and unlock MailPilot with the new password."
            icon={ShieldCheck}
            title="Password updated"
            variant="success"
          />
          <Button className="w-full" onClick={() => navigate("/login", { replace: true })}>
            Return to login
          </Button>
        </div>
      )}

      {stage === "UNAVAILABLE" && (
        <div className="space-y-4">
          <StatePanel
            actions={
              <>
                <Button onClick={() => navigate("/login", { replace: true })} variant="outline">
                  Back to login
                </Button>
                {reason !== "NO_PRIMARY" ? (
                  <Button
                    disabled={isReconnecting}
                    onClick={() => void handleReconnectGmail()}
                    variant="outline"
                  >
                    {isReconnecting ? "Reconnecting..." : "Reconnect Gmail"}
                  </Button>
                ) : null}
                <Button onClick={() => setShowResetHelp((previous) => !previous)} variant="outline">
                  Reset app instead
                </Button>
              </>
            }
            description={unavailableReasonText(reason)}
            icon={ShieldAlert}
            title="Recovery code unavailable"
            variant="error"
          />
          {showResetHelp && (
            <StatePanel
              compact
              description="If recovery stays unavailable, use the Settings > Danger Zone reset flow when you regain access, or follow your local ops reset process to return to onboarding."
              icon={LifeBuoy}
              title="Fallback path"
              variant="info"
            />
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
    </AuthShell>
  );
}
