import { Loader2, PencilLine, Paperclip, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ComposeDialog, type ComposeDraft } from "@/features/mailbox/components/ComposeDialog";
import { listAccounts, type AccountRecord } from "@/lib/api/accounts";
import {
  deleteDraft,
  getDraft,
  listDrafts,
  type DraftSortOrder,
  type DraftSummary,
} from "@/lib/api/drafts";
import { ApiClientError } from "@/lib/api/client";
import { configCheck, getGmailOAuthStatus, startGmailOAuth } from "@/lib/api/oauth";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const OAUTH_POLL_INTERVAL_MS = 2000;
const OAUTH_POLL_TIMEOUT_MS = 45000;

const EMPTY_COMPOSE_DRAFT: ComposeDraft = {
  mode: "NEW",
  accountId: "",
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  bodyText: "",
  replyToMessageDbId: null,
  draftId: null,
  attachments: [],
};

export function DraftsPage() {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [accountScope, setAccountScope] = useState<string>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<DraftSortOrder>("UPDATED_DESC");
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingDraftId, setLoadingDraftId] = useState<string | null>(null);
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDraft, setComposeDraft] = useState<ComposeDraft>(EMPTY_COMPOSE_DRAFT);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadAccounts = useCallback(async () => {
    const loaded = await listAccounts();
    const gmailOnly = loaded.filter((account) => account.provider === "GMAIL");
    setAccounts(gmailOnly);
    return gmailOnly;
  }, []);

  useEffect(() => {
    void loadAccounts().catch((error) => {
      setListError(toErrorMessage(error));
    });
  }, [loadAccounts]);

  const refreshDrafts = useCallback(async () => {
    setIsLoading(true);
    setListError(null);
    try {
      const loaded = await listDrafts({
        accountId: accountScope === "ALL" ? null : accountScope,
        q: searchQuery,
        sort: sortOrder,
      });
      setDrafts(loaded);
    } catch (error) {
      setListError(toErrorMessage(error));
      setDrafts([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [accountScope, searchQuery, sortOrder]);

  useEffect(() => {
    void refreshDrafts();
  }, [refreshDrafts]);

  const preferredAccountId = useMemo(() => {
    const primary = accounts.find((account) => account.role === "PRIMARY" && account.provider === "GMAIL");
    if (primary) {
      return primary.id;
    }
    const canSend = accounts.find((account) => account.provider === "GMAIL" && account.canSend);
    if (canSend) {
      return canSend.id;
    }
    return accounts[0]?.id ?? "";
  }, [accounts]);

  const handleOpenNewDraft = useCallback(() => {
    setComposeDraft({
      ...EMPTY_COMPOSE_DRAFT,
      accountId: preferredAccountId,
    });
    setComposeOpen(true);
  }, [preferredAccountId]);

  const handleContinueDraft = useCallback(async (draftId: string) => {
    setLoadingDraftId(draftId);
    try {
      const detail = await getDraft(draftId);
      setComposeDraft({
        mode: "NEW",
        draftId: detail.id,
        accountId: detail.accountId,
        to: detail.to,
        cc: detail.cc,
        bcc: detail.bcc,
        subject: detail.subject,
        bodyText: detail.bodyText,
        replyToMessageDbId: null,
        attachments: detail.attachments,
      });
      setComposeOpen(true);
    } catch (error) {
      setListError(toErrorMessage(error));
    } finally {
      setLoadingDraftId(null);
    }
  }, []);

  const handleDiscardDraft = useCallback(async (draft: DraftSummary) => {
    const confirmed = window.confirm("Discard draft? This will permanently delete it.");
    if (!confirmed) {
      return;
    }
    setDeletingDraftId(draft.id);
    try {
      await deleteDraft(draft.id);
      setDrafts((previous) => previous.filter((item) => item.id !== draft.id));
    } catch (error) {
      setListError(toErrorMessage(error));
    } finally {
      setDeletingDraftId(null);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void refreshDrafts();
  }, [refreshDrafts]);

  const handleComposeOpenChange = useCallback((nextOpen: boolean) => {
    setComposeOpen(nextOpen);
    if (!nextOpen) {
      void refreshDrafts();
    }
  }, [refreshDrafts]);

  const handleComposeSendSuccess = useCallback(() => {
    void refreshDrafts();
  }, [refreshDrafts]);

  const handleDraftDeleted = useCallback((deletedDraftId: string) => {
    setDrafts((previous) => previous.filter((draft) => draft.id !== deletedDraftId));
  }, []);

  const handleRequestSendReauth = useCallback(
    async (accountId: string) => {
      try {
        const config = await configCheck();
        if (!config.configured) {
          setListError(config.message || "Google OAuth configuration is missing.");
          return false;
        }

        const startResponse = await startGmailOAuth({
          mode: "SEND",
          returnTo: "mailpilot://oauth-done",
        });

        try {
          await openUrl(startResponse.authUrl);
        } catch {
          const popup = window.open(startResponse.authUrl, "_blank", "noopener,noreferrer");
          if (!popup) {
            throw new ApiClientError("Unable to open the system browser for Google OAuth.");
          }
        }

        const pollStartedAt = Date.now();
        while (Date.now() - pollStartedAt <= OAUTH_POLL_TIMEOUT_MS) {
          await sleep(OAUTH_POLL_INTERVAL_MS);

          const [accountsResult, statusResult] = await Promise.allSettled([
            loadAccounts(),
            getGmailOAuthStatus(startResponse.state),
          ]);

          if (accountsResult.status === "fulfilled") {
            const refreshed = accountsResult.value;
            const account = refreshed.find((item) => item.id === accountId);
            if (account?.canSend) {
              return true;
            }
          }

          if (statusResult.status === "fulfilled" && statusResult.value.status === "ERROR") {
            setListError(statusResult.value.message);
            return false;
          }
        }

        setListError("Re-auth timed out. Retry and complete consent in the browser tab.");
        return false;
      } catch (error) {
        setListError(toErrorMessage(error));
        return false;
      }
    },
    [loadAccounts],
  );

  return (
    <section className="space-y-4">
      <div className="mailbox-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Drafts</h1>
            <p className="pt-1 text-sm text-muted-foreground">
              Local drafts persisted in Postgres across app restarts.
            </p>
          </div>
          <Badge variant="secondary">
            {isLoading ? "Loading..." : `${drafts.length.toLocaleString()} drafts`}
          </Badge>
        </div>
      </div>

      <div className="mailbox-panel space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Draft account scope"
            className="h-9 min-w-[180px] rounded-md border border-input bg-background px-3 text-sm"
            onChange={(event) => setAccountScope(event.target.value)}
            value={accountScope}
          >
            <option value="ALL">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.email}
              </option>
            ))}
          </select>

          <Input
            className="min-w-[220px] flex-1"
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search subject, recipient, body..."
            value={searchInput}
          />

          <select
            aria-label="Draft sort order"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            onChange={(event) => setSortOrder(event.target.value as DraftSortOrder)}
            value={sortOrder}
          >
            <option value="UPDATED_DESC">Newest updated</option>
            <option value="UPDATED_ASC">Oldest updated</option>
          </select>

          <Button
            className="gap-2"
            disabled={isRefreshing}
            onClick={handleRefresh}
            size="sm"
            variant="outline"
          >
            {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>

          <Button className="gap-2" onClick={handleOpenNewDraft}>
            <PencilLine className="h-4 w-4" />
            Compose
          </Button>
        </div>
      </div>

      <div className="mailbox-panel divide-y divide-border">
        {listError && (
          <div className="p-4 text-sm text-destructive">{listError}</div>
        )}

        {!listError && isLoading && (
          <div className="p-6 text-sm text-muted-foreground">Loading drafts...</div>
        )}

        {!listError && !isLoading && drafts.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No drafts yet.</div>
        )}

        {!listError && !isLoading && drafts.map((draft) => {
          const isRowLoading = loadingDraftId === draft.id;
          const isRowDeleting = deletingDraftId === draft.id;
          return (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4" key={draft.id}>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">
                    {draft.subject.trim().length > 0 ? draft.subject : "(no subject)"}
                  </p>
                  <Badge className="max-w-[260px] truncate" variant="outline">
                    {draft.accountEmail}
                  </Badge>
                  {draft.hasAttachments && (
                    <Badge className="gap-1" variant="secondary">
                      <Paperclip className="h-3 w-3" />
                      Attachments
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  To: {draft.to.trim().length > 0 ? draft.to : "(no recipients)"}
                </p>
                {draft.snippet.trim().length > 0 && (
                  <p className="truncate text-xs text-muted-foreground">{draft.snippet}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Updated {formatRelativeTime(draft.updatedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  className="gap-2"
                  disabled={isRowLoading || isRowDeleting}
                  onClick={() => {
                    void handleContinueDraft(draft.id);
                  }}
                  size="sm"
                >
                  {isRowLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />}
                  Continue
                </Button>
                <Button
                  className="gap-2"
                  disabled={isRowLoading || isRowDeleting}
                  onClick={() => {
                    void handleDiscardDraft(draft);
                  }}
                  size="sm"
                  variant="destructive"
                >
                  {isRowDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Discard
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <ComposeDialog
        accounts={accounts}
        initialDraft={composeDraft}
        onOpenChange={handleComposeOpenChange}
        onDraftDeleted={handleDraftDeleted}
        onRequestReauth={handleRequestSendReauth}
        onSendSuccess={handleComposeSendSuccess}
        open={composeOpen}
      />
    </section>
  );
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

function formatRelativeTime(input: string): string {
  const target = new Date(input).getTime();
  if (Number.isNaN(target)) {
    return "just now";
  }

  const diffMs = Date.now() - target;
  const absSeconds = Math.floor(Math.abs(diffMs) / 1000);
  if (absSeconds < 60) {
    return "just now";
  }

  const absMinutes = Math.floor(absSeconds / 60);
  if (absMinutes < 60) {
    return `${absMinutes}m ago`;
  }

  const absHours = Math.floor(absMinutes / 60);
  if (absHours < 24) {
    return `${absHours}h ago`;
  }

  const absDays = Math.floor(absHours / 24);
  if (absDays < 7) {
    return `${absDays}d ago`;
  }

  return new Date(input).toLocaleDateString();
}

function sleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}
