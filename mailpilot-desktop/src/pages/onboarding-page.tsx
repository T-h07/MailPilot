import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppStateRecord } from "@/lib/api/app-state";
import {
  listAccounts,
  type AccountRecord,
  type AccountRole,
  updateAccountLabel,
} from "@/lib/api/accounts";
import {
  completeOnboarding,
  completeOnboardingAccountsStep,
  confirmPrimaryOnboardingAccount,
  startOnboarding,
} from "@/lib/api/onboarding";
import { configCheck, getGmailOAuthStatus, startGmailOAuth } from "@/lib/api/oauth";
import { ApiClientError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type OnboardingPageProps = {
  appState: AppStateRecord;
  onEnterInbox: () => Promise<void>;
};

type WizardStep = 1 | 2 | 3 | 4 | 5;

type RoleDraft = {
  role: AccountRole;
  customLabel: string;
};

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
const ROLE_SAVE_DEBOUNCE_MS = 300;
const SAVE_HINT_LIFETIME_MS = 1800;

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
  if (step === 4) {
    return 4;
  }
  return 5;
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

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function normalizeRoleDraft(account: AccountRecord): RoleDraft {
  return {
    role: account.role,
    customLabel: account.customLabel ?? "",
  };
}

export function OnboardingPage({ appState, onEnterInbox }: OnboardingPageProps) {
  const navigate = useNavigate();
  const initialField = initialFieldChoice(appState.profile?.fieldOfWork);

  const [step, setStep] = useState<WizardStep>(() =>
    appState.onboardingComplete ? 5 : clampStep(appState.onboardingStep)
  );
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submittingProfile, setSubmittingProfile] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [roleSavingByAccountId, setRoleSavingByAccountId] = useState<Record<string, boolean>>({});
  const [roleErrorByAccountId, setRoleErrorByAccountId] = useState<Record<string, string>>({});
  const [roleSavedHintByAccountId, setRoleSavedHintByAccountId] = useState<Record<string, boolean>>(
    {}
  );
  const [roleDraftByAccountId, setRoleDraftByAccountId] = useState<Record<string, RoleDraft>>({});
  const saveTimeoutsRef = useRef<Map<string, number>>(new Map());
  const savedHintTimeoutsRef = useRef<Map<string, number>>(new Map());

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

  useEffect(() => {
    const nextDrafts: Record<string, RoleDraft> = {};
    for (const account of accounts) {
      nextDrafts[account.id] = normalizeRoleDraft(account);
    }
    setRoleDraftByAccountId(nextDrafts);
  }, [accounts]);

  useEffect(() => {
    return () => {
      for (const timeoutId of saveTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      saveTimeoutsRef.current.clear();
      for (const timeoutId of savedHintTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      savedHintTimeoutsRef.current.clear();
    };
  }, []);

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

  const showSavedHint = useCallback((accountId: string) => {
    const previousHintTimeout = savedHintTimeoutsRef.current.get(accountId);
    if (previousHintTimeout !== undefined) {
      window.clearTimeout(previousHintTimeout);
      savedHintTimeoutsRef.current.delete(accountId);
    }

    setRoleSavedHintByAccountId((previous) => ({
      ...previous,
      [accountId]: true,
    }));

    const timeoutId = window.setTimeout(() => {
      setRoleSavedHintByAccountId((previous) => {
        if (!(accountId in previous)) {
          return previous;
        }
        const { [accountId]: _removed, ...rest } = previous;
        return rest;
      });
      savedHintTimeoutsRef.current.delete(accountId);
    }, SAVE_HINT_LIFETIME_MS);

    savedHintTimeoutsRef.current.set(accountId, timeoutId);
  }, []);

  const persistRole = useCallback(
    async (accountId: string, draft: RoleDraft) => {
      if (draft.role === "CUSTOM" && !draft.customLabel.trim()) {
        setRoleErrorByAccountId((previous) => ({
          ...previous,
          [accountId]: "Custom label is required.",
        }));
        return;
      }

      setRoleSavingByAccountId((previous) => ({
        ...previous,
        [accountId]: true,
      }));
      setRoleErrorByAccountId((previous) => withoutKey(previous, accountId));

      try {
        await updateAccountLabel(accountId, {
          role: draft.role,
          customLabel: draft.role === "CUSTOM" ? draft.customLabel.trim() : null,
        });
        await loadAccounts();
        showSavedHint(accountId);
      } catch (error) {
        setRoleErrorByAccountId((previous) => ({
          ...previous,
          [accountId]: toErrorMessage(error),
        }));
      } finally {
        setRoleSavingByAccountId((previous) => ({
          ...previous,
          [accountId]: false,
        }));
      }
    },
    [loadAccounts, showSavedHint]
  );

  const queueRoleSave = useCallback(
    (accountId: string, draft: RoleDraft) => {
      const previousTimeout = saveTimeoutsRef.current.get(accountId);
      if (previousTimeout !== undefined) {
        window.clearTimeout(previousTimeout);
        saveTimeoutsRef.current.delete(accountId);
      }

      const timeoutId = window.setTimeout(() => {
        void persistRole(accountId, draft);
        saveTimeoutsRef.current.delete(accountId);
      }, ROLE_SAVE_DEBOUNCE_MS);

      saveTimeoutsRef.current.set(accountId, timeoutId);
    },
    [persistRole]
  );

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

  const runOauthConnectFlow = useCallback(
    async (beforeIds: Set<string>) => {
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
      } catch (_error) {
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
              account.provider === "GMAIL" && isConnected(account) && account.role === "PRIMARY"
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

      return selectedAccount;
    },
    [loadAccounts]
  );

  const connectPrimaryAccount = async () => {
    setBusy(true);
    setPageError(null);
    try {
      const beforeAccounts = await listAccounts();
      const beforeIds = new Set(beforeAccounts.map((account) => account.id));
      const selectedAccount = await runOauthConnectFlow(beforeIds);

      await confirmPrimaryOnboardingAccount(selectedAccount.id);
      await loadAccounts();
      setStep(3);
    } catch (error) {
      setPageError(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const connectSecondaryAccount = async () => {
    setBusy(true);
    setPageError(null);
    try {
      const beforeAccounts = await listAccounts();
      const beforeIds = new Set(beforeAccounts.map((account) => account.id));
      const selectedAccount = await runOauthConnectFlow(beforeIds);

      if (selectedAccount.role !== "PRIMARY") {
        await updateAccountLabel(selectedAccount.id, {
          role: "SECONDARY",
          customLabel: null,
        });
      }
      await loadAccounts();
    } catch (error) {
      setPageError(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const continueFromAccountsStep = async () => {
    setBusy(true);
    setPageError(null);
    try {
      await completeOnboardingAccountsStep();
      setStep(4);
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
      setStep(5);
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
                Connect Primary
              </span>
              <span
                className={`rounded-full px-2 py-1 ${step >= 3 ? "bg-accent text-foreground" : "bg-muted text-muted-foreground"}`}
              >
                Accounts
              </span>
              <span
                className={`rounded-full px-2 py-1 ${step >= 4 ? "bg-accent text-foreground" : "bg-muted text-muted-foreground"}`}
              >
                Profile + Password
              </span>
              <span
                className={`rounded-full px-2 py-1 ${step >= 5 ? "bg-accent text-foreground" : "bg-muted text-muted-foreground"}`}
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
                Setup will connect your primary Gmail account, optionally add more accounts, save
                your profile, and configure a local app password.
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
              <h2 className="text-lg font-semibold">Add More Accounts</h2>
              <p className="text-sm text-muted-foreground">
                Primary account is used for default inbox behavior and sending later. You can
                change account roles later in Settings.
              </p>

              <div className="space-y-2">
                {loadingAccounts ? (
                  <p className="text-sm text-muted-foreground">Loading connected accounts...</p>
                ) : accounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No accounts connected yet.</p>
                ) : (
                  accounts.map((account) => {
                    const roleDraft = roleDraftByAccountId[account.id] ?? normalizeRoleDraft(account);
                    const roleSaving = roleSavingByAccountId[account.id] ?? false;
                    const roleError = roleErrorByAccountId[account.id] ?? null;
                    const savedHint = roleSavedHintByAccountId[account.id] ?? false;

                    return (
                      <div
                        className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
                        key={account.id}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{account.provider}</Badge>
                          <span className="text-sm font-medium">{account.email}</span>
                          <Badge variant={isConnected(account) ? "secondary" : "outline"}>
                            {account.status}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            className="h-9 min-w-[140px] rounded-md border border-input bg-background px-2 text-xs"
                            disabled={roleSaving || busy}
                            onChange={(event) => {
                              const nextRole = event.target.value as AccountRole;
                              const nextDraft: RoleDraft = {
                                role: nextRole,
                                customLabel:
                                  nextRole === "CUSTOM" ? roleDraft.customLabel : "",
                              };
                              setRoleDraftByAccountId((previous) => ({
                                ...previous,
                                [account.id]: nextDraft,
                              }));
                              queueRoleSave(account.id, nextDraft);
                            }}
                            value={roleDraft.role}
                          >
                            <option value="PRIMARY">Primary</option>
                            <option value="SECONDARY">Secondary</option>
                            <option value="CUSTOM">Custom</option>
                          </select>
                          {roleDraft.role === "CUSTOM" && (
                            <Input
                              className="h-9 w-[180px] text-xs"
                              disabled={roleSaving || busy}
                              maxLength={30}
                              onChange={(event) => {
                                const nextDraft: RoleDraft = {
                                  role: "CUSTOM",
                                  customLabel: event.target.value,
                                };
                                setRoleDraftByAccountId((previous) => ({
                                  ...previous,
                                  [account.id]: nextDraft,
                                }));
                                queueRoleSave(account.id, nextDraft);
                              }}
                              placeholder="Custom label"
                              value={roleDraft.customLabel}
                            />
                          )}
                          {roleSaving ? (
                            <span className="text-xs text-muted-foreground">Saving...</span>
                          ) : null}
                          {!roleSaving && savedHint ? (
                            <span className="text-xs text-muted-foreground">Saved</span>
                          ) : null}
                        </div>
                        {roleError ? <p className="text-xs text-destructive">{roleError}</p> : null}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void connectSecondaryAccount()}>
                  {busy ? "Connecting..." : "Connect another Gmail"}
                </Button>
                <Button disabled={busy} onClick={() => setStep(2)} variant="outline">
                  Back
                </Button>
                <Button disabled={busy} onClick={() => void continueFromAccountsStep()} variant="secondary">
                  Continue
                </Button>
                <Button disabled={busy} onClick={() => void continueFromAccountsStep()} variant="ghost">
                  Skip
                </Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Profile and Password</h2>
              <p className="text-sm text-muted-foreground">
                This profile is local to this desktop app and used for onboarding.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  disabled={submittingProfile}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, firstName: event.target.value }))
                  }
                  placeholder="First name"
                  value={form.firstName}
                />
                <Input
                  disabled={submittingProfile}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, lastName: event.target.value }))
                  }
                  placeholder="Last name"
                  value={form.lastName}
                />
              </div>
              <div className="space-y-2">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  disabled={submittingProfile}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, fieldChoice: event.target.value }))
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
                      setForm((previous) => ({ ...previous, fieldOther: event.target.value }))
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
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, password: event.target.value }))
                  }
                  placeholder="Password"
                  type="password"
                  value={form.password}
                />
                <Input
                  autoComplete="new-password"
                  disabled={submittingProfile}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, confirmPassword: event.target.value }))
                  }
                  placeholder="Confirm password"
                  type="password"
                  value={form.confirmPassword}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setStep(3)} variant="outline">
                  Back
                </Button>
                <Button disabled={submittingProfile} onClick={() => void completeSetup()}>
                  {submittingProfile ? "Finishing..." : "Finish setup"}
                </Button>
              </div>
              {profileError ? <p className="text-sm text-destructive">{profileError}</p> : null}
            </div>
          )}

          {step === 5 && (
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
