import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  BriefcaseBusiness,
  CheckCircle2,
  Gamepad2,
  GraduationCap,
  KeyRound,
  Mail,
  MailPlus,
  Newspaper,
  Plane,
  Rocket,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  UserRound,
  Users,
  Wallet,
  Wand2,
} from "lucide-react";
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
import { configCheck, startGmailOAuth } from "@/lib/api/oauth";
import { getSyncStatus, runAllAccountsSync } from "@/lib/api/sync";
import {
  GMAIL_OAUTH_POLL_INTERVAL_MS,
  GMAIL_OAUTH_POLL_TIMEOUT_MS,
  openGmailOAuthUrl,
  sleep,
  waitForGmailOAuthOutcome,
} from "@/lib/oauth/gmail-oauth-flow";
import { ApiClientError } from "@/api/client";
import { toApiErrorMessage } from "@/utils/api-error";
import { StatePanel } from "@/components/common/state-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccentCard } from "@/components/ui/AccentCard";
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
  category: string;
  enabled: boolean;
  name: string;
  confidenceScore: number;
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
  priority: number;
  explanation: string;
  estimatedCount: number;
  estimatedPct: number;
  topDomains: string[];
  topSenders: string[];
  sampleMessages: Array<{
    subject: string;
    senderEmail: string;
    receivedAt: string;
  }>;
  accountDistribution: Array<{
    accountId: string;
    email: string;
    count: number;
  }>;
  scopeType: "ALL" | "SELECTED";
  selectedAccountIds: string[];
  senderDomains: string[];
  senderEmails: string[];
  subjectKeywords: string[];
  unreadOnly: boolean;
};

const FIELD_OF_WORK_OPTIONS = [
  "Engineering",
  "Software Development",
  "IT / Systems",
  "Cybersecurity",
  "Data / Analytics",
  "Product Management",
  "Design / UX",
  "Marketing",
  "Sales",
  "Finance",
  "Accounting",
  "Human Resources",
  "Operations",
  "Education",
  "Research",
  "Healthcare",
  "Legal",
  "E-commerce",
  "Media / Content",
  "Gaming",
  "Student",
  "Other",
] as const;

const ROLE_SAVE_DEBOUNCE_MS = 300;
const SAVE_HINT_LIFETIME_MS = 1800;
const SYNC_PROGRESS_MESSAGES = [
  "Scanning recent senders...",
  "Grouping patterns by domain and sender...",
  "Detecting recurring clusters...",
  "Scoring likely workspace categories...",
  "Preparing your starter views...",
] as const;

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

function normalizeRoleDraft(account: AccountRecord): RoleDraft {
  return {
    role: account.role,
    customLabel: account.customLabel ?? "",
  };
}

function toProposalDraft(proposal: OnboardingViewProposal): ProposalDraft {
  return {
    id: proposal.key,
    category: proposal.category,
    enabled: true,
    name: proposal.name,
    confidenceScore: proposal.confidenceScore,
    confidenceLevel: proposal.confidenceLevel,
    priority: proposal.priority,
    explanation: proposal.explanation,
    estimatedCount: proposal.estimatedCount,
    estimatedPct: proposal.estimatedPct,
    topDomains: proposal.topDomains ?? [],
    topSenders: proposal.topSenders ?? [],
    sampleMessages: proposal.sampleMessages ?? [],
    accountDistribution: proposal.accountDistribution ?? [],
    scopeType: proposal.accountsScope.type,
    selectedAccountIds: proposal.accountsScope.accountIds ?? [],
    senderDomains: proposal.rules.senderDomains ?? [],
    senderEmails: proposal.rules.senderEmails ?? [],
    subjectKeywords: proposal.rules.subjectKeywords ?? [],
    unreadOnly: proposal.rules.unreadOnly ?? false,
  };
}

function roleAccent(role: AccountRole): string {
  if (role === "PRIMARY") {
    return "from-yellow-500/20 to-sky-500/10 border-yellow-500/30";
  }
  if (role === "CUSTOM") {
    return "from-violet-500/20 to-violet-500/10 border-violet-500/30";
  }
  return "from-teal-500/15 to-slate-500/10 border-teal-500/25";
}

