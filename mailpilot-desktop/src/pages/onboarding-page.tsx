import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppStateRecord } from "@/lib/api/app-state";
import { listAccounts, type AccountRecord } from "@/lib/api/accounts";
import { completeOnboarding, confirmPrimaryOnboardingAccount, startOnboarding } from "@/lib/api/onboarding";
import { configCheck, getGmailOAuthStatus, startGmailOAuth } from "@/lib/api/oauth";
import { ApiClientError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type OnboardingPageProps = {
  appState: AppStateRecord;
  onEnterInbox: () => Promise<void>;
};

type WizardStep = 1 | 2 | 3 | 4;

type ProfileForm = {
  firstName: string;
  lastName: string;
  fieldChoice: string;
  fieldOther: string;
  password: string;
  confirmPassword: string;
};

const FIELD_OF_WORK_OPTIONS = [
  "Engineering",
  "Product",
  "Design",
  "Marketing",
  "Sales",
  "Finance",
  "Operations",
  "Customer Success",
  "Other",
] as const;

const OAUTH_POLL_INTERVAL_MS = 2000;
const OAUTH_POLL_TIMEOUT_MS = 45000;

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
}

function clampStep(step: number | undefined): WizardStep {
  if (!step || Number.isNaN(step)) {
    return 1;
  }
  if (step <= 1) {
    return 1;
  }
  if (step === 2) {
    return 2;
  }
  if (step === 3) {
    return 3;
  }
  return 4;
}

function initialFieldChoice(fieldOfWork: string | null | undefined): {
  choice: string;
  other: string;
} {
  if (!fieldOfWork) {
    return { choice: "Engineering", other: "" };
  }
  if ((FIELD_OF_WORK_OPTIONS as readonly string[]).includes(fieldOfWork)) {
    return { choice: fieldOfWork, other: "" };
  }
  return { choice: "Other", other: fieldOfWork };
}

function isConnected(account: AccountRecord): boolean {
  return account.status === "CONNECTED" || account.status === "REAUTH_REQUIRED";
}

