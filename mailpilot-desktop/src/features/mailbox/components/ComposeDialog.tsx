import { Loader2, Paperclip, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "@/lib/api/client";
import { sendMail, type MailSendMode, type SendMailResponse } from "@/lib/api/mail";
import type { AccountRecord } from "@/lib/api/accounts";
import { pickFilesForUpload } from "@/lib/files/pick-files";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type ComposeDraft = {
  mode: MailSendMode;
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyText: string;
  replyToMessageDbId: string | null;
};

type DraftAttachment = {
  id: string;
  fileName: string;
  mimeType: string | null;
  bytes: Uint8Array;
  size: number;
};

type ComposeDialogProps = {
  open: boolean;
  accounts: AccountRecord[];
  initialDraft: ComposeDraft;
  onOpenChange: (open: boolean) => void;
  onSendSuccess: (result: SendMailResponse) => void;
  onRequestReauth: (accountId: string) => Promise<boolean>;
};

function isToRequired(mode: MailSendMode) {
  return mode === "NEW" || mode === "FORWARD";
}

function getModeLabel(mode: MailSendMode): string {
  if (mode === "REPLY") {
    return "Reply";
  }
  if (mode === "REPLY_ALL") {
    return "Reply all";
  }
  if (mode === "FORWARD") {
    return "Forward";
  }
  return "New message";
}

export function ComposeDialog({
  open,
  accounts,
  initialDraft,
  onOpenChange,
  onSendSuccess,
  onRequestReauth,
}: ComposeDialogProps) {
  const gmailAccounts = useMemo(
    () => accounts.filter((account) => account.provider === "GMAIL"),
    [accounts],
  );

  const [accountId, setAccountId] = useState(initialDraft.accountId);
  const [to, setTo] = useState(initialDraft.to);
  const [cc, setCc] = useState(initialDraft.cc);
  const [bcc, setBcc] = useState(initialDraft.bcc);
  const [subject, setSubject] = useState(initialDraft.subject);
  const [bodyText, setBodyText] = useState(initialDraft.bodyText);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isPickingAttachment, setIsPickingAttachment] = useState(false);
  const [isReauthing, setIsReauthing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showReauthDialog, setShowReauthDialog] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setAccountId(initialDraft.accountId);
    setTo(initialDraft.to);
    setCc(initialDraft.cc);
    setBcc(initialDraft.bcc);
    setSubject(initialDraft.subject);
    setBodyText(initialDraft.bodyText);
    setAttachments([]);
    setIsSending(false);
    setIsPickingAttachment(false);
    setIsReauthing(false);
    setErrorMessage(null);
    setShowReauthDialog(false);
  }, [initialDraft, open]);

  const selectedAccount = gmailAccounts.find((account) => account.id === accountId) ?? null;
  const canSend = selectedAccount?.canSend ?? false;
  const toRequired = isToRequired(initialDraft.mode);

  const canSubmit = useMemo(() => {
    if (!accountId || !selectedAccount) {
      return false;
    }
    if (!canSend) {
      return false;
    }
    if (toRequired && to.trim().length === 0) {
      return false;
    }
    if (initialDraft.mode === "NEW" && subject.trim().length === 0) {
      return false;
    }
    return true;
  }, [accountId, canSend, initialDraft.mode, selectedAccount, subject, to, toRequired]);

  const handleAddAttachment = async () => {
    setErrorMessage(null);
    setIsPickingAttachment(true);
    try {
      const pickedFiles = await pickFilesForUpload();
      if (pickedFiles.length === 0) {
        return;
      }
      setAttachments((previous) => [
        ...previous,
        ...pickedFiles.map((file) => ({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          fileName: file.fileName,
          mimeType: file.mimeType,
          bytes: file.bytes,
          size: file.size,
        })),
      ]);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsPickingAttachment(false);
    }
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    setAttachments((previous) => previous.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleSend = async () => {
    if (!selectedAccount) {
      setErrorMessage("Select a Gmail account before sending.");
      return;
    }

    if (toRequired && to.trim().length === 0) {
      setErrorMessage("To is required.");
      return;
    }

    if (initialDraft.mode === "NEW" && subject.trim().length === 0) {
      setErrorMessage("Subject is required for new email.");
      return;
    }

    setErrorMessage(null);
    setIsSending(true);
    try {
      const response = await sendMail({
        accountId: selectedAccount.id,
        to,
        cc,
        bcc,
        subject,
        bodyText,
        mode: initialDraft.mode,
        replyToMessageDbId: initialDraft.replyToMessageDbId ?? undefined,
        attachments: attachments.map((attachment) => ({
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          bytes: attachment.bytes,
        })),
      });
      onSendSuccess(response);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        setErrorMessage(error.message);
        setShowReauthDialog(true);
        return;
      }
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsSending(false);
    }
  };

  const handleReauthNow = async () => {
    if (!accountId) {
      setErrorMessage("Select an account to re-authenticate.");
      return;
    }
    setIsReauthing(true);
    const success = await onRequestReauth(accountId);
    setIsReauthing(false);
    if (success) {
      setShowReauthDialog(false);
      setErrorMessage(null);
    }
  };

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{getModeLabel(initialDraft.mode)}</DialogTitle>
            <DialogDescription>Send via Gmail API (MP-PT15).</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[200px_1fr]">
              <label className="pt-2 text-xs font-medium text-muted-foreground">Account</label>
              <div className="space-y-2">
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  onChange={(event) => setAccountId(event.target.value)}
                  value={accountId}
                >
                  {gmailAccounts.length === 0 && <option value="">No Gmail accounts</option>}
                  {gmailAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.email}
                    </option>
                  ))}
                </select>
                {selectedAccount && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={selectedAccount.canSend ? "secondary" : "outline"}>
                      {selectedAccount.canSend ? "Send enabled" : "Re-auth required"}
                    </Badge>
                    {!selectedAccount.canSend && (
                      <Button onClick={() => setShowReauthDialog(true)} size="sm" variant="outline">
                        Re-auth now
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[200px_1fr]">
              <label className="pt-2 text-xs font-medium text-muted-foreground">
                To {toRequired ? "*" : "(optional)"}
              </label>
              <Input onChange={(event) => setTo(event.target.value)} placeholder="alice@example.com, bob@example.com" value={to} />
            </div>

            <div className="grid gap-3 md:grid-cols-[200px_1fr]">
              <label className="pt-2 text-xs font-medium text-muted-foreground">Cc</label>
              <Input onChange={(event) => setCc(event.target.value)} placeholder="optional" value={cc} />
            </div>

            <div className="grid gap-3 md:grid-cols-[200px_1fr]">
              <label className="pt-2 text-xs font-medium text-muted-foreground">Bcc</label>
              <Input onChange={(event) => setBcc(event.target.value)} placeholder="optional" value={bcc} />
            </div>

            <div className="grid gap-3 md:grid-cols-[200px_1fr]">
              <label className="pt-2 text-xs font-medium text-muted-foreground">
                Subject {initialDraft.mode === "NEW" ? "*" : "(optional)"}
              </label>
              <Input onChange={(event) => setSubject(event.target.value)} placeholder="Subject" value={subject} />
            </div>

            <div className="grid gap-3 md:grid-cols-[200px_1fr]">
              <label className="pt-2 text-xs font-medium text-muted-foreground">Body</label>
              <textarea
                className={cn(
                  "min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                onChange={(event) => setBodyText(event.target.value)}
                value={bodyText}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-[200px_1fr]">
              <label className="pt-2 text-xs font-medium text-muted-foreground">Attachments</label>
              <div className="space-y-2">
                <Button
                  className="gap-2"
                  disabled={isPickingAttachment}
                  onClick={() => void handleAddAttachment()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isPickingAttachment ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                  {isPickingAttachment ? "Picking..." : "Add attachment"}
                </Button>

                {attachments.length > 0 && (
                  <div className="space-y-1 rounded-md border border-border bg-card p-2">
                    {attachments.map((attachment) => (
                      <div className="flex items-center justify-between gap-2 text-xs" key={attachment.id}>
                        <span className="truncate">
                          {attachment.fileName} ({formatBytes(attachment.size)})
                        </span>
                        <Button
                          className="h-6 w-6 p-0"
                          onClick={() => handleRemoveAttachment(attachment.id)}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {errorMessage && (
              <p className="rounded-md border border-border bg-card px-3 py-2 text-sm text-destructive">
                {errorMessage}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              className="gap-2"
              disabled={isSending || !canSubmit}
              onClick={() => void handleSend()}
              type="button"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {isSending ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setShowReauthDialog} open={showReauthDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Re-auth required to send email</DialogTitle>
            <DialogDescription>
              This account is missing the `gmail.send` scope. Re-authenticate with SEND mode to continue.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowReauthDialog(false)} type="button" variant="outline">
              Close
            </Button>
            <Button
              disabled={isReauthing}
              onClick={() => void handleReauthNow()}
              type="button"
            >
              {isReauthing ? "Starting..." : "Re-auth now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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

export type { ComposeDraft };