function proposalTone(
  category: string,
  id: string,
  name: string
): {
  badge: string;
  border: string;
  line: string;
} {
  const normalized = `${category} ${id} ${name}`.toLowerCase();
  if (normalized.includes("social")) {
    return {
      badge: "bg-sky-500/15 text-sky-200 border-sky-500/30",
      border: "border-sky-500/25",
      line: "bg-sky-500/70",
    };
  }
  if (normalized.includes("gaming")) {
    return {
      badge: "bg-violet-500/15 text-violet-200 border-violet-500/30",
      border: "border-violet-500/25",
      line: "bg-violet-500/70",
    };
  }
  if (normalized.includes("work")) {
    return {
      badge: "bg-teal-500/15 text-teal-200 border-teal-500/30",
      border: "border-teal-500/25",
      line: "bg-teal-500/70",
    };
  }
  if (normalized.includes("receipt") || normalized.includes("finance")) {
    return {
      badge: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
      border: "border-emerald-500/25",
      line: "bg-emerald-500/70",
    };
  }
  if (normalized.includes("school")) {
    return {
      badge: "bg-indigo-500/15 text-indigo-200 border-indigo-500/30",
      border: "border-indigo-500/25",
      line: "bg-indigo-500/70",
    };
  }
  if (normalized.includes("subscription") || normalized.includes("marketing")) {
    return {
      badge: "bg-amber-500/15 text-amber-200 border-amber-500/30",
      border: "border-amber-500/25",
      line: "bg-amber-500/70",
    };
  }
  if (normalized.includes("security")) {
    return {
      badge: "bg-red-500/15 text-red-200 border-red-500/30",
      border: "border-red-500/25",
      line: "bg-red-500/70",
    };
  }
  if (normalized.includes("shopping")) {
    return {
      badge: "bg-lime-500/15 text-lime-200 border-lime-500/30",
      border: "border-lime-500/25",
      line: "bg-lime-500/70",
    };
  }
  if (normalized.includes("travel")) {
    return {
      badge: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30",
      border: "border-cyan-500/25",
      line: "bg-cyan-500/70",
    };
  }
  return {
    badge: "bg-slate-500/15 text-slate-200 border-slate-500/30",
    border: "border-border",
    line: "bg-muted-foreground/70",
  };
}

