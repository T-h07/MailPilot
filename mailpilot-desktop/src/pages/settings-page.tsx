import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { AppOutletContext } from "@/App";
import { cn } from "@/lib/utils";
import { listAccounts, type AccountRecord } from "@/lib/api/accounts";
import { ApiClientError, getApiHealth, resolveApiBase } from "@/lib/api/client";
import { seedDev } from "@/lib/api/mailbox";
import { configCheck, getGmailOAuthStatus, startGmailOAuth } from "@/lib/api/oauth";
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

const EMPTY_RULE_FORM: RuleForm = {
  matchType: "EMAIL",
  matchValue: "",
  label: "BOSS",
  accent: "gold",
};

const WINDOWS_OAUTH_JSON_PATH = "C:\\Users\\taulanth\\AppData\\Local\\MailPilot\\google-oauth-client.json";
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

function validateRuleForm(form: RuleForm): RuleFormErrors {
  const errors: RuleFormErrors = {};
  const matchValue = form.matchValue.trim();
  const label = form.label.trim();

  if (!matchValue) {
    errors.matchValue = "Match value is required";
  } else if (form.matchType === "EMAIL" && !matchValue.includes("@")) {
    errors.matchValue = "Enter a valid email address";
  } else if (form.matchType === "DOMAIN" && (matchValue.includes("@") || !matchValue.includes("."))) {
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

export function SettingsPage() {
  const { themeMode, setThemeMode } = useOutletContext<AppOutletContext>();
  const nextTheme = themeMode === "dark" ? "light" : "dark";
  const modeLabel = themeMode === "dark" ? "Dark" : "Light";
  const nextThemeLabel = nextTheme === "dark" ? "Dark" : "Light";
  const apiBase = useMemo(() => resolveApiBase(), []);

  const noticeTimeoutRef = useRef<number | null>(null);

  const [healthStatus, setHealthStatus] = useState<string>("Unknown");
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [seedStatus, setSeedStatus] = useState<string>("Not run");
  const [isSeeding, setIsSeeding] = useState(false);

  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const [oauthConfigDialogOpen, setOauthConfigDialogOpen] = useState(false);
  const [oauthConfigPath, setOauthConfigPath] = useState<string>(WINDOWS_OAUTH_JSON_PATH);
  const [oauthConfigMessage, setOauthConfigMessage] = useState("Google OAuth configuration is missing.");
  const [notice, setNotice] = useState<NoticeState | null>(null);

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
    [accounts],
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

  const loadAccounts = useCallback(async () => {
    setIsLoadingAccounts(true);
    setAccountsError(null);
    try {
      const response = await listAccounts();
      setAccounts(response);
    } catch (error) {
      setAccountsError(toErrorMessage(error));
    } finally {
      setIsLoadingAccounts(false);
    }
  }, []);

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
  }, [loadAccounts]);

  useEffect(() => {
    void loadSenderRules();
  }, [loadSenderRules]);

  useEffect(() => {
    return () => {
      if (noticeTimeoutRef.current !== null) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);

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

  const handleSeedDev = async () => {
    setIsSeeding(true);
    try {
      const response = await seedDev();
      setSeedStatus(response.message ?? "Seed endpoint completed");
    } catch (error) {
      setSeedStatus(`Error · ${toErrorMessage(error)}`);
    } finally {
      setIsSeeding(false);
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
          setAccounts(latestAccounts);
          setAccountsError(null);
        } else {
          setAccountsError(toErrorMessage(accountsResult.reason));
        }

        if (statusResult.status === "fulfilled" && statusResult.value.status === "ERROR") {
          return statusResult.value.message;
        }

        const gmailConnected = latestAccounts.some((account) => {
          if (account.provider !== "GMAIL" || account.status !== "CONNECTED") {
            return false;
          }
          const baselineStatus = baselineByEmail.get(account.email.toLowerCase());
          return baselineStatus !== "CONNECTED";
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
    [accounts],
  );

  const handleConnectGmail = async () => {
    setOauthError(null);
    setIsConnectingGmail(true);

    const baselineByEmail = new Map(
      gmailAccounts.map((account) => [account.email.toLowerCase(), account.status]),
    );

    try {
      const config = await configCheck();
      if (!config.configured) {
        setOauthConfigPath(config.path ?? WINDOWS_OAUTH_JSON_PATH);
        setOauthConfigMessage(config.message);
        setOauthConfigDialogOpen(true);
        return;
      }

      const startResponse = await startGmailOAuth({ returnTo: "mailpilot://oauth-done" });

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
      showNotice("Gmail account connected");
    } catch (error) {
      setOauthError(toErrorMessage(error));
    } finally {
      setIsConnectingGmail(false);
    }
  };

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
            Persisted locally. This currently controls the desktop shell visuals only.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary">Current mode: {modeLabel}</Badge>
          <Button onClick={() => setThemeMode(nextTheme)}>Switch to {nextThemeLabel}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System</CardTitle>
          <CardDescription>Connection and seed controls for local development.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Backend endpoint: {apiBase}</p>
          <p>Sync scheduler: Disabled</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={isCheckingHealth}
              onClick={handleTestConnection}
              size="sm"
              variant="outline"
            >
              {isCheckingHealth ? "Testing..." : "Test connection"}
            </Button>
            <Badge variant="secondary">{healthStatus}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={isSeeding} onClick={handleSeedDev} size="sm" variant="outline">
              {isSeeding ? "Seeding..." : "Seed dev data"}
            </Button>
            <Badge variant="secondary">{seedStatus}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Connected Accounts</CardTitle>
              <CardDescription>
                Connect Gmail using Google OAuth. Tokens are stored encrypted by the backend.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button disabled={isLoadingAccounts} onClick={() => void loadAccounts()} size="sm" variant="outline">
                Refresh
              </Button>
              <Button disabled={isConnectingGmail} onClick={() => void handleConnectGmail()} size="sm">
                {isConnectingGmail ? "Connecting..." : "Connect Gmail"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {oauthError && (
            <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
              <p className="whitespace-pre-line">{oauthError}</p>
              <Button className="mt-3" onClick={() => void handleConnectGmail()} size="sm" variant="outline">
                Retry
              </Button>
            </div>
          )}

          {isLoadingAccounts && (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, index) => (
                <div className="h-12 animate-pulse rounded-lg border border-border bg-muted" key={index} />
              ))}
            </div>
          )}

          {!isLoadingAccounts && accountsError && (
            <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
              <p>{accountsError}</p>
              <Button className="mt-3" onClick={() => void loadAccounts()} size="sm" variant="outline">
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
              {accounts.map((account) => (
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
                    </div>
                    <p className="pt-1 text-xs text-muted-foreground">
                      Last sync: {formatLastSync(account.lastSyncAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
                <div className="h-12 animate-pulse rounded-lg border border-border bg-muted" key={index} />
              ))}
            </div>
          )}

          {!isLoadingRules && rulesError && (
            <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
              <p>{rulesError}</p>
              <Button className="mt-3" onClick={() => void loadSenderRules()} size="sm" variant="outline">
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
                      <p className="pt-1 text-xs text-muted-foreground">Accent token: {rule.accent}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button onClick={() => openEditRuleDialog(rule)} size="sm" variant="outline">
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

      <Dialog onOpenChange={setRuleDialogOpen} open={ruleDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRuleId ? "Edit sender highlight rule" : "Create sender highlight rule"}</DialogTitle>
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
              {ruleFormErrors.label && <p className="text-xs text-destructive">{ruleFormErrors.label}</p>}
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

      {notice && (
        <div className="mailbox-toast fixed bottom-5 right-5 z-[60] rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
          {notice.message}
        </div>
      )}
    </section>
  );
}
