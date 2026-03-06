import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { AppOutletContext } from "@/App";
import { cn } from "@/lib/utils";
import {
  detachAccount,
  listAccounts,
  updateAccountLabel,
  type AccountRecord,
  type AccountRole,
} from "@/lib/api/accounts";
import { ApiClientError, getApiHealth, resolveApiBase } from "@/api/client";
import { configCheck, getGmailOAuthStatus, startGmailOAuth } from "@/lib/api/oauth";
import { repairMessageMetadata, runAccountSync, runAllAccountsSync } from "@/lib/api/sync";
import { resetApp } from "@/lib/api/system";
import { useLiveEvents } from "@/lib/events/live-events-context";
import {
  createSenderRule,
  deleteSenderRule,
  listSenderRules,
  updateSenderRule,
  type SenderRuleMatchType,
  type SenderRuleRecord,
  type SenderRuleUpsertPayload,
} from "@/lib/api/sender-rules";
import { ACCENT_TOKENS, getAccentClasses, type AccentToken } from "@/features/mailbox/utils/accent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type RuleForm = {
  matchType: SenderRuleMatchType;
  matchValue: string;
  label: string;
  accent: AccentToken;
};

type RuleFormErrors = {
  matchValue?: string;
  label?: string;
};

type NoticeState = {
  id: number;
  message: string;
};

type AccountLabelDraft = {
  role: AccountRole;
  customLabel: string;
};

const EMPTY_RULE_FORM: RuleForm = {
  matchType: "EMAIL",
  matchValue: "",
  label: "BOSS",
  accent: "gold",
};

const WINDOWS_OAUTH_JSON_PATH =
  "C:\\Users\\taulanth\\AppData\\Local\\MailPilot\\google-oauth-client.json";
const OAUTH_POLL_INTERVAL_MS = 2000;
const OAUTH_POLL_TIMEOUT_MS = 45000;
const DEFAULT_SYNC_MAX_MESSAGES = 500;
const ACCOUNT_ROLE_SAVE_DEBOUNCE_MS = 400;

async function closeDesktopAppWindow() {
  try {
    await getCurrentWindow().close();
  } catch {
    window.close();
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
}

function validateRuleForm(form: RuleForm): RuleFormErrors {
  const errors: RuleFormErrors = {};
  const matchValue = form.matchValue.trim();
  const label = form.label.trim();

  if (!matchValue) {
    errors.matchValue = "Match value is required";
  } else if (form.matchType === "EMAIL" && !matchValue.includes("@")) {
    errors.matchValue = "Enter a valid email address";
  } else if (
    form.matchType === "DOMAIN" &&
    (matchValue.includes("@") || !matchValue.includes("."))
  ) {
    errors.matchValue = "Enter a valid domain (example: company.com)";
  }

  if (!label) {
    errors.label = "Label is required";
  }

  return errors;
}

function toRuleForm(rule: SenderRuleRecord): RuleForm {
  return {
    matchType: rule.matchType,
    matchValue: rule.matchValue,
    label: rule.label,
    accent: rule.accent,
  };
}

function toRulePayload(form: RuleForm): SenderRuleUpsertPayload {
  return {
    matchType: form.matchType,
    matchValue: form.matchValue.trim(),
    label: form.label.trim().toUpperCase(),
    accent: form.accent,
  };
}

function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) {
    return "Never";
  }

  const parsed = new Date(lastSyncAt);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return parsed.toLocaleString();
}

function sleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function timeoutConnectMessage() {
  return [
    "Gmail connection timed out. Retry and verify:",
    "1) Redirect URI is exactly http://127.0.0.1:8082/api/oauth/gmail/callback",
    "2) OAuth consent in Testing includes your Gmail as a Test user",
    "3) Token exchange completed in the browser callback tab",
  ].join("\n");
}

function timeoutReauthMessage() {
  return [
    "Gmail re-auth for sending timed out. Retry and verify:",
    "1) Consent screen allows your account (Test user when in Testing mode)",
    "2) Browser flow completed and callback page shows success",
    "3) OAuth requested SEND mode (gmail.send scope)",
  ].join("\n");
}

function syncStatusBadgeVariant(
  status: "RUNNING" | "IDLE" | "ERROR"
): "default" | "secondary" | "outline" {
  if (status === "RUNNING") {
    return "default";
  }
  if (status === "ERROR") {
    return "outline";
  }
  return "secondary";
}

function toAccountLabelDraft(account: AccountRecord): AccountLabelDraft {
  return {
    role: account.role,
    customLabel: account.customLabel ?? "",
  };
}

function applyRoleLabelToAccounts(
  accounts: AccountRecord[],
  accountId: string,
  role: AccountRole,
  customLabel: string | null
): AccountRecord[] {
  return accounts.map((account) => {
    if (account.id === accountId) {
      return {
        ...account,
        role,
        customLabel: role === "CUSTOM" ? customLabel : null,
      };
    }

    if (role === "PRIMARY" && account.role === "PRIMARY") {
      return {
        ...account,
        role: "SECONDARY",
        customLabel: null,
      };
    }

    return account;
  });
}

function roleBadgeLabel(account: AccountRecord): string {
  if (account.role === "PRIMARY") {
    return "Primary";
  }
  if (account.role === "SECONDARY") {
    return "Secondary";
  }
  return account.customLabel?.trim() || "Custom";
}