function proposalIcon(category: string, id: string, name: string) {
  const normalized = `${category} ${id} ${name}`.toLowerCase();
  if (normalized.includes("social")) {
    return Users;
  }
  if (normalized.includes("gaming")) {
    return Gamepad2;
  }
  if (normalized.includes("work")) {
    return BriefcaseBusiness;
  }
  if (normalized.includes("receipt") || normalized.includes("finance")) {
    return Wallet;
  }
  if (normalized.includes("school")) {
    return GraduationCap;
  }
  if (normalized.includes("subscription") || normalized.includes("marketing")) {
    return MailPlus;
  }
  if (normalized.includes("shopping")) {
    return ShoppingBag;
  }
  if (normalized.includes("security")) {
    return ShieldAlert;
  }
  if (normalized.includes("travel")) {
    return Plane;
  }
  if (normalized.includes("newsletter")) {
    return Newspaper;
  }
  return Wand2;
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
  const [moreSuggestions, setMoreSuggestions] = useState<ProposalDraft[]>([]);
  const [analysisStats, setAnalysisStats] = useState<{
    analyzedMessages: number;
    totalCandidates: number;
    returnedProposals: number;
    suppressedCandidates: number;
  }>({
    analyzedMessages: 0,
    totalCandidates: 0,
    returnedProposals: 0,
    suppressedCandidates: 0,
  });
  const [proposalsLoadedAtLeastOnce, setProposalsLoadedAtLeastOnce] = useState(false);
  const [connectStage, setConnectStage] = useState<
    "IDLE" | "OPENING_BROWSER" | "WAITING_FOR_CALLBACK" | "CONNECTED" | "ERROR"
  >("IDLE");
  const [syncMessageIndex, setSyncMessageIndex] = useState(0);
  const [createdViewsCount, setCreatedViewsCount] = useState(0);
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
      const response = await fetchOnboardingViewProposals("30d", 50, 1500);
      setProposals(response.proposals.map(toProposalDraft));
      setMoreSuggestions((response.moreSuggestions ?? []).map(toProposalDraft));
      setAnalysisStats({
        analyzedMessages: response.analyzedMessages ?? 0,
        totalCandidates: response.summary?.totalCandidates ?? response.proposals.length,
        returnedProposals: response.summary?.returnedProposals ?? response.proposals.length,
        suppressedCandidates: response.summary?.suppressedCandidates ?? 0,
      });
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
    if (!(loadingProposals || syncingProposals)) {
      setSyncMessageIndex(0);
      return;
    }
    const intervalId = window.setInterval(() => {
      setSyncMessageIndex((current) => (current + 1) % SYNC_PROGRESS_MESSAGES.length);
    }, 1600);
    return () => window.clearInterval(intervalId);
  }, [loadingProposals, syncingProposals]);

  useEffect(() => {
    const nextDrafts: Record<string, RoleDraft> = {};
    for (const account of accounts) {
      nextDrafts[account.id] = normalizeRoleDraft(account);
    }
    setRoleDraftByAccountId(nextDrafts);
  }, [accounts]);

  useEffect(() => {
    const roleSaveTimeouts = saveTimeoutsRef.current;
    const roleSavedHintTimeouts = savedHintTimeoutsRef.current;
    return () => {
      for (const timeoutId of roleSaveTimeouts.values()) {
        window.clearTimeout(timeoutId);
      }
      roleSaveTimeouts.clear();
      for (const timeoutId of roleSavedHintTimeouts.values()) {
        window.clearTimeout(timeoutId);
      }
      roleSavedHintTimeouts.clear();
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

  useEffect(() => {
    if (connectedPrimary) {
      setConnectStage("CONNECTED");
      return;
    }
    if (step !== 2) {
      setConnectStage("IDLE");
    }
  }, [connectedPrimary, step]);

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
          [accountId]: toApiErrorMessage(error),
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
      setPageError(toApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const runOauthConnectFlow = useCallback(
    async (beforeIds: Set<string>, context: string, onBrowserOpened?: () => void) => {
      const config = await configCheck();
      if (!config.configured) {
        throw new ApiClientError(config.message || "Google OAuth configuration is missing.");
      }

      const oauth = await startGmailOAuth({
        mode: "SEND",
        context,
        returnTo: "/onboarding",
      });

      await openGmailOAuthUrl(oauth.authUrl, {
        fallbackToWindowOpen: false,
        errorMessage: "Unable to open the browser for Google OAuth.",
      });
      onBrowserOpened?.();

      await waitForGmailOAuthOutcome(oauth.state, {
        timeoutMs: GMAIL_OAUTH_POLL_TIMEOUT_MS,
        pollIntervalMs: GMAIL_OAUTH_POLL_INTERVAL_MS,
        timeoutMessage: "Gmail connection timed out. Complete browser consent and try again.",
      });

      let selectedAccount: AccountRecord | null = null;
      const waitStart = Date.now();
      while (Date.now() - waitStart < GMAIL_OAUTH_POLL_TIMEOUT_MS) {
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

        await sleep(GMAIL_OAUTH_POLL_INTERVAL_MS);
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
    setConnectStage("OPENING_BROWSER");
    try {
      const beforeAccounts = await listAccounts();
      const beforeIds = new Set(beforeAccounts.map((account) => account.id));
      const selectedAccount = await runOauthConnectFlow(beforeIds, "ONBOARDING_PRIMARY", () =>
        setConnectStage("WAITING_FOR_CALLBACK")
      );

      await confirmPrimaryOnboardingAccount(selectedAccount.id);
      await loadAccounts();
      setConnectStage("CONNECTED");
      setStep(3);
    } catch (error) {
      setConnectStage("ERROR");
      setPageError(toApiErrorMessage(error));
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
      const selectedAccount = await runOauthConnectFlow(beforeIds, "ONBOARDING_SECONDARY");

      if (selectedAccount.role !== "PRIMARY") {
        await updateAccountLabel(selectedAccount.id, {
          role: "SECONDARY",
          customLabel: null,
        });
      }
      await loadAccounts();
    } catch (error) {
      setPageError(toApiErrorMessage(error));
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
      setPageError(toApiErrorMessage(error));
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
      setPageError(toApiErrorMessage(error));
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
        const response = await applyOnboardingViewProposals({
          create: selectedProposals.map((proposal, index) => ({
            name: proposal.name.trim(),
            category: proposal.category,
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
        setCreatedViewsCount(response.created.length);
      } else {
        setCreatedViewsCount(0);
      }

      await moveToProfileStep();
    } catch (error) {
      setPageError(toApiErrorMessage(error));
    } finally {
      setApplyingProposals(false);
    }
  };

  const skipProposalsAndContinue = async () => {
    setApplyingProposals(true);
    setPageError(null);
    try {
      setCreatedViewsCount(0);
      await moveToProfileStep();
    } catch (error) {
      setPageError(toApiErrorMessage(error));
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
      setProfileError(toApiErrorMessage(error));
    } finally {
      setSubmittingProfile(false);
    }
  };

  const enterInbox = async () => {
    await onEnterInbox();
    navigate("/inbox", { replace: true });
  };

  const connectedAccounts = useMemo(
    () => accounts.filter((account) => isConnected(account)),
    [accounts]
  );
  const additionalAccountsCount = Math.max(
    connectedAccounts.length - (connectedPrimary ? 1 : 0),
    0
  );
  const syncProgressMessage = SYNC_PROGRESS_MESSAGES[syncMessageIndex];
  const friendlyConnectError =
    pageError && pageError.toLowerCase().includes("no oauth flow found")
      ? "The Google sign-in session expired or became invalid. Please try connecting again."
      : pageError;
  const stepDefinitions = [
    { id: 1 as WizardStep, label: "Welcome", icon: Rocket },
    { id: 2 as WizardStep, label: "Primary Gmail", icon: Mail },
    { id: 3 as WizardStep, label: "Accounts", icon: MailPlus },
    { id: 4 as WizardStep, label: "Recommended Views", icon: Wand2 },
    { id: 5 as WizardStep, label: "Profile + Password", icon: KeyRound },
    { id: 6 as WizardStep, label: "Done", icon: CheckCircle2 },
  ];

  return (
    <div className="relative min-h-screen bg-background px-4 py-8 md:px-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-28 left-20 h-72 w-72 rounded-full bg-sky-500/12 blur-3xl" />
        <div className="absolute -bottom-24 right-12 h-72 w-72 rounded-full bg-violet-500/12 blur-3xl" />
      </div>
      <Card className="relative mx-auto w-full max-w-6xl border-border/70 bg-card/95 shadow-2xl backdrop-blur">
        <CardHeader className="space-y-5 border-b border-border/60 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-2xl">MailPilot Setup</CardTitle>
              <CardDescription className="pt-1 text-sm text-muted-foreground">
                Complete setup once, then drive your inbox workflow from one cockpit.
              </CardDescription>
            </div>
            <Badge className="rounded-full px-3 py-1 text-xs" variant="secondary">
              Step {step} of {stepDefinitions.length}
            </Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-6">
            {stepDefinitions.map((stepDefinition) => {
              const Icon = stepDefinition.icon;
              const completed = stepDefinition.id < step;
              const active = stepDefinition.id === step;
              return (
                <div
                  className={`relative rounded-lg border px-3 py-2 text-xs transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : completed
                        ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                        : "border-border/70 bg-muted/25 text-muted-foreground"
                  }`}
                  key={stepDefinition.id}
                >
                  <div className="flex items-center gap-2">
                    {completed ? (
                      <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate font-medium">{stepDefinition.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          {step === 1 && (
            <div className="grid gap-4 lg:grid-cols-[1.4fr,1fr]">
              <AccentCard
                accent="blue"
                description="Securely connect Gmail, configure smart views, and protect access with a local app password."
                heading="Welcome to MailPilot"
              >
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    This setup takes a few minutes and prepares your workspace for focused inbox
                    execution.
                  </p>
                  <Button className="gap-2" disabled={busy} onClick={() => void startSetup()}>
                    <Rocket className="h-4 w-4" />
                    {busy ? "Starting..." : "Start setup"}
                  </Button>
                </div>
              </AccentCard>

              <div className="grid gap-3">
                <AccentCard accent="blue" heading="Connect Gmail securely">
                  <p className="text-sm text-muted-foreground">
                    OAuth is handled in your browser. MailPilot never stores your Gmail password.
                  </p>
                </AccentCard>
                <AccentCard accent="purple" heading="Organize views automatically">
                  <p className="text-sm text-muted-foreground">
                    We analyze sender patterns and suggest starter views you can edit before
                    creating.
                  </p>
                </AccentCard>
                <AccentCard accent="green" heading="Protect with local password">
                  <p className="text-sm text-muted-foreground">
                    Lock and unlock MailPilot locally without changing your Gmail credentials.
                  </p>
                </AccentCard>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 lg:grid-cols-[1.45fr,1fr]">
              <AccentCard
                accent="blue"
                description="This account becomes the default workspace identity."
                heading="Connect Primary Gmail"
              >
                <div className="space-y-4">
                  <div className="rounded-lg border border-border/70 bg-background/70 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Primary account
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-sky-400" />
                        <span className="text-sm font-medium">
                          {connectedPrimary?.email ?? "Not connected yet"}
                        </span>
                      </div>
                      <Badge variant={connectedPrimary ? "secondary" : "outline"}>
                        {connectedPrimary ? "Connected" : "Pending"}
                      </Badge>
                    </div>
                  </div>

                  {(connectStage === "OPENING_BROWSER" ||
                    connectStage === "WAITING_FOR_CALLBACK" ||
                    busy) && (
                    <StatePanel
                      compact
                      description="Securing your connection and waiting for callback confirmation."
                      title={
                        connectStage === "OPENING_BROWSER"
                          ? "Opening browser for Google sign-in"
                          : "Waiting for Google sign-in to finish"
                      }
                      variant="loading"
                    />
                  )}

                  {connectStage === "ERROR" && friendlyConnectError && (
                    <StatePanel
                      compact
                      description="Retry to start a fresh Google sign-in session."
                      title={friendlyConnectError}
                      variant="error"
                    />
                  )}

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
              </AccentCard>

              <AccentCard accent="blue" heading="Why this matters">
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Your primary account anchors default inbox behavior during onboarding and first
                    run.
                  </p>
                  <p>You can add more accounts next and adjust roles later in Settings.</p>
                  <p className="text-xs text-muted-foreground/85">
                    If Google sign-in expires, retry and complete consent in the same browser flow.
                  </p>
                </div>
              </AccentCard>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-4 lg:grid-cols-[1.8fr,1fr]">
              <div className="space-y-3">
                <AccentCard
                  accent="green"
                  description="Add additional Gmail accounts now or continue and configure later."
                  heading="Add More Accounts"
                >
                  <div className="space-y-3">
                    {loadingAccounts ? (
                      <div className="rounded-lg border border-border/60 bg-muted/25 p-4 text-sm text-muted-foreground">
                        Loading connected accounts...
                      </div>
                    ) : accounts.length === 0 ? (
                      <div className="rounded-lg border border-border/60 bg-muted/25 p-4 text-sm text-muted-foreground">
                        No accounts connected yet.
                      </div>
                    ) : (
                      accounts.map((account) => {
                        const roleDraft =
                          roleDraftByAccountId[account.id] ?? normalizeRoleDraft(account);
                        const roleSaving = roleSavingByAccountId[account.id] ?? false;
                        const roleError = roleErrorByAccountId[account.id] ?? null;
                        const savedHint = roleSavedHintByAccountId[account.id] ?? false;

                        return (
                          <div
                            className={`rounded-lg border bg-gradient-to-r p-4 ${roleAccent(roleDraft.role)}`}
                            key={account.id}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Mail className="h-4 w-4 text-sky-400" />
                                  <span className="text-sm font-medium">{account.email}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <Badge variant="outline">{account.provider}</Badge>
                                  <Badge variant={isConnected(account) ? "secondary" : "outline"}>
                                    {account.status}
                                  </Badge>
                                  <Badge variant="outline">{roleDraft.role}</Badge>
                                </div>
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
                                    className="h-9 w-[170px] text-xs"
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
                              </div>
                            </div>
                            <div className="pt-2 text-xs text-muted-foreground">
                              {roleSaving ? "Saving role..." : savedHint ? "Saved" : " "}
                            </div>
                            {roleError ? (
                              <p className="pt-1 text-xs text-destructive">{roleError}</p>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </AccentCard>

                <div className="flex flex-wrap gap-2">
                  <Button
                    className="gap-2"
                    disabled={busy}
                    onClick={() => void connectSecondaryAccount()}
                  >
                    <MailPlus className="h-4 w-4" />
                    {busy ? "Connecting..." : "Connect another Gmail"}
                  </Button>
                  <Button disabled={busy} onClick={() => setStep(2)} variant="outline">
                    Back
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => void continueFromAccountsStep()}
                    variant="secondary"
                  >
                    Continue
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => void continueFromAccountsStep()}
                    variant="ghost"
                  >
                    Skip
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <AccentCard accent="green" heading="Role guidance">
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>Primary account drives default workspace behavior.</li>
                    <li>Secondary accounts are still fully synced and searchable.</li>
                    <li>Custom labels help organize account context quickly.</li>
                  </ul>
                </AccentCard>
                <AccentCard accent="gold" heading="Connected now">
                  <p className="text-2xl font-semibold">{connectedAccounts.length}</p>
                  <p className="text-sm text-muted-foreground">
                    accounts connected so far ({additionalAccountsCount} additional)
                  </p>
                </AccentCard>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <AccentCard
                accent="purple"
                description="MailPilot analyzes sender patterns and proposes starter mailbox views."
                heading="Recommended Views"
              >
                <div className="space-y-3">
                  {(loadingProposals || syncingProposals) && (
                    <StatePanel
                      compact
                      description="This can take a moment while sync and proposal analysis finish."
                      title={syncProgressMessage}
                      variant="loading"
                    />
                  )}

                  {!loadingProposals && proposals.length === 0 && (
                    <StatePanel
                      compact
                      description="Run initial sync again after more mail history lands if you want stronger starter recommendations."
                      title={
                        proposalMessage ?? "Not enough mail history yet to recommend starter views."
                      }
                      variant="empty"
                    />
                  )}
                </div>
              </AccentCard>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-border/70 bg-card/70 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Analyzed
                  </p>
                  <p className="pt-1 text-xl font-semibold">{analysisStats.analyzedMessages}</p>
                  <p className="text-xs text-muted-foreground">messages in the last 30 days</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-card/70 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Candidates
                  </p>
                  <p className="pt-1 text-xl font-semibold">{analysisStats.totalCandidates}</p>
                  <p className="text-xs text-muted-foreground">raw suggestion clusters</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-card/70 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Recommended
                  </p>
                  <p className="pt-1 text-xl font-semibold">{analysisStats.returnedProposals}</p>
                  <p className="text-xs text-muted-foreground">high confidence proposals</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-card/70 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Suppressed
                  </p>
                  <p className="pt-1 text-xl font-semibold">{analysisStats.suppressedCandidates}</p>
                  <p className="text-xs text-muted-foreground">overlapping or low-signal</p>
                </div>
              </div>

              {!loadingProposals && proposals.length > 0 && (
                <div className="space-y-3">
                  {proposals.map((proposal) => {
                    const tone = proposalTone(proposal.category, proposal.id, proposal.name);
                    const ProposalIcon = proposalIcon(
                      proposal.category,
                      proposal.id,
                      proposal.name
                    );
                    return (
                      <div
                        className={`relative overflow-hidden rounded-xl border bg-card/70 p-4 ${tone.border}`}
                        key={proposal.id}
                      >
                        <div className={`absolute inset-x-0 top-0 h-[2px] ${tone.line}`} />
                        <div className="space-y-3">
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
                            <ProposalIcon className="h-4 w-4 text-muted-foreground" />
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
                            <Badge variant="outline">{proposal.category}</Badge>
                            <Badge className={tone.badge} variant="outline">
                              {proposal.confidenceLevel} {proposal.confidenceScore}
                            </Badge>
                            <Badge className={tone.badge} variant="outline">
                              ~{proposal.estimatedCount} matches
                            </Badge>
                            <Badge variant="outline">{proposal.estimatedPct.toFixed(1)}%</Badge>
                          </div>

                          <p className="text-xs text-muted-foreground">{proposal.explanation}</p>

                          <div className="flex flex-wrap gap-2 text-xs">
                            {proposal.topDomains.slice(0, 3).map((domain) => (
                              <span
                                className="rounded-full border border-border/70 bg-background/70 px-2 py-1"
                                key={`${proposal.id}-domain-${domain}`}
                              >
                                domain {domain}
                              </span>
                            ))}
                            {proposal.topSenders.slice(0, 3).map((email) => (
                              <span
                                className="rounded-full border border-border/70 bg-background/70 px-2 py-1"
                                key={`${proposal.id}-email-${email}`}
                              >
                                sender {email}
                              </span>
                            ))}
                            {proposal.subjectKeywords.slice(0, 4).map((keyword) => (
                              <span
                                className="rounded-full border border-border/70 bg-background/70 px-2 py-1"
                                key={`${proposal.id}-kw-${keyword}`}
                              >
                                keyword {keyword}
                              </span>
                            ))}
                          </div>

                          <details className="rounded-md border border-border bg-background/70 p-3">
                            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                              Show examples
                            </summary>
                            <div className="mt-3 grid gap-2">
                              {proposal.sampleMessages.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                  No sample messages available.
                                </p>
                              )}
                              {proposal.sampleMessages.map((sample) => (
                                <div
                                  className="rounded-md border border-border/60 bg-card/70 px-2 py-2 text-xs"
                                  key={`${proposal.id}-${sample.senderEmail}-${sample.receivedAt}`}
                                >
                                  <p className="font-medium">{sample.subject}</p>
                                  <p className="text-muted-foreground">{sample.senderEmail}</p>
                                </div>
                              ))}
                            </div>
                          </details>

                          <div className="rounded-md border border-border bg-background/60 p-2">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                              Account distribution
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {proposal.accountDistribution.length === 0 && (
                                <span className="text-xs text-muted-foreground">
                                  No account distribution available.
                                </span>
                              )}
                              {proposal.accountDistribution.map((item) => (
                                <Badge key={`${proposal.id}-${item.accountId}`} variant="outline">
                                  {item.email}: {item.count}
                                </Badge>
                              ))}
                            </div>
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
                                    <label
                                      className="flex items-center gap-2 text-xs"
                                      key={`${proposal.id}-acct-${account.id}`}
                                    >
                                      <input
                                        checked={proposal.selectedAccountIds.includes(account.id)}
                                        className="h-3.5 w-3.5 accent-primary"
                                        onChange={(event) =>
                                          updateProposal(proposal.id, (previous) => {
                                            const selectedIds = new Set(
                                              previous.selectedAccountIds
                                            );
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
                                  <option
                                    key={`${proposal.id}-priority-${priorityValue}`}
                                    value={priorityValue}
                                  >
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

                          <details className="rounded-md border border-border bg-background/70 p-3">
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
                      </div>
                    );
                  })}
                </div>
              )}

              {!loadingProposals && moreSuggestions.length > 0 && (
                <details className="rounded-lg border border-border/70 bg-card/60 p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    More suggestions ({moreSuggestions.length})
                  </summary>
                  <div className="mt-3 space-y-2">
                    {moreSuggestions.map((proposal) => {
                      const tone = proposalTone(proposal.category, proposal.id, proposal.name);
                      const ProposalIcon = proposalIcon(
                        proposal.category,
                        proposal.id,
                        proposal.name
                      );
                      return (
                        <div
                          className={`rounded-lg border bg-background/70 p-3 ${tone.border}`}
                          key={`more-${proposal.id}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <ProposalIcon className="h-4 w-4 text-muted-foreground" />
                            <p className="text-sm font-medium">{proposal.name}</p>
                            <Badge variant="outline">{proposal.category}</Badge>
                            <Badge className={tone.badge} variant="outline">
                              {proposal.confidenceLevel} {proposal.confidenceScore}
                            </Badge>
                            <Badge variant="outline">
                              {proposal.estimatedCount} / {proposal.estimatedPct.toFixed(1)}%
                            </Badge>
                          </div>
                          <p className="pt-1 text-xs text-muted-foreground">
                            {proposal.explanation}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={syncingProposals || applyingProposals}
                  onClick={() => void runInitialSyncForProposals()}
                  variant="outline"
                >
                  {syncingProposals ? "Syncing..." : "Re-run analysis (sync + scan)"}
                </Button>
                <Button
                  disabled={applyingProposals || proposals.length === 0}
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
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <AccentCard
                accent="green"
                description="This profile and password are local to this desktop app."
                heading="Local Profile & Security"
              >
                <div className="grid gap-4 lg:grid-cols-[1.3fr,1fr]">
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border/70 bg-background/70 p-3">
                      <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                        <UserRound className="h-3.5 w-3.5" />
                        Personal info
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
                    </div>

                    <div className="rounded-lg border border-border/70 bg-background/70 p-3">
                      <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                        <GraduationCap className="h-3.5 w-3.5" />
                        Work profile
                      </p>
                      <div className="space-y-2">
                        <select
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          disabled={submittingProfile}
                          onChange={(event) =>
                            setForm((previous) => ({
                              ...previous,
                              fieldChoice: event.target.value,
                            }))
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
                              setForm((previous) => ({
                                ...previous,
                                fieldOther: event.target.value,
                              }))
                            }
                            placeholder="Custom industry"
                            value={form.fieldOther}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-lg border border-border/70 bg-background/70 p-3">
                      <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                        <KeyRound className="h-3.5 w-3.5" />
                        Security
                      </p>
                      <div className="grid gap-3">
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
                            setForm((previous) => ({
                              ...previous,
                              confirmPassword: event.target.value,
                            }))
                          }
                          placeholder="Confirm password"
                          type="password"
                          value={form.confirmPassword}
                        />
                      </div>
                      <p className="pt-2 text-xs text-muted-foreground">
                        This password is local to MailPilot and is used for login and lock/unlock.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-3">
                  <Button onClick={() => setStep(4)} variant="outline">
                    Back
                  </Button>
                  <Button disabled={submittingProfile} onClick={() => void completeSetup()}>
                    {submittingProfile ? "Finishing..." : "Finish setup"}
                  </Button>
                </div>
                {profileError ? (
                  <p className="pt-2 text-sm text-destructive">{profileError}</p>
                ) : null}
              </AccentCard>
            </div>
          )}

          {step === 6 && (
            <div className="grid gap-4 lg:grid-cols-[1.4fr,1fr]">
              <AccentCard
                accent="green"
                description="MailPilot is ready for your inbox workflow."
                heading="Pheww, you did it."
              >
                <div className="space-y-4">
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      Setup complete
                    </p>
                    <p className="pt-1 text-sm text-muted-foreground">
                      Your accounts are connected, workspace prep is done, and Inbox is ready.
                    </p>
                  </div>
                  <Button className="gap-2" onClick={() => void enterInbox()}>
                    <Sparkles className="h-4 w-4" />
                    Go to Inbox
                  </Button>
                </div>
              </AccentCard>

              <AccentCard accent="gold" heading="Setup summary">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Primary Gmail</span>
                    <span className="font-medium">{connectedPrimary?.email ?? "Not set"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Additional accounts</span>
                    <span className="font-medium">{additionalAccountsCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Starter views created</span>
                    <span className="font-medium">{createdViewsCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Local password</span>
                    <span className="font-medium">Set</span>
                  </div>
                </div>
              </AccentCard>
            </div>
          )}

          {pageError && !(step === 2 && connectStage === "ERROR") ? (
            <StatePanel
              compact
              description="Retry the current onboarding step after fixing the issue above."
              title={pageError}
              variant="error"
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
