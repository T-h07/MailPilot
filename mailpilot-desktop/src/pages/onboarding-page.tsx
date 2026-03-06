import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Mail, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import type { AppStateRecord } from "@/lib/api/app-state";
import {
  listAccounts,
  type AccountRecord,
  type AccountRole,
  updateAccountLabel,
} from "@/lib/api/accounts";
import {
  applyOnboardingViewProposals,
  completeOnboarding,
  completeOnboardingAccountsStep,
  completeOnboardingViewProposalsStep,
  confirmPrimaryOnboardingAccount,
  fetchOnboardingViewProposals,
  startOnboarding,
  type OnboardingViewProposal,
} from "@/lib/api/onboarding";
import { configCheck, getGmailOAuthStatus, startGmailOAuth } from "@/lib/api/oauth";
import { getSyncStatus, runAllAccountsSync } from "@/lib/api/sync";
import { ApiClientError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type OnboardingPageProps = {
  appState: AppStateRecord;
  onEnterInbox: () => Promise<void>;
};

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

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

type ProposalDraft = {
  id: string;
  enabled: boolean;
  name: string;
  priority: number;
  explanation: string;
  estimatedCount: number;
  estimatedPct: number;
  scopeType: "ALL" | "SELECTED";
  selectedAccountIds: string[];
  senderDomains: string[];
  senderEmails: string[];
  subjectKeywords: string[];
  unreadOnly: boolean;
};

type PrimaryConnectState =
  | "IDLE"
  | "OPENING_BROWSER"
  | "WAITING_FOR_CALLBACK"
  | "CONNECTED"
  | "ERROR";

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
  if (step === 5) {
    return 5;
  }
  return 6;
}

function parseDelimitedList(value: string, maxItems: number): string[] {
  if (!value.trim()) {
    return [];
  }

  const deduped = new Set<string>();
  for (const token of value.split(",")) {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
    if (deduped.size >= maxItems) {
      break;
    }
  }

  return Array.from(deduped);
}