function withoutRecordKey<T extends Record<string, unknown>>(record: T, keyToRemove: string): T {
  const next = { ...record };
  delete next[keyToRemove];
  return next;
}

export function SettingsPage() {
  const { themeVariant, setThemeVariant } = useOutletContext<AppOutletContext>();
  const { refreshSyncStatus, sseConnected, syncByAccountId } = useLiveEvents();
  const showSenderHighlightsInSettings = false;
  const isDevMode = import.meta.env.DEV;
  const apiBase = useMemo(() => resolveApiBase(), []);

  const noticeTimeoutRef = useRef<number | null>(null);
  const labelSaveTimeoutsRef = useRef<Map<string, number>>(new Map());
  const hadRunningSyncRef = useRef(false);

  const [healthStatus, setHealthStatus] = useState<string>("Unknown");
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const [oauthConfigDialogOpen, setOauthConfigDialogOpen] = useState(false);
  const [oauthConfigPath, setOauthConfigPath] = useState<string>(WINDOWS_OAUTH_JSON_PATH);
  const [oauthConfigMessage, setOauthConfigMessage] = useState(
    "Google OAuth configuration is missing."
  );
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [isRepairingMetadata, setIsRepairingMetadata] = useState(false);
  const [labelDraftByAccountId, setLabelDraftByAccountId] = useState<
    Record<string, AccountLabelDraft>
  >({});
  const [labelSaveErrorByAccountId, setLabelSaveErrorByAccountId] = useState<
    Record<string, string>
  >({});
  const [savingLabelByAccountId, setSavingLabelByAccountId] = useState<Record<string, boolean>>({});
  const [detachDialogAccount, setDetachDialogAccount] = useState<AccountRecord | null>(null);
  const [detachConfirmInput, setDetachConfirmInput] = useState("");
  const [detachError, setDetachError] = useState<string | null>(null);
  const [detachingAccountId, setDetachingAccountId] = useState<string | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetAcknowledgeChecked, setResetAcknowledgeChecked] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [isResettingApp, setIsResettingApp] = useState(false);

  const [senderRules, setSenderRules] = useState<SenderRuleRecord[]>([]);
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [ruleActionMessage, setRuleActionMessage] = useState<string | null>(null);
  const [ruleActionError, setRuleActionError] = useState<string | null>(null);

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>(EMPTY_RULE_FORM);
  const [ruleFormErrors, setRuleFormErrors] = useState<RuleFormErrors>({});
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  const gmailAccounts = useMemo(
    () => accounts.filter((account) => account.provider === "GMAIL"),
    [accounts]
  );

  const showNotice = useCallback((message: string) => {
    if (!message) {
      return;
    }

    setNotice({ id: Date.now(), message });
    if (noticeTimeoutRef.current !== null) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
    }, 2400);
  }, []);

  const applyAccountSnapshot = useCallback((nextAccounts: AccountRecord[]) => {
    setAccounts(nextAccounts);
    setLabelDraftByAccountId(() =>
      Object.fromEntries(nextAccounts.map((account) => [account.id, toAccountLabelDraft(account)]))
    );
    setLabelSaveErrorByAccountId((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([accountId]) =>
          nextAccounts.some((account) => account.id === accountId)
        )
      )
    );
    setSavingLabelByAccountId((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([accountId]) =>
          nextAccounts.some((account) => account.id === accountId)
        )
      )
    );
  }, []);

  const loadAccounts = useCallback(async () => {
    setIsLoadingAccounts(true);
    setAccountsError(null);
    try {
      const response = await listAccounts();
      applyAccountSnapshot(response);
    } catch (error) {
      setAccountsError(toErrorMessage(error));
    } finally {
      setIsLoadingAccounts(false);
    }
  }, [applyAccountSnapshot]);

  const loadSenderRules = useCallback(async () => {
    setIsLoadingRules(true);
    setRulesError(null);
    try {
      const response = await listSenderRules();
      setSenderRules(response);
    } catch (error) {
      setRulesError(toErrorMessage(error));
    } finally {
      setIsLoadingRules(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
    void loadSenderRules();
    void refreshSyncStatus();

    return () => {
      if (noticeTimeoutRef.current !== null) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
      labelSaveTimeoutsRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      labelSaveTimeoutsRef.current.clear();
    };
  }, [loadAccounts, loadSenderRules, refreshSyncStatus]);

  useEffect(() => {
    const hasRunningSync = Object.values(syncByAccountId).some(
      (status) => status.state === "RUNNING"
    );

    if (hadRunningSyncRef.current && !hasRunningSync) {
      void loadAccounts();
    }

    hadRunningSyncRef.current = hasRunningSync;
  }, [loadAccounts, syncByAccountId]);

  const handleTestConnection = async () => {
    setIsCheckingHealth(true);
    try {
      const health = await getApiHealth();
      setHealthStatus(`${health.status.toUpperCase()} · ${health.time}`);
    } catch (error) {
      setHealthStatus(`Error · ${toErrorMessage(error)}`);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const pollForGmailConnection = useCallback(
    async (state: string, baselineByEmail: Map<string, string>) => {
      const pollStartedAt = Date.now();

      while (Date.now() - pollStartedAt <= OAUTH_POLL_TIMEOUT_MS) {
        await sleep(OAUTH_POLL_INTERVAL_MS);

        const [accountsResult, statusResult] = await Promise.allSettled([
          listAccounts(),
          getGmailOAuthStatus(state),
        ]);

        let latestAccounts: AccountRecord[] = accounts;
        if (accountsResult.status === "fulfilled") {
          latestAccounts = accountsResult.value;
          applyAccountSnapshot(latestAccounts);
          setAccountsError(null);
        } else {
          setAccountsError(toErrorMessage(accountsResult.reason));
        }

        if (statusResult.status === "fulfilled" && statusResult.value.status === "ERROR") {
          return statusResult.value.message;
        }

        const gmailConnected = latestAccounts.some((account) => {
          if (account.provider !== "GMAIL") {
            return false;
          }
          const baselineStatus = baselineByEmail.get(account.email.toLowerCase());
          return baselineStatus === undefined;
        });

        if (gmailConnected) {
          return null;
        }

        if (statusResult.status === "fulfilled" && statusResult.value.status === "SUCCESS") {
          return null;
        }
      }

      return timeoutConnectMessage();
    },
    [accounts, applyAccountSnapshot]
  );

  const pollForSendCapability = useCallback(
    async (state: string, accountId: string) => {
      const pollStartedAt = Date.now();

      while (Date.now() - pollStartedAt <= OAUTH_POLL_TIMEOUT_MS) {
        await sleep(OAUTH_POLL_INTERVAL_MS);

        const [accountsResult, statusResult] = await Promise.allSettled([
          listAccounts(),
          getGmailOAuthStatus(state),
        ]);

        let latestAccounts: AccountRecord[] = accounts;
        if (accountsResult.status === "fulfilled") {
          latestAccounts = accountsResult.value;
          applyAccountSnapshot(latestAccounts);
          setAccountsError(null);
        } else {
          setAccountsError(toErrorMessage(accountsResult.reason));
        }

        const account = latestAccounts.find((candidate) => candidate.id === accountId);
        if (account?.canSend) {
          return null;
        }

        if (statusResult.status === "fulfilled" && statusResult.value.status === "ERROR") {
          return statusResult.value.message;
        }
      }

      return timeoutReauthMessage();
    },
    [accounts, applyAccountSnapshot]
  );

  const handleConnectGmail = async () => {
    setOauthError(null);
    setIsConnectingGmail(true);

    const baselineByEmail = new Map(
      gmailAccounts.map((account) => [account.email.toLowerCase(), account.status])
    );

    try {
      const config = await configCheck();
      if (!config.configured) {
        setOauthConfigPath(config.path ?? WINDOWS_OAUTH_JSON_PATH);
        setOauthConfigMessage(config.message);
        setOauthConfigDialogOpen(true);
        return;
      }

      const startResponse = await startGmailOAuth({
        returnTo: "mailpilot://oauth-done",
        mode: "READONLY",
      });

      try {
        await openUrl(startResponse.authUrl);
      } catch (openError) {
        const popup = window.open(startResponse.authUrl, "_blank", "noopener,noreferrer");
        if (!popup) {
          throw new ApiClientError("Unable to open the system browser for Google OAuth.");
        }
      }

      const pollError = await pollForGmailConnection(startResponse.state, baselineByEmail);
      if (pollError) {
        setOauthError(pollError);
        return;
      }

      await loadAccounts();
      await refreshSyncStatus();
      showNotice("Gmail account connected");
    } catch (error) {
      setOauthError(toErrorMessage(error));
    } finally {
      setIsConnectingGmail(false);
    }
  };

  const handleReauthForSending = async (accountId: string) => {
    setOauthError(null);
    setIsConnectingGmail(true);

    try {
      const config = await configCheck();
      if (!config.configured) {
        setOauthConfigPath(config.path ?? WINDOWS_OAUTH_JSON_PATH);
        setOauthConfigMessage(config.message);
        setOauthConfigDialogOpen(true);
        return;
      }

      const startResponse = await startGmailOAuth({
        returnTo: "mailpilot://oauth-done",
        mode: "SEND",
      });

      try {
        await openUrl(startResponse.authUrl);
      } catch {
        const popup = window.open(startResponse.authUrl, "_blank", "noopener,noreferrer");
        if (!popup) {
          throw new ApiClientError("Unable to open the system browser for Google OAuth.");
        }
      }

      const pollError = await pollForSendCapability(startResponse.state, accountId);
      if (pollError) {
        setOauthError(pollError);
        return;
      }

      await loadAccounts();
      showNotice("Sending scope granted");
    } catch (error) {
      setOauthError(toErrorMessage(error));
    } finally {
      setIsConnectingGmail(false);
    }
  };

  const handleSyncAllAccounts = async () => {
    setSyncError(null);
    setIsSyncingAll(true);
    try {
      const response = await runAllAccountsSync(DEFAULT_SYNC_MAX_MESSAGES);
      showNotice(`Sync started for ${response.accountsQueued} account(s)`);
      await refreshSyncStatus();
    } catch (error) {
      setSyncError(toErrorMessage(error));
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleSyncAccount = async (accountId: string) => {
    setSyncError(null);
    setSyncingAccountId(accountId);
    try {
      await runAccountSync(accountId, DEFAULT_SYNC_MAX_MESSAGES);
      showNotice("Account sync started");
      await refreshSyncStatus();
    } catch (error) {
      setSyncError(toErrorMessage(error));
    } finally {
      setSyncingAccountId(null);
    }
  };

  const handleRepairMetadata = async () => {
    setSyncError(null);
    setIsRepairingMetadata(true);
    try {
      const response = await repairMessageMetadata(30);
      showNotice(`Repair finished: updated ${response.updated}, skipped ${response.skipped}`);
      await refreshSyncStatus();
      await loadAccounts();
    } catch (error) {
      setSyncError(toErrorMessage(error));
    } finally {
      setIsRepairingMetadata(false);
    }
  };

  const persistAccountLabel = useCallback(
    async (accountId: string, draft: AccountLabelDraft) => {
      const normalizedCustomLabel = draft.role === "CUSTOM" ? draft.customLabel.trim() : null;

      if (draft.role === "CUSTOM" && (normalizedCustomLabel ?? "").length === 0) {
        setLabelSaveErrorByAccountId((previous) => ({
          ...previous,
          [accountId]: "Custom label is required for CUSTOM role.",
        }));
        return;
      }

      if (draft.role === "CUSTOM" && (normalizedCustomLabel ?? "").length > 30) {
        setLabelSaveErrorByAccountId((previous) => ({
          ...previous,
          [accountId]: "Custom label must be at most 30 characters.",
        }));
        return;
      }

      setSavingLabelByAccountId((previous) => ({
        ...previous,
        [accountId]: true,
      }));

      try {
        await updateAccountLabel(accountId, {
          role: draft.role,
          customLabel: normalizedCustomLabel,
        });

        setAccounts((previous) =>
          applyRoleLabelToAccounts(previous, accountId, draft.role, normalizedCustomLabel)
        );
        setLabelDraftByAccountId((previous) => {
          const next: Record<string, AccountLabelDraft> = {
            ...previous,
            [accountId]: {
              role: draft.role,
              customLabel: normalizedCustomLabel ?? "",
            },
          };

          if (draft.role === "PRIMARY") {
            Object.entries(next).forEach(([candidateId, candidateDraft]) => {
              if (candidateId !== accountId && candidateDraft.role === "PRIMARY") {
                next[candidateId] = {
                  role: "SECONDARY",
                  customLabel: "",
                };
              }
            });
          }

          return next;
        });
        setLabelSaveErrorByAccountId((previous) => withoutRecordKey(previous, accountId));
      } catch (error) {
        setLabelSaveErrorByAccountId((previous) => ({
          ...previous,
          [accountId]: toErrorMessage(error),
        }));
      } finally {
        setSavingLabelByAccountId((previous) => withoutRecordKey(previous, accountId));
      }
    },
    [setAccounts]
  );

  const scheduleAccountLabelSave = useCallback(
    (accountId: string, draft: AccountLabelDraft) => {
      const existingTimeoutId = labelSaveTimeoutsRef.current.get(accountId);
      if (existingTimeoutId !== undefined) {
        window.clearTimeout(existingTimeoutId);
      }

      const timeoutId = window.setTimeout(() => {
        labelSaveTimeoutsRef.current.delete(accountId);
        void persistAccountLabel(accountId, draft);
      }, ACCOUNT_ROLE_SAVE_DEBOUNCE_MS);

      labelSaveTimeoutsRef.current.set(accountId, timeoutId);
    },
    [persistAccountLabel]
  );

  const handleAccountRoleChange = useCallback(
    (accountId: string, nextRole: AccountRole) => {
      const currentDraft = labelDraftByAccountId[accountId];
      const customLabel = nextRole === "CUSTOM" ? (currentDraft?.customLabel ?? "") : "";
      const nextDraft: AccountLabelDraft = {
        role: nextRole,
        customLabel,
      };

      setLabelDraftByAccountId((previous) => ({
        ...previous,
        [accountId]: nextDraft,
      }));
      setLabelSaveErrorByAccountId((previous) => withoutRecordKey(previous, accountId));
      scheduleAccountLabelSave(accountId, nextDraft);
    },
    [labelDraftByAccountId, scheduleAccountLabelSave]
  );

  const handleAccountCustomLabelChange = useCallback(
    (accountId: string, value: string) => {
      const nextDraft: AccountLabelDraft = {
        role: "CUSTOM",
        customLabel: value,
      };
      setLabelDraftByAccountId((previous) => ({
        ...previous,
        [accountId]: nextDraft,
      }));
      setLabelSaveErrorByAccountId((previous) => withoutRecordKey(previous, accountId));
      scheduleAccountLabelSave(accountId, nextDraft);
    },
    [scheduleAccountLabelSave]
  );

  const openDetachDialog = useCallback((account: AccountRecord) => {
    setDetachDialogAccount(account);
    setDetachConfirmInput("");
    setDetachError(null);
  }, []);

  const closeDetachDialog = useCallback((open: boolean) => {
    if (!open) {
      setDetachDialogAccount(null);
      setDetachConfirmInput("");
      setDetachError(null);
    }
  }, []);

  const handleDetachAccount = useCallback(async () => {
    if (!detachDialogAccount) {
      return;
    }

    if (detachConfirmInput !== detachDialogAccount.email) {
      setDetachError("Typed email does not match.");
      return;
    }

    setDetachingAccountId(detachDialogAccount.id);
    setDetachError(null);
    setAccountsError(null);

    try {
      await detachAccount(detachDialogAccount.id);
      showNotice("Account detached and data deleted");
      setDetachDialogAccount(null);
      setDetachConfirmInput("");
      await loadAccounts();
      await refreshSyncStatus();
    } catch (error) {
      setDetachError(toErrorMessage(error));
    } finally {
      setDetachingAccountId(null);
    }
  }, [detachConfirmInput, detachDialogAccount, loadAccounts, refreshSyncStatus, showNotice]);

  const openResetDialog = useCallback(() => {
    setResetDialogOpen(true);
    setResetPassword("");
    setResetConfirmText("");
    setResetAcknowledgeChecked(false);
    setResetError(null);
  }, []);

  const closeResetDialog = useCallback((open: boolean) => {
    if (!open && !isResettingApp) {
      setResetDialogOpen(false);
      setResetPassword("");
      setResetConfirmText("");
      setResetAcknowledgeChecked(false);
      setResetError(null);
    }
  }, [isResettingApp]);

  const handleResetApp = useCallback(async () => {
    setResetError(null);
    setIsResettingApp(true);
    try {
      await resetApp({
        password: resetPassword,
        confirmText: resetConfirmText,
      });
      showNotice("Reset complete. Closing app...");
      await closeDesktopAppWindow();
      setIsResettingApp(false);
      setResetDialogOpen(false);
    } catch (error) {
      setResetError(toErrorMessage(error));
      setIsResettingApp(false);
    }
  }, [resetConfirmText, resetPassword, showNotice]);

  const openCreateRuleDialog = () => {
    setEditingRuleId(null);
    setRuleForm(EMPTY_RULE_FORM);
    setRuleFormErrors({});
    setRuleActionError(null);
    setRuleDialogOpen(true);
  };

  const openEditRuleDialog = (rule: SenderRuleRecord) => {
    setEditingRuleId(rule.id);
    setRuleForm(toRuleForm(rule));
    setRuleFormErrors({});
    setRuleActionError(null);
    setRuleDialogOpen(true);
  };

  const handleSaveRule = async () => {
    const errors = validateRuleForm(ruleForm);
    setRuleFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSavingRule(true);
    setRuleActionError(null);
    setRuleActionMessage(null);
    try {
      const payload = toRulePayload(ruleForm);
      if (editingRuleId) {
        await updateSenderRule(editingRuleId, payload);
        setRuleActionMessage("Sender highlight rule updated");
      } else {
        await createSenderRule(payload);
        setRuleActionMessage("Sender highlight rule created");
      }
      setRuleDialogOpen(false);
      await loadSenderRules();
    } catch (error) {
      setRuleActionError(toErrorMessage(error));
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleDeleteRule = async (rule: SenderRuleRecord) => {
    const confirmed = window.confirm(`Delete highlight rule for ${rule.matchValue}?`);
    if (!confirmed) {
      return;
    }

    setDeletingRuleId(rule.id);
    setRuleActionError(null);
    setRuleActionMessage(null);
    try {
      await deleteSenderRule(rule.id);
      setRuleActionMessage("Sender highlight rule deleted");
      await loadSenderRules();
    } catch (error) {
      setRuleActionError(toErrorMessage(error));
    } finally {
      setDeletingRuleId(null);
    }
  };

  const detachEmailMatches =
    detachDialogAccount !== null && detachConfirmInput === detachDialogAccount.email;
  const canConfirmReset =
    resetPassword.trim().length > 0 &&
    resetConfirmText === "RESET" &&
    resetAcknowledgeChecked &&
    !isResettingApp;

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Application preferences and local development controls.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>
            Persisted locally and applied instantly across shell, onboarding, and login.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <button
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                themeVariant === "balanced"
                  ? "border-primary/40 bg-accent"
                  : "border-border bg-card hover:bg-muted"
              )}
              onClick={() => setThemeVariant("balanced")}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Balanced</p>
                {themeVariant === "balanced" ? <Badge variant="secondary">Active</Badge> : null}
              </div>
              <p className="pt-1 text-xs text-muted-foreground">
                Navy-balanced dark surfaces with cool contrast.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span className="h-4 w-4 rounded-full border border-white/15 bg-[#111a2a]" />
                <span className="h-4 w-4 rounded-full border border-white/15 bg-[#1b2740]" />
                <span className="h-4 w-4 rounded-full border border-white/15 bg-[#273451]" />
              </div>
            </button>

            <button
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                themeVariant === "pure-black"
                  ? "border-primary/40 bg-accent"
                  : "border-border bg-card hover:bg-muted"
              )}
              onClick={() => setThemeVariant("pure-black")}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Pure Black</p>
                {themeVariant === "pure-black" ? <Badge variant="secondary">Active</Badge> : null}
              </div>
              <p className="pt-1 text-xs text-muted-foreground">
                Premium black and charcoal surfaces with high-contrast text.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span className="h-4 w-4 rounded-full border border-white/15 bg-[#050505]" />
                <span className="h-4 w-4 rounded-full border border-white/15 bg-[#101010]" />
                <span className="h-4 w-4 rounded-full border border-white/15 bg-[#1b1b1b]" />
              </div>
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Accent priority colors remain unchanged across both themes.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Local App Password</CardTitle>
          <CardDescription>
            Password change UI is planned next. PT16 adds login, lock, and logout gating.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Use onboarding setup in the next milestone (MP-PT17) to manage local password flow.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System</CardTitle>
          <CardDescription>Connection checks for local development.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Backend endpoint: {apiBase}</p>
          <p>Sync scheduler: Manual</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={isCheckingHealth}
              onClick={handleTestConnection}
              size="sm"
              variant="outline"
            >
              {isCheckingHealth ? "Testing..." : "Test connection"}
            </Button>
            {isDevMode && (
              <Button
                disabled={isRepairingMetadata}
                onClick={() => void handleRepairMetadata()}
                size="sm"
                variant="outline"
              >
                {isRepairingMetadata ? "Repairing..." : "Repair last 30 days"}
              </Button>
            )}
            <Badge variant="secondary">{healthStatus}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Reset permanently deletes all local MailPilot data (accounts, messages, views,
            followups, drafts, and rules). This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={openResetDialog} variant="destructive">
            Reset MailPilot
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Connected Accounts</CardTitle>
              <CardDescription>
                Connect Gmail, then run sync to ingest real email metadata into MailPilot.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                disabled={isLoadingAccounts}
                onClick={() => void loadAccounts()}
                size="sm"
                variant="outline"
              >
                Refresh
              </Button>
              <Button
                disabled={isSyncingAll}
                onClick={() => void handleSyncAllAccounts()}
                size="sm"
                variant="outline"
              >
                {isSyncingAll ? "Starting sync..." : "Sync all accounts"}
              </Button>
              <Button
                disabled={isConnectingGmail}
                onClick={() => void handleConnectGmail()}
                size="sm"
              >
                {isConnectingGmail ? "Connecting..." : "Connect Gmail"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {oauthError && (
            <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
              <p className="whitespace-pre-line">{oauthError}</p>
              <Button
                className="mt-3"
                onClick={() => void handleConnectGmail()}
                size="sm"
                variant="outline"
              >
                Retry
              </Button>
            </div>
          )}

          {syncError && (
            <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
              <p>{syncError}</p>
              <Button
                className="mt-3"
                onClick={() => void refreshSyncStatus()}
                size="sm"
                variant="outline"
              >
                Retry
              </Button>
            </div>
          )}

          {isLoadingAccounts && (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  className="h-12 animate-pulse rounded-lg border border-border bg-muted"
                  key={index}
                />
              ))}
            </div>
          )}

          {!isLoadingAccounts && accountsError && (
            <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
              <p>{accountsError}</p>
              <Button
                className="mt-3"
                onClick={() => void loadAccounts()}
                size="sm"
                variant="outline"
              >
                Retry
              </Button>
            </div>
          )}

          {!isLoadingAccounts && !accountsError && accounts.length === 0 && (
            <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
              No connected accounts yet.
            </p>
          )}

          {!isLoadingAccounts && !accountsError && accounts.length > 0 && (
            <div className="space-y-2">
              {accounts.map((account) => {
                const syncStatus = syncByAccountId[account.id];
                const statusLabel = syncStatus?.state ?? "IDLE";
                const effectiveLastSyncAt = syncStatus?.lastSyncAt ?? account.lastSyncAt;
                const isRunning = statusLabel === "RUNNING";
                const labelDraft =
                  labelDraftByAccountId[account.id] ?? toAccountLabelDraft(account);
                const roleSaveError = labelSaveErrorByAccountId[account.id] ?? null;
                const isSavingLabel = savingLabelByAccountId[account.id] ?? false;
                const isDetaching = detachingAccountId === account.id;

                return (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                    key={account.id}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{account.provider}</Badge>
                        <p className="truncate text-sm font-medium">{account.email}</p>
                        <Badge variant={account.status === "CONNECTED" ? "secondary" : "outline"}>
                          {account.status}
                        </Badge>
                        <Badge variant={account.canSend ? "secondary" : "outline"}>
                          {account.canSend ? "Can send" : "Send disabled"}
                        </Badge>
                        <Badge variant={account.role === "PRIMARY" ? "secondary" : "outline"}>
                          {roleBadgeLabel(account)}
                        </Badge>
                        <Badge variant={syncStatusBadgeVariant(statusLabel)}>{statusLabel}</Badge>
                      </div>
                      <p className="pt-1 text-xs text-muted-foreground">
                        Last sync: {formatLastSync(effectiveLastSyncAt)}
                      </p>
                      {statusLabel === "RUNNING" && (
                        <p className="pt-1 text-xs text-muted-foreground">
                          Progress: {syncStatus?.processed ?? 0}
                          {syncStatus?.total !== null && syncStatus?.total !== undefined
                            ? `/${syncStatus.total}`
                            : ""}
                        </p>
                      )}
                      {syncStatus?.message && statusLabel === "ERROR" && (
                        <p className="pt-1 text-xs text-destructive">{syncStatus.message}</p>
                      )}
                    </div>
                    <div className="flex w-full min-w-[280px] flex-col items-stretch gap-2 sm:w-auto sm:min-w-0 sm:items-end">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <select
                          className="h-8 min-w-[132px] rounded-md border border-input bg-background px-2 text-xs"
                          disabled={isSavingLabel || isDetaching}
                          onChange={(event) =>
                            handleAccountRoleChange(account.id, event.target.value as AccountRole)
                          }
                          value={labelDraft.role}
                        >
                          <option value="PRIMARY">PRIMARY</option>
                          <option value="SECONDARY">SECONDARY</option>
                          <option value="CUSTOM">CUSTOM</option>
                        </select>
                        {labelDraft.role === "CUSTOM" && (
                          <Input
                            className="h-8 w-[180px] text-xs"
                            disabled={isSavingLabel || isDetaching}
                            maxLength={30}
                            onChange={(event) =>
                              handleAccountCustomLabelChange(account.id, event.target.value)
                            }
                            placeholder="Custom label"
                            value={labelDraft.customLabel}
                          />
                        )}
                        {isSavingLabel && (
                          <span className="text-xs text-muted-foreground">Saving...</span>
                        )}
                      </div>
                      {roleSaveError && (
                        <p className="text-xs text-destructive sm:text-right">{roleSaveError}</p>
                      )}
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {!account.canSend && account.provider === "GMAIL" && (
                          <Button
                            disabled={isConnectingGmail || isDetaching}
                            onClick={() => void handleReauthForSending(account.id)}
                            size="sm"
                            variant="outline"
                          >
                            {isConnectingGmail ? "Starting..." : "Re-auth for sending"}
                          </Button>
                        )}
                        <Button
                          disabled={isDetaching || isRunning || syncingAccountId === account.id}
                          onClick={() => void handleSyncAccount(account.id)}
                          size="sm"
                          variant="outline"
                        >
                          {syncingAccountId === account.id ? "Starting..." : "Sync"}
                        </Button>
                        <Button
                          disabled={isDetaching || isSavingLabel}
                          onClick={() => openDetachDialog(account)}
                          size="sm"
                          variant="destructive"
                        >
                          {isDetaching ? "Detaching..." : "Detach"}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Live updates:{" "}
            {sseConnected ? "connected (SSE)" : "reconnecting (fallback polling if needed)"}.
          </p>
        </CardContent>
      </Card>

      {showSenderHighlightsInSettings && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Sender Highlights</CardTitle>
                <CardDescription>
                  Define sender decoration rules. Exact EMAIL matches override DOMAIN rules.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => void loadSenderRules()} size="sm" variant="outline">
                  Refresh
                </Button>
                <Button onClick={openCreateRuleDialog} size="sm">
                  Add rule
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {ruleActionMessage && (
              <p className="rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
                {ruleActionMessage}
              </p>
            )}
            {ruleActionError && (
              <p className="rounded-md border border-border bg-card px-3 py-2 text-sm text-destructive">
                {ruleActionError}
              </p>
            )}

            {isLoadingRules && (
              <div className="space-y-2">
                {Array.from({ length: 4 }, (_, index) => (
                  <div
                    className="h-12 animate-pulse rounded-lg border border-border bg-muted"
                    key={index}
                  />
                ))}
              </div>
            )}

            {!isLoadingRules && rulesError && (
              <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
                <p>{rulesError}</p>
                <Button
                  className="mt-3"
                  onClick={() => void loadSenderRules()}
                  size="sm"
                  variant="outline"
                >
                  Retry
                </Button>
              </div>
            )}

            {!isLoadingRules && !rulesError && senderRules.length === 0 && (
              <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
                No sender highlight rules yet.
              </p>
            )}

            {!isLoadingRules && !rulesError && senderRules.length > 0 && (
              <div className="space-y-2">
                {senderRules.map((rule) => {
                  const accent = getAccentClasses(rule.accent);
                  return (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                      key={rule.id}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{rule.matchType}</Badge>
                          <p className="truncate text-sm font-medium">{rule.matchValue}</p>
                          <Badge className={cn("border uppercase", accent.badge)} variant="outline">
                            {rule.label}
                          </Badge>
                        </div>
                        <p className="pt-1 text-xs text-muted-foreground">
                          Accent token: {rule.accent}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => openEditRuleDialog(rule)}
                          size="sm"
                          variant="outline"
                        >
                          Edit
                        </Button>
                        <Button
                          disabled={deletingRuleId === rule.id}
                          onClick={() => void handleDeleteRule(rule)}
                          size="sm"
                          variant="outline"
                        >
                          {deletingRuleId === rule.id ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog onOpenChange={closeDetachDialog} open={detachDialogAccount !== null}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detach account?</DialogTitle>
            <DialogDescription>
              {detachDialogAccount
                ? `This permanently deletes all stored mail data for ${detachDialogAccount.email} from MailPilot.`
                : "This permanently deletes all stored mail data from MailPilot."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">Type the account email to confirm:</p>
            <Input
              autoComplete="off"
              autoFocus
              onChange={(event) => {
                setDetachConfirmInput(event.target.value);
                setDetachError(null);
              }}
              placeholder={detachDialogAccount?.email ?? "name@example.com"}
              value={detachConfirmInput}
            />
            {detachError && <p className="text-xs text-destructive">{detachError}</p>}
          </div>

          <DialogFooter>
            <Button onClick={() => closeDetachDialog(false)} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={!detachEmailMatches || detachingAccountId !== null}
              onClick={() => void handleDetachAccount()}
              type="button"
              variant="destructive"
            >
              {detachingAccountId !== null ? "Detaching..." : "Detach & delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={closeResetDialog} open={resetDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-destructive">Reset MailPilot?</DialogTitle>
            <DialogDescription>
              This permanently deletes all local MailPilot data and closes the app. On next
              launch, onboarding starts again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="space-y-2">
              <p className="text-muted-foreground">Enter local app password:</p>
              <Input
                autoComplete="current-password"
                disabled={isResettingApp}
                onChange={(event) => {
                  setResetPassword(event.target.value);
                  setResetError(null);
                }}
                placeholder="Password"
                type="password"
                value={resetPassword}
              />
            </div>

            <div className="space-y-2">
              <p className="text-muted-foreground">Type RESET to confirm:</p>
              <Input
                autoComplete="off"
                disabled={isResettingApp}
                onChange={(event) => {
                  setResetConfirmText(event.target.value);
                  setResetError(null);
                }}
                placeholder="RESET"
                value={resetConfirmText}
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                checked={resetAcknowledgeChecked}
                className="h-4 w-4 rounded border border-input bg-background"
                disabled={isResettingApp}
                onChange={(event) => {
                  setResetAcknowledgeChecked(event.target.checked);
                  setResetError(null);
                }}
                type="checkbox"
              />
              I understand this deletes all data.
            </label>

            {resetError && <p className="text-xs text-destructive">{resetError}</p>}
          </div>

          <DialogFooter>
            <Button
              disabled={isResettingApp}
              onClick={() => closeResetDialog(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={!canConfirmReset}
              onClick={() => void handleResetApp()}
              type="button"
              variant="destructive"
            >
              {isResettingApp ? "Resetting..." : "Reset & Close App"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setOauthConfigDialogOpen} open={oauthConfigDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Google OAuth client JSON not configured</DialogTitle>
            <DialogDescription>{oauthConfigMessage}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm text-muted-foreground">
            <p>Place the downloaded OAuth desktop JSON at:</p>
            <p className="rounded-md border border-border bg-card px-3 py-2 font-mono text-xs">
              {WINDOWS_OAUTH_JSON_PATH}
            </p>
            <p>Or set the environment variable before starting the server:</p>
            <p className="rounded-md border border-border bg-card px-3 py-2 font-mono text-xs">
              {`$env:MAILPILOT_GOOGLE_OAUTH_CLIENT_JSON="${WINDOWS_OAUTH_JSON_PATH}"`}
            </p>
            {oauthConfigPath && oauthConfigPath !== WINDOWS_OAUTH_JSON_PATH && (
              <p className="rounded-md border border-border bg-card px-3 py-2 font-mono text-xs">
                Resolved path: {oauthConfigPath}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setOauthConfigDialogOpen(false)} type="button" variant="outline">
              Close
            </Button>
            <Button
              onClick={() => {
                setOauthConfigDialogOpen(false);
                void handleConnectGmail();
              }}
              type="button"
            >
              Retry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showSenderHighlightsInSettings && (
        <Dialog onOpenChange={setRuleDialogOpen} open={ruleDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingRuleId ? "Edit sender highlight rule" : "Create sender highlight rule"}
              </DialogTitle>
              <DialogDescription>
                Use EMAIL for exact sender matches and DOMAIN for broader sender groups.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Match type</p>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  onChange={(event) =>
                    setRuleForm((previous) => ({
                      ...previous,
                      matchType: event.target.value as SenderRuleMatchType,
                    }))
                  }
                  value={ruleForm.matchType}
                >
                  <option value="EMAIL">EMAIL</option>
                  <option value="DOMAIN">DOMAIN</option>
                </select>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Match value</p>
                <Input
                  onChange={(event) =>
                    setRuleForm((previous) => ({
                      ...previous,
                      matchValue: event.target.value,
                    }))
                  }
                  placeholder={ruleForm.matchType === "EMAIL" ? "boss@company.com" : "company.com"}
                  value={ruleForm.matchValue}
                />
                {ruleFormErrors.matchValue && (
                  <p className="text-xs text-destructive">{ruleFormErrors.matchValue}</p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Label</p>
                <Input
                  onChange={(event) =>
                    setRuleForm((previous) => ({
                      ...previous,
                      label: event.target.value,
                    }))
                  }
                  placeholder="BOSS"
                  value={ruleForm.label}
                />
                {ruleFormErrors.label && (
                  <p className="text-xs text-destructive">{ruleFormErrors.label}</p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Accent</p>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  onChange={(event) =>
                    setRuleForm((previous) => ({
                      ...previous,
                      accent: event.target.value as AccentToken,
                    }))
                  }
                  value={ruleForm.accent}
                >
                  {ACCENT_TOKENS.map((accentToken) => (
                    <option key={accentToken} value={accentToken}>
                      {accentToken}
                    </option>
                  ))}
                </select>
              </div>

              {ruleActionError && <p className="text-sm text-destructive">{ruleActionError}</p>}
            </div>

            <DialogFooter>
              <Button onClick={() => setRuleDialogOpen(false)} type="button" variant="outline">
                Cancel
              </Button>
              <Button disabled={isSavingRule} onClick={() => void handleSaveRule()} type="button">
                {isSavingRule ? "Saving..." : "Save rule"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {notice && (
        <div className="mailbox-toast fixed bottom-5 right-5 z-[60] rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
          {notice.message}
        </div>
      )}
    </section>
  );
}