export function OnboardingPage({ appState, onEnterInbox }: OnboardingPageProps) {
  const navigate = useNavigate();
  const initialField = initialFieldChoice(appState.profile?.fieldOfWork);
  const [step, setStep] = useState<WizardStep>(() =>
    appState.onboardingComplete ? 4 : clampStep(appState.onboardingStep)
  );
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submittingProfile, setSubmittingProfile] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm>({
    firstName: appState.profile?.firstName ?? "",
    lastName: appState.profile?.lastName ?? "",
    fieldChoice: initialField.choice,
    fieldOther: initialField.other,
    password: "",
    confirmPassword: "",
  });

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const nextAccounts = await listAccounts();
      setAccounts(nextAccounts);
      return nextAccounts;
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const primaryAccount = useMemo(
    () => accounts.find((account) => account.provider === "GMAIL" && account.role === "PRIMARY"),
    [accounts]
  );

  const connectedPrimary = useMemo(
    () => (primaryAccount && isConnected(primaryAccount) ? primaryAccount : null),
    [primaryAccount]
  );

  useEffect(() => {
    if (!appState.onboardingComplete && connectedPrimary && step < 3) {
      setStep(3);
    }
  }, [appState.onboardingComplete, connectedPrimary, step]);

  const startSetup = async () => {
    setBusy(true);
    setPageError(null);
    try {
      const response = await startOnboarding();
      setStep(clampStep(response.step));
    } catch (error) {
      setPageError(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const connectPrimaryAccount = async () => {
    setBusy(true);
    setPageError(null);
    try {
      const beforeAccounts = await listAccounts();
      const beforeIds = new Set(beforeAccounts.map((account) => account.id));

      const config = await configCheck();
      if (!config.configured) {
        throw new ApiClientError(config.message || "Google OAuth configuration is missing.");
      }

      const oauth = await startGmailOAuth({
        mode: "READONLY",
        returnTo: "/onboarding",
      });

      try {
        await openUrl(oauth.authUrl);
      } catch (error) {
        throw new ApiClientError("Unable to open the browser for Google OAuth.");
      }

      const startedAt = Date.now();
      let status: "PENDING" | "SUCCESS" | "ERROR" | "UNKNOWN" = "PENDING";
      let statusMessage = "Waiting for Google OAuth confirmation...";
      while (Date.now() - startedAt < OAUTH_POLL_TIMEOUT_MS) {
        const poll = await getGmailOAuthStatus(oauth.state);
        status = poll.status;
        statusMessage = poll.message || statusMessage;
        if (status === "SUCCESS") {
          break;
        }
        if (status === "ERROR" || status === "UNKNOWN") {
          throw new ApiClientError(statusMessage || "OAuth flow failed.");
        }
        await new Promise((resolve) => window.setTimeout(resolve, OAUTH_POLL_INTERVAL_MS));
      }

      if (status !== "SUCCESS") {
        throw new ApiClientError(
          "Gmail connection timed out. Complete browser consent and try again."
        );
      }

      let selectedAccount: AccountRecord | null = null;
      const waitStart = Date.now();
      while (Date.now() - waitStart < OAUTH_POLL_TIMEOUT_MS) {
        const latestAccounts = await loadAccounts();
        selectedAccount =
          latestAccounts.find(
            (account) =>
              account.provider === "GMAIL" && isConnected(account) && !beforeIds.has(account.id)
          ) ??
          latestAccounts.find(
            (account) =>
              account.provider === "GMAIL" &&
              isConnected(account) &&
              (account.role === "PRIMARY" || beforeIds.has(account.id))
          ) ??
          null;

        if (selectedAccount) {
          break;
        }

        await new Promise((resolve) => window.setTimeout(resolve, OAUTH_POLL_INTERVAL_MS));
      }

      if (!selectedAccount) {
        throw new ApiClientError("Connected account was not detected. Please retry.");
      }

      await confirmPrimaryOnboardingAccount(selectedAccount.id);
      await loadAccounts();
      setStep(3);
    } catch (error) {
      setPageError(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const completeSetup = async () => {
    setSubmittingProfile(true);
    setProfileError(null);
    try {
      const firstName = form.firstName.trim();
      const lastName = form.lastName.trim();
      const fieldOfWork =
        form.fieldChoice === "Other" ? form.fieldOther.trim() : form.fieldChoice.trim();
      const password = form.password;
      const confirmPassword = form.confirmPassword;

      if (!firstName || firstName.length > 40 || !/^[\p{L}][\p{L} '\-]{0,39}$/u.test(firstName)) {
        throw new ApiClientError("First name must be 1-40 chars and contain letters/spaces.");
      }
      if (!lastName || lastName.length > 40 || !/^[\p{L}][\p{L} '\-]{0,39}$/u.test(lastName)) {
        throw new ApiClientError("Last name must be 1-40 chars and contain letters/spaces.");
      }
      if (!fieldOfWork || fieldOfWork.length > 60) {
        throw new ApiClientError("Field of work must be 1-60 characters.");
      }
      if (password.length < 8 || password.length > 128) {
        throw new ApiClientError("Password must be between 8 and 128 characters.");
      }
      if (password !== confirmPassword) {
        throw new ApiClientError("Password confirmation does not match.");
      }

      await completeOnboarding({
        firstName,
        lastName,
        fieldOfWork,
        password,
      });
      setStep(4);
    } catch (error) {
      setProfileError(toErrorMessage(error));
    } finally {
      setSubmittingProfile(false);
    }
  };

  const enterInbox = async () => {
    await onEnterInbox();
    navigate("/inbox", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-3xl border-border bg-card">
        <CardHeader>
          <CardTitle className="text-2xl">MailPilot Setup</CardTitle>
          <CardDescription className="pt-1 text-sm text-muted-foreground">
            Complete these steps once to start using MailPilot.
          </CardDescription>
          <div className="pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-1 ${step >= 1 ? "bg-accent text-foreground" : "bg-muted text-muted-foreground"}`}
              >
                Welcome
              </span>
              <span
                className={`rounded-full px-2 py-1 ${step >= 2 ? "bg-accent text-foreground" : "bg-muted text-muted-foreground"}`}
              >
                Connect Gmail
              </span>
              <span
                className={`rounded-full px-2 py-1 ${step >= 3 ? "bg-accent text-foreground" : "bg-muted text-muted-foreground"}`}
              >
                Profile + Password
              </span>
              <span
                className={`rounded-full px-2 py-1 ${step >= 4 ? "bg-accent text-foreground" : "bg-muted text-muted-foreground"}`}
              >
                Done
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Welcome to MailPilot</h2>
              <p className="text-sm text-muted-foreground">
                Setup will connect your primary Gmail account, save your profile, and configure a
                local app password.
              </p>
              <Button disabled={busy} onClick={() => void startSetup()}>
                {busy ? "Starting..." : "Start Setup"}
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Connect Primary Gmail</h2>
              <p className="text-sm text-muted-foreground">
                Connect the Gmail account you use as your primary inbox.
              </p>
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                {loadingAccounts ? (
                  <span className="text-muted-foreground">Checking connected accounts...</span>
                ) : connectedPrimary ? (
                  <span>
                    Connected: <strong>{connectedPrimary.email}</strong> (Primary)
                  </span>
                ) : (
                  <span className="text-muted-foreground">No primary Gmail connected yet.</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void connectPrimaryAccount()}>
                  {busy ? "Connecting..." : "Connect Gmail"}
                </Button>
                <Button onClick={() => setStep(1)} variant="outline">
                  Back
                </Button>
                <Button
                  disabled={!connectedPrimary || busy}
                  onClick={() => setStep(3)}
                  variant="secondary"
                >
                  Continue
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Profile and Password</h2>
              <p className="text-sm text-muted-foreground">
                This profile is local to this desktop app and used for onboarding.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  disabled={submittingProfile}
                  onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
                  placeholder="First name"
                  value={form.firstName}
                />
                <Input
                  disabled={submittingProfile}
                  onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
                  placeholder="Last name"
                  value={form.lastName}
                />
              </div>
              <div className="space-y-2">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  disabled={submittingProfile}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, fieldChoice: event.target.value }))
                  }
                  value={form.fieldChoice}
                >
                  {FIELD_OF_WORK_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                {form.fieldChoice === "Other" && (
                  <Input
                    disabled={submittingProfile}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, fieldOther: event.target.value }))
                    }
                    placeholder="Field of work"
                    value={form.fieldOther}
                  />
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  autoComplete="new-password"
                  disabled={submittingProfile}
                  onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                  placeholder="Password"
                  type="password"
                  value={form.password}
                />
                <Input
                  autoComplete="new-password"
                  disabled={submittingProfile}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
                  }
                  placeholder="Confirm password"
                  type="password"
                  value={form.confirmPassword}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setStep(2)} variant="outline">
                  Back
                </Button>
                <Button disabled={submittingProfile} onClick={() => void completeSetup()}>
                  {submittingProfile ? "Finishing..." : "Finish setup"}
                </Button>
              </div>
              {profileError ? <p className="text-sm text-destructive">{profileError}</p> : null}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">You're ready</h2>
              <p className="text-sm text-muted-foreground">
                Setup is complete. MailPilot is ready for your inbox workflow.
              </p>
              <Button onClick={() => void enterInbox()}>Go to Inbox</Button>
            </div>
          )}

          {pageError ? <p className="text-sm text-destructive">{pageError}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