function formatDelimitedList(values: string[]): string {
  return values.join(", ");
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

function toFriendlyOAuthMessage(rawMessage: string | null | undefined): string {
  const message = (rawMessage ?? "").trim();
  const normalized = message.toLowerCase();
  if (
    normalized.includes("no oauth flow found") ||
    normalized.includes("invalid or expired") ||
    normalized.includes("oauth flow expired") ||
    normalized.includes("authorization code expired") ||
    normalized.includes("invalid state")
  ) {
    return "The Google sign-in session expired or became invalid. Please try connecting again.";
  }
  if (normalized.includes("timed out")) {
    return "Google sign-in timed out. Complete consent in the browser and try again.";
  }
  return message || "Google sign-in failed. Please try again.";
}

function normalizeRoleDraft(account: AccountRecord): RoleDraft {
  return {
    role: account.role,
    customLabel: account.customLabel ?? "",
  };
}

function toProposalDraft(proposal: OnboardingViewProposal): ProposalDraft {
  return {
    id: proposal.key,
    enabled: true,
    name: proposal.name,
    priority: proposal.priority,
    explanation: proposal.explanation,
    estimatedCount: proposal.estimatedCount,
    estimatedPct: proposal.estimatedPct,
    scopeType: proposal.accountsScope.type,
    selectedAccountIds: proposal.accountsScope.accountIds ?? [],
    senderDomains: proposal.rules.senderDomains ?? [],
    senderEmails: proposal.rules.senderEmails ?? [],
    subjectKeywords: proposal.rules.subjectKeywords ?? [],
    unreadOnly: proposal.rules.unreadOnly ?? false,
  };
}

export function OnboardingPage({ appState, onEnterInbox }: OnboardingPageProps) {
  const navigate = useNavigate();
  const initialField = initialFieldChoice(appState.profile?.fieldOfWork);

  const [step, setStep] = useState<WizardStep>(() =>
    appState.onboardingComplete ? 6 : clampStep(appState.onboardingStep)
  );
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submittingProfile, setSubmittingProfile] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [primaryConnectState, setPrimaryConnectState] = useState<PrimaryConnectState>("IDLE");
  const [primaryConnectError, setPrimaryConnectError] = useState<string | null>(null);
  const [primaryConnectedEmail, setPrimaryConnectedEmail] = useState<string | null>(null);
  const [activePrimaryOAuthState, setActivePrimaryOAuthState] = useState<string | null>(null);
  const [roleSavingByAccountId, setRoleSavingByAccountId] = useState<Record<string, boolean>>({});
  const [roleErrorByAccountId, setRoleErrorByAccountId] = useState<Record<string, string>>({});
  const [roleSavedHintByAccountId, setRoleSavedHintByAccountId] = useState<Record<string, boolean>>(
    {}
  );
  const [roleDraftByAccountId, setRoleDraftByAccountId] = useState<Record<string, RoleDraft>>({});
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [syncingProposals, setSyncingProposals] = useState(false);
  const [applyingProposals, setApplyingProposals] = useState(false);
  const [proposalMessage, setProposalMessage] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalDraft[]>([]);
  const [proposalsLoadedAtLeastOnce, setProposalsLoadedAtLeastOnce] = useState(false);
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

  const loadViewProposals = useCallback(async () => {
    setLoadingProposals(true);
    setProposalMessage(null);
    try {
      const response = await fetchOnboardingViewProposals("30d", 50);
      setProposals(response.proposals.map(toProposalDraft));
      setProposalMessage(response.message ?? null);
      setProposalsLoadedAtLeastOnce(true);
    } finally {
      setLoadingProposals(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (step === 4 && !loadingProposals && !proposalsLoadedAtLeastOnce) {
      void loadViewProposals();
    }
  }, [step, loadingProposals, proposalsLoadedAtLeastOnce, loadViewProposals]);

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

  const canContinuePrimaryStep =
    Boolean(connectedPrimary) ||
    (primaryConnectState === "CONNECTED" && Boolean(primaryConnectedEmail));

  useEffect(() => {
    if (connectedPrimary) {
      setPrimaryConnectState("CONNECTED");
      setPrimaryConnectedEmail(connectedPrimary.email);
      setPrimaryConnectError(null);
    } else if (primaryConnectState === "CONNECTED") {
      setPrimaryConnectState("IDLE");
      setPrimaryConnectedEmail(null);
    }
  }, [connectedPrimary, primaryConnectState]);

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
    async (beforeIds: Set<string>, context: string) => {
      const config = await configCheck();
      if (!config.configured) {
        throw new ApiClientError(config.message || "Google OAuth configuration is missing.");
      }

      const oauth = await startGmailOAuth({
        mode: "READONLY",
        context,
        returnTo: "/onboarding",
      });

      try {
        await openUrl(oauth.authUrl);
      } catch (_error) {
        throw new ApiClientError("Unable to open the browser for Google OAuth.");
      }

      const startedAt = Date.now();
      let status: "PENDING" | "SUCCESS" | "ERROR" | "EXPIRED" | "UNKNOWN" = "PENDING";
      let statusMessage = "Waiting for Google OAuth confirmation...";
      while (Date.now() - startedAt < OAUTH_POLL_TIMEOUT_MS) {
        const poll = await getGmailOAuthStatus(oauth.state);
        status = poll.status;
        statusMessage = poll.message || statusMessage;
        if (status === "SUCCESS") {
          break;
        }
        if (status === "ERROR" || status === "EXPIRED" || status === "UNKNOWN") {
          throw new ApiClientError(toFriendlyOAuthMessage(statusMessage));
        }
        await new Promise((resolve) => window.setTimeout(resolve, OAUTH_POLL_INTERVAL_MS));
      }

      if (status !== "SUCCESS") {
        throw new ApiClientError(toFriendlyOAuthMessage("Gmail connection timed out."));
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
    if (
      primaryConnectState === "OPENING_BROWSER" ||
      primaryConnectState === "WAITING_FOR_CALLBACK"
    ) {
      return;
    }

    setBusy(true);
    setPageError(null);
    setPrimaryConnectError(null);
    setPrimaryConnectedEmail(null);
    setActivePrimaryOAuthState(null);
    setPrimaryConnectState("OPENING_BROWSER");

    try {
      const config = await configCheck();
      if (!config.configured) {
        throw new ApiClientError(config.message || "Google OAuth configuration is missing.");
      }

      const oauth = await startGmailOAuth({
        mode: "READONLY",
        context: "ONBOARDING_PRIMARY",
        returnTo: "/onboarding",
      });
      setActivePrimaryOAuthState(oauth.state);

      try {
        await openUrl(oauth.authUrl);
      } catch {
        throw new ApiClientError("Unable to open the browser for Google OAuth.");
      }

      setPrimaryConnectState("WAITING_FOR_CALLBACK");

      const pollStartedAt = Date.now();
      let resolvedAccountId: string | null = null;
      let resolvedEmail: string | null = null;

      while (Date.now() - pollStartedAt < OAUTH_POLL_TIMEOUT_MS) {
        const poll = await getGmailOAuthStatus(oauth.state);
        if (poll.status === "SUCCESS") {
          resolvedAccountId = poll.accountId;
          resolvedEmail = poll.email;
          break;
        }
        if (poll.status === "ERROR" || poll.status === "EXPIRED" || poll.status === "UNKNOWN") {
          throw new ApiClientError(toFriendlyOAuthMessage(poll.message));
        }
        await new Promise((resolve) => window.setTimeout(resolve, OAUTH_POLL_INTERVAL_MS));
      }

      if (!resolvedAccountId) {
        const latestAccounts = await loadAccounts();
        const primaryCandidate =
          latestAccounts.find(
            (account) => account.provider === "GMAIL" && account.role === "PRIMARY" && isConnected(account)
          ) ??
          latestAccounts.find((account) => account.provider === "GMAIL" && isConnected(account)) ??
          null;
        if (!primaryCandidate) {
          throw new ApiClientError(
            "Google sign-in finished, but MailPilot could not find the connected account. Please retry."
          );
        }
        resolvedAccountId = primaryCandidate.id;
        resolvedEmail = primaryCandidate.email;
      }

      await confirmPrimaryOnboardingAccount(resolvedAccountId);
      await loadAccounts();

      setPrimaryConnectedEmail(resolvedEmail);
      setPrimaryConnectState("CONNECTED");
    } catch (error) {
      setPrimaryConnectState("ERROR");
      setPrimaryConnectError(toFriendlyOAuthMessage(toErrorMessage(error)));
    } finally {
      setActivePrimaryOAuthState(null);
      setBusy(false);
    }
  };

  const connectSecondaryAccount = async () => {
    setBusy(true);
    setPageError(null);
    try {
      const beforeAccounts = await listAccounts();
      const beforeIds = new Set(beforeAccounts.map((account) => account.id));
      const selectedAccount = await runOauthConnectFlow(beforeIds, "ONBOARDING_SECONDARY");

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
      await loadViewProposals();
    } catch (error) {
      setPageError(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const updateProposal = useCallback(
    (proposalId: string, updater: (proposal: ProposalDraft) => ProposalDraft) => {
      setProposals((previous) =>
        previous.map((proposal) => (proposal.id === proposalId ? updater(proposal) : proposal))
      );
    },
    []
  );

  const runInitialSyncForProposals = async () => {
    setSyncingProposals(true);
    setPageError(null);
    try {
      await runAllAccountsSync(500);
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const status = await getSyncStatus();
        const running = status.some((item) => item.status === "RUNNING");
        if (!running) {
          break;
        }
      }
      await loadViewProposals();
    } catch (error) {
      setPageError(toErrorMessage(error));
    } finally {
      setSyncingProposals(false);
    }
  };

  const moveToProfileStep = async () => {
    await completeOnboardingViewProposalsStep();
    setStep(5);
  };

  const applySelectedProposalsAndContinue = async () => {
    setApplyingProposals(true);
    setPageError(null);
    try {
      const selectedProposals = proposals.filter((proposal) => proposal.enabled);
      if (selectedProposals.length > 0) {
        if (selectedProposals.some((proposal) => !proposal.name.trim())) {
          throw new ApiClientError("Each selected view must have a name.");
        }
        await applyOnboardingViewProposals({
          create: selectedProposals.map((proposal, index) => ({
            name: proposal.name.trim(),
            priority: proposal.priority,
            sortOrder: index * 10,
            accountsScope: {
              type: proposal.scopeType,
              accountIds: proposal.scopeType === "SELECTED" ? proposal.selectedAccountIds : [],
            },
            rules: {
              senderDomains: proposal.senderDomains,
              senderEmails: proposal.senderEmails,
              subjectKeywords: proposal.subjectKeywords,
              unreadOnly: proposal.unreadOnly,
            },
          })),
        });
      }

      await moveToProfileStep();
    } catch (error) {
      setPageError(toErrorMessage(error));
    } finally {
      setApplyingProposals(false);
    }
  };

  const skipProposalsAndContinue = async () => {
    setApplyingProposals(true);
    setPageError(null);
    try {
      await moveToProfileStep();
    } catch (error) {
      setPageError(toErrorMessage(error));
    } finally {
      setApplyingProposals(false);
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
      setStep(6);
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-muted/25 p-6">
      <Card className="w-full max-w-5xl border-border/80 bg-card/95 shadow-xl shadow-black/10 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="h-5 w-5 text-primary" />
            MailPilot Setup
          </CardTitle>
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
                Recommended Views
              </span>
              <span
                className={`rounded-full px-2 py-1 ${step >= 5 ? "bg-accent text-foreground" : "bg-muted text-muted-foreground"}`}
              >
                Profile + Password
              </span>
              <span
                className={`rounded-full px-2 py-1 ${step >= 6 ? "bg-accent text-foreground" : "bg-muted text-muted-foreground"}`}
              >
                Done
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {step === 1 && (
            <div className="grid gap-6 lg:grid-cols-[1.45fr_0.95fr]">
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Welcome to MailPilot</h2>
                <p className="text-sm text-muted-foreground">
                  Setup will connect your primary Gmail account, optionally add more accounts, save
                  your profile, and configure a local app password.
                </p>
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-sm text-muted-foreground">
                    Expect a 2-3 minute setup. You can resume onboarding if you close the app.
                  </p>
                </div>
                <Button disabled={busy} onClick={() => void startSetup()}>
                  {busy ? "Starting..." : "Start Setup"}
                </Button>
              </div>
              <Card className="border-border/80 bg-muted/15">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">What setup includes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <Mail className="mt-0.5 h-4 w-4 text-primary" />
                    <span>Connect your primary Gmail account for inbox sync.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                    <span>Create a local password for lock and login protection.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <UserRound className="mt-0.5 h-4 w-4 text-primary" />
                    <span>Add profile basics and get suggested starter views.</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-6 lg:grid-cols-[1.45fr_0.95fr]">
              <div className="space-y-4">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Mail className="h-4 w-4 text-primary" />
                  Connect Primary Gmail
                </h2>
                <p className="text-sm text-muted-foreground">
                  Connect the Gmail account that MailPilot should treat as your default workspace.
                </p>

                <Card className="border-border/80 bg-muted/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Primary account</CardTitle>
                    <CardDescription>
                      This account is used as your default mailbox context during onboarding.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {loadingAccounts ? (
                      <div className="text-muted-foreground">Checking connected accounts...</div>
                    ) : primaryConnectState === "CONNECTED" && (primaryConnectedEmail || connectedPrimary) ? (
                      <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="font-medium">
                          Connected: {primaryConnectedEmail ?? connectedPrimary?.email}
                        </span>
                      </div>
                    ) : (
                      <div className="rounded-md border border-border/70 bg-background/50 px-3 py-2 text-muted-foreground">
                        No primary Gmail connected yet.
                      </div>
                    )}

                    {primaryConnectState === "OPENING_BROWSER" && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                        Opening browser for Google sign-in...
                      </div>
                    )}
                    {primaryConnectState === "WAITING_FOR_CALLBACK" && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                        Browser opened. Waiting for Google sign-in to finish...
                      </div>
                    )}
                    {activePrimaryOAuthState &&
                      (primaryConnectState === "OPENING_BROWSER" ||
                        primaryConnectState === "WAITING_FOR_CALLBACK") && (
                        <p className="text-xs text-muted-foreground">
                          Session: <span className="font-mono">{activePrimaryOAuthState.slice(0, 12)}...</span>
                        </p>
                      )}
                    {primaryConnectState === "ERROR" && primaryConnectError && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {primaryConnectError}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      busy ||
                      primaryConnectState === "OPENING_BROWSER" ||
                      primaryConnectState === "WAITING_FOR_CALLBACK"
                    }
                    onClick={() => void connectPrimaryAccount()}
                  >
                    {primaryConnectState === "OPENING_BROWSER" || primaryConnectState === "WAITING_FOR_CALLBACK"
                      ? "Connecting..."
                      : primaryConnectState === "ERROR"
                        ? "Retry Gmail Connect"
                        : "Connect Gmail"}
                  </Button>
                  <Button disabled={busy} onClick={() => setStep(1)} variant="outline">
                    Back
                  </Button>
                  <Button
                    disabled={
                      !canContinuePrimaryStep ||
                      busy ||
                      primaryConnectState === "OPENING_BROWSER" ||
                      primaryConnectState === "WAITING_FOR_CALLBACK"
                    }
                    onClick={() => setStep(3)}
                    variant="secondary"
                  >
                    Continue
                  </Button>
                </div>
              </div>

              <Card className="border-border/80 bg-muted/15">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Why this matters</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                    <span>MailPilot uses secure Gmail OAuth with scoped access.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
                    <span>
                      This primary connection unlocks suggestions and focus workflows during setup.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                    <span>You can add and relabel more accounts in the next step.</span>
                  </div>
                </CardContent>
              </Card>
              {primaryConnectState === "ERROR" && (
                <div className="lg:col-span-2">
                  <Button
                    onClick={() => {
                      setPrimaryConnectState("IDLE");
                      setPrimaryConnectError(null);
                      setActivePrimaryOAuthState(null);
                    }}
                    variant="ghost"
                  >
                    Clear error
                  </Button>
                </div>
              )}
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
              <h2 className="text-lg font-semibold">Recommended Views</h2>
              <p className="text-sm text-muted-foreground">
                MailPilot analyzed recent sender patterns and prepared suggestions. Toggle the ones
                you want, tweak rules, then create your starter views.
              </p>
              {loadingProposals ? (
                <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  Generating recommended views...
                </div>
              ) : proposals.length === 0 ? (
                <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">
                    {proposalMessage ??
                      "Not enough mail history yet. Run initial sync and retry proposal generation."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={syncingProposals}
                      onClick={() => void runInitialSyncForProposals()}
                      variant="secondary"
                    >
                      {syncingProposals ? "Syncing..." : "Sync now (last 30 days)"}
                    </Button>
                    <Button
                      disabled={applyingProposals}
                      onClick={() => void skipProposalsAndContinue()}
                      variant="ghost"
                    >
                      Skip for now
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {proposals.map((proposal) => (
                      <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4" key={proposal.id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            checked={proposal.enabled}
                            className="h-4 w-4 accent-primary"
                            onChange={(event) =>
                              updateProposal(proposal.id, (previous) => ({
                                ...previous,
                                enabled: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                          <Input
                            className="h-9 max-w-[260px]"
                            onChange={(event) =>
                              updateProposal(proposal.id, (previous) => ({
                                ...previous,
                                name: event.target.value,
                              }))
                            }
                            value={proposal.name}
                          />
                          <Badge variant="secondary">~{proposal.estimatedCount} matches</Badge>
                          <Badge variant="outline">{proposal.estimatedPct.toFixed(1)}%</Badge>
                        </div>

                        <p className="text-xs text-muted-foreground">{proposal.explanation}</p>

                        <div className="flex flex-wrap gap-2 text-xs">
                          {proposal.senderDomains.slice(0, 6).map((domain) => (
                            <span className="rounded-full border border-border px-2 py-1" key={`${proposal.id}-domain-${domain}`}>
                              domain:{domain}
                            </span>
                          ))}
                          {proposal.senderEmails.slice(0, 4).map((email) => (
                            <span className="rounded-full border border-border px-2 py-1" key={`${proposal.id}-email-${email}`}>
                              from:{email}
                            </span>
                          ))}
                          {proposal.subjectKeywords.slice(0, 4).map((keyword) => (
                            <span className="rounded-full border border-border px-2 py-1" key={`${proposal.id}-kw-${keyword}`}>
                              kw:{keyword}
                            </span>
                          ))}
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-xs text-muted-foreground">Account scope</label>
                            <select
                              className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                              onChange={(event) =>
                                updateProposal(proposal.id, (previous) => ({
                                  ...previous,
                                  scopeType: event.target.value as "ALL" | "SELECTED",
                                  selectedAccountIds:
                                    event.target.value === "SELECTED"
                                      ? previous.selectedAccountIds
                                      : [],
                                }))
                              }
                              value={proposal.scopeType}
                            >
                              <option value="ALL">All accounts</option>
                              <option value="SELECTED">Selected accounts</option>
                            </select>
                            {proposal.scopeType === "SELECTED" && (
                              <div className="max-h-28 space-y-1 overflow-auto rounded-md border border-border p-2">
                                {accounts.map((account) => (
                                  <label className="flex items-center gap-2 text-xs" key={`${proposal.id}-acct-${account.id}`}>
                                    <input
                                      checked={proposal.selectedAccountIds.includes(account.id)}
                                      className="h-3.5 w-3.5 accent-primary"
                                      onChange={(event) =>
                                        updateProposal(proposal.id, (previous) => {
                                          const selectedIds = new Set(previous.selectedAccountIds);
                                          if (event.target.checked) {
                                            selectedIds.add(account.id);
                                          } else {
                                            selectedIds.delete(account.id);
                                          }
                                          return {
                                            ...previous,
                                            selectedAccountIds: Array.from(selectedIds),
                                          };
                                        })
                                      }
                                      type="checkbox"
                                    />
                                    <span>{account.email}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs text-muted-foreground">Priority</label>
                            <select
                              className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                              onChange={(event) =>
                                updateProposal(proposal.id, (previous) => ({
                                  ...previous,
                                  priority: Number(event.target.value),
                                }))
                              }
                              value={proposal.priority}
                            >
                              {[1, 2, 3, 4, 5].map((priorityValue) => (
                                <option key={`${proposal.id}-priority-${priorityValue}`} value={priorityValue}>
                                  Priority {priorityValue}
                                </option>
                              ))}
                            </select>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                checked={proposal.unreadOnly}
                                className="h-3.5 w-3.5 accent-primary"
                                onChange={(event) =>
                                  updateProposal(proposal.id, (previous) => ({
                                    ...previous,
                                    unreadOnly: event.target.checked,
                                  }))
                                }
                                type="checkbox"
                              />
                              Unread only
                            </label>
                          </div>
                        </div>

                        <details className="rounded-md border border-border bg-background/60 p-3">
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                            Edit rules
                          </summary>
                          <div className="mt-3 grid gap-2">
                            <Input
                              className="h-9 text-xs"
                              onChange={(event) =>
                                updateProposal(proposal.id, (previous) => ({
                                  ...previous,
                                  senderDomains: parseDelimitedList(event.target.value, 20),
                                }))
                              }
                              placeholder="sender domains (comma separated)"
                              value={formatDelimitedList(proposal.senderDomains)}
                            />
                            <Input
                              className="h-9 text-xs"
                              onChange={(event) =>
                                updateProposal(proposal.id, (previous) => ({
                                  ...previous,
                                  senderEmails: parseDelimitedList(event.target.value, 20),
                                }))
                              }
                              placeholder="sender emails (comma separated)"
                              value={formatDelimitedList(proposal.senderEmails)}
                            />
                            <Input
                              className="h-9 text-xs"
                              onChange={(event) =>
                                updateProposal(proposal.id, (previous) => ({
                                  ...previous,
                                  subjectKeywords: parseDelimitedList(event.target.value, 10),
                                }))
                              }
                              placeholder="subject keywords (comma separated)"
                              value={formatDelimitedList(proposal.subjectKeywords)}
                            />
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={syncingProposals || applyingProposals}
                      onClick={() => void runInitialSyncForProposals()}
                      variant="outline"
                    >
                      {syncingProposals ? "Syncing..." : "Sync now (last 30 days)"}
                    </Button>
                    <Button
                      disabled={applyingProposals}
                      onClick={() => void applySelectedProposalsAndContinue()}
                      variant="secondary"
                    >
                      {applyingProposals ? "Creating..." : "Create selected views"}
                    </Button>
                    <Button
                      disabled={applyingProposals}
                      onClick={() => void skipProposalsAndContinue()}
                      variant="ghost"
                    >
                      Skip for now
                    </Button>
                    <Button
                      disabled={applyingProposals || syncingProposals}
                      onClick={() => setStep(3)}
                      variant="outline"
                    >
                      Back
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 5 && (
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
                <Button onClick={() => setStep(4)} variant="outline">
                  Back
                </Button>
                <Button disabled={submittingProfile} onClick={() => void completeSetup()}>
                  {submittingProfile ? "Finishing..." : "Finish setup"}
                </Button>
              </div>
              {profileError ? <p className="text-sm text-destructive">{profileError}</p> : null}
            </div>
          )}

          {step === 6 && (
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
