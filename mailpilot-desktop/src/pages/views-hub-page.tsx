import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, Pencil, Copy, Trash2, RefreshCw } from "lucide-react";
import type { AppOutletContext } from "@/App";
import { ApiClientError } from "@/lib/api/client";
import { listAccounts, type AccountRecord } from "@/lib/api/accounts";
import {
  createView,
  deleteView,
  updateView,
  type ViewRecord,
  type ViewUpsertPayload,
} from "@/lib/api/views";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

type DialogMode = "create" | "edit" | "duplicate";

type FormState = {
  name: string;
  priority: number;
  sortOrder: number;
  icon: string;
  scopeType: "ALL" | "SELECTED";
  selectedAccountIds: string[];
  senderDomains: string[];
  senderEmails: string[];
  keywords: string[];
  unreadOnly: boolean;
};

type FormErrors = {
  name?: string;
  scopeType?: string;
  senderDomains?: string;
  senderEmails?: string;
  keywords?: string;
};

const ICON_OPTIONS = ["briefcase", "network", "gamepad-2", "megaphone", "star", "folder"];

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
}

function createEmptyForm(): FormState {
  return {
    name: "",
    priority: 3,
    sortOrder: 0,
    icon: "",
    scopeType: "ALL",
    selectedAccountIds: [],
    senderDomains: [],
    senderEmails: [],
    keywords: [],
    unreadOnly: false,
  };
}

function toFormState(view: ViewRecord): FormState {
  return {
    name: view.name,
    priority: view.priority,
    sortOrder: view.sortOrder,
    icon: view.icon ?? "",
    scopeType: view.scopeType,
    selectedAccountIds: [...view.selectedAccountIds],
    senderDomains: [...view.rules.senderDomains],
    senderEmails: [...view.rules.senderEmails],
    keywords: [...view.rules.keywords],
    unreadOnly: view.rules.unreadOnly,
  };
}

function toPayload(form: FormState): ViewUpsertPayload {
  return {
    name: form.name.trim(),
    priority: form.priority,
    sortOrder: form.sortOrder,
    icon: form.icon.trim() || null,
    scopeType: form.scopeType,
    selectedAccountIds: [...form.selectedAccountIds],
    rules: {
      senderDomains: [...form.senderDomains],
      senderEmails: [...form.senderEmails],
      keywords: [...form.keywords],
      unreadOnly: form.unreadOnly,
    },
  };
}

function summarizeRules(view: ViewRecord): string {
  const parts: string[] = [];
  if (view.rules.senderDomains.length > 0) {
    parts.push(`${view.rules.senderDomains.length} domains`);
  }
  if (view.rules.senderEmails.length > 0) {
    parts.push(`${view.rules.senderEmails.length} senders`);
  }
  if (view.rules.keywords.length > 0) {
    parts.push(`${view.rules.keywords.length} keywords`);
  }
  if (view.rules.unreadOnly) {
    parts.push("unread only");
  }
  return parts.length > 0 ? parts.join(", ") : "no explicit rules";
}

function validateForm(form: FormState): FormErrors {
  const errors: FormErrors = {};

  if (form.name.trim().length < 2 || form.name.trim().length > 50) {
    errors.name = "Name must be between 2 and 50 characters";
  }

  if (form.scopeType === "SELECTED" && form.selectedAccountIds.length === 0) {
    errors.scopeType = "Select at least one account for SELECTED scope";
  }

  if (form.senderDomains.length > 50) {
    errors.senderDomains = "Maximum 50 domains";
  }
  if (form.senderEmails.length > 50) {
    errors.senderEmails = "Maximum 50 sender emails";
  }
  if (form.keywords.length > 50) {
    errors.keywords = "Maximum 50 keywords";
  }

  return errors;
}

function TagInput({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const addDraft = () => {
    const normalized = draft.trim();
    if (!normalized) {
      return;
    }
    if (values.includes(normalized)) {
      setDraft("");
      return;
    }
    onChange([...values, normalized]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <Input
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addDraft();
            }
          }}
          placeholder={placeholder}
          value={draft}
        />
        <Button onClick={addDraft} size="sm" type="button" variant="outline">
          Add
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <button
              className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs"
              key={value}
              onClick={() => onChange(values.filter((candidate) => candidate !== value))}
              type="button"
            >
              {value} ×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ViewsHubPage() {
  const { views, viewsLoading, viewsError, refreshViews } = useOutletContext<AppOutletContext>();

  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("create");
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(createEmptyForm());
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listAccounts(controller.signal)
      .then((response) => {
        setAccounts(response);
      })
      .catch((error) => {
        setAccountsError(toErrorMessage(error));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (views.length === 0) {
      setSelectedViewId(null);
      return;
    }
    const selectedExists = views.some((view) => view.id === selectedViewId);
    if (!selectedExists) {
      setSelectedViewId(views[0].id);
    }
  }, [selectedViewId, views]);

  const selectedView = useMemo(
    () => views.find((view) => view.id === selectedViewId) ?? null,
    [selectedViewId, views],
  );

  const accountMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.email])),
    [accounts],
  );

  const openCreateDialog = () => {
    setDialogMode("create");
    setEditingViewId(null);
    setForm(createEmptyForm());
    setFormErrors({});
    setActionError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (view: ViewRecord) => {
    setDialogMode("edit");
    setEditingViewId(view.id);
    setForm(toFormState(view));
    setFormErrors({});
    setActionError(null);
    setDialogOpen(true);
  };

  const openDuplicateDialog = (view: ViewRecord) => {
    const duplicateForm = toFormState(view);
    duplicateForm.name = `${view.name} (copy)`;
    duplicateForm.sortOrder = Math.min(9999, view.sortOrder + 1);

    setDialogMode("duplicate");
    setEditingViewId(null);
    setForm(duplicateForm);
    setFormErrors({});
    setActionError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const errors = validateForm(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSaving(true);
    setActionError(null);

    try {
      const payload = toPayload(form);
      const savedView =
        dialogMode === "edit" && editingViewId
          ? await updateView(editingViewId, payload)
          : await createView(payload);

      setBanner(
        dialogMode === "edit"
          ? "View updated"
          : dialogMode === "duplicate"
            ? "View duplicated"
            : "View created",
      );
      setDialogOpen(false);
      await refreshViews();
      setSelectedViewId(savedView.id);
    } catch (error) {
      setActionError(toErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (viewId: string) => {
    const candidate = views.find((view) => view.id === viewId);
    if (!candidate) {
      return;
    }

    const confirmed = window.confirm(`Delete view "${candidate.name}"?`);
    if (!confirmed) {
      return;
    }

    setDeletingViewId(viewId);
    setActionError(null);

    try {
      await deleteView(viewId);
      setBanner("View deleted");
      await refreshViews();
      if (selectedViewId === viewId) {
        setSelectedViewId(null);
      }
    } catch (error) {
      setActionError(toErrorMessage(error));
    } finally {
      setDeletingViewId(null);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Views Hub</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Saved views define reusable mailbox filters. Manage scope, priority, and rule chips here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void refreshViews()} size="sm" variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={openCreateDialog} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Create View
          </Button>
        </div>
      </div>

      {banner && (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          {banner}
        </div>
      )}

      {actionError && (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Saved Views</CardTitle>
            <CardDescription>Ordered by sort order. Click a row to inspect details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {viewsLoading && (
              <div className="space-y-2">
                {Array.from({ length: 5 }, (_, index) => (
                  <div className="h-14 animate-pulse rounded-lg border bg-muted" key={index} />
                ))}
              </div>
            )}

            {!viewsLoading && viewsError && (
              <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
                <p>{viewsError}</p>
                <Button className="mt-3" onClick={() => void refreshViews()} size="sm" variant="outline">
                  Retry
                </Button>
              </div>
            )}

            {!viewsLoading && !viewsError && views.length === 0 && (
              <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
                No views found. Create your first saved view.
              </div>
            )}

            {!viewsLoading && !viewsError && views.map((view) => (
              <div
                className={`rounded-lg border border-border p-3 ${
                  view.id === selectedViewId ? "bg-accent" : "bg-background"
                }`}
                key={view.id}
                onClick={() => setSelectedViewId(view.id)}
                role="button"
                tabIndex={0}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{view.name}</p>
                    <p className="pt-1 text-xs text-muted-foreground">
                      Scope: {view.scopeType} • {summarizeRules(view)}
                    </p>
                  </div>
                  <Badge variant="secondary">P{view.priority}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditDialog(view);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    onClick={(event) => {
                      event.stopPropagation();
                      openDuplicateDialog(view);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    Duplicate
                  </Button>
                  <Button
                    disabled={deletingViewId === view.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDelete(view.id);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    {deletingViewId === view.id ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Details</CardTitle>
            <CardDescription>Rules and scope for the selected view.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!selectedView && <p className="text-muted-foreground">Select a view to inspect details.</p>}

            {selectedView && (
              <>
                <div className="space-y-1">
                  <p className="font-semibold">{selectedView.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Priority P{selectedView.priority} • Sort {selectedView.sortOrder}
                  </p>
                  <p className="text-xs text-muted-foreground">Scope: {selectedView.scopeType}</p>
                </div>

                {selectedView.scopeType === "SELECTED" && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Selected Accounts</p>
                    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {selectedView.selectedAccountIds.map((accountId) => (
                        <p key={accountId}>{accountMap.get(accountId) ?? accountId}</p>
                      ))}
                    </div>
                  </div>
                )}

                <Separator />

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Rule Chips</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedView.rules.senderDomains.map((domain) => (
                      <Badge key={`domain-${domain}`} variant="outline">
                        Domain:{domain}
                      </Badge>
                    ))}
                    {selectedView.rules.senderEmails.map((email) => (
                      <Badge key={`email-${email}`} variant="outline">
                        Sender:{email}
                      </Badge>
                    ))}
                    {selectedView.rules.keywords.map((keyword) => (
                      <Badge key={`keyword-${keyword}`} variant="outline">
                        Keyword:{keyword}
                      </Badge>
                    ))}
                    {selectedView.rules.unreadOnly && <Badge variant="secondary">UnreadOnly</Badge>}
                  </div>
                </div>

                <Separator />

                <p className="text-xs text-muted-foreground">
                  Highlight rules UI is coming in MP-PT08. Current count: 0 configurable in this hub.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "create"
                ? "Create View"
                : dialogMode === "edit"
                  ? "Edit View"
                  : "Duplicate View"}
            </DialogTitle>
            <DialogDescription>
              Configure account scope and saved rule chips for server-side view execution.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Name</p>
              <Input
                onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
                value={form.name}
              />
              {formErrors.name && <p className="text-xs text-destructive">{formErrors.name}</p>}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Icon</p>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) => setForm((previous) => ({ ...previous, icon: event.target.value }))}
                value={form.icon}
              >
                <option value="">None</option>
                {ICON_OPTIONS.map((icon) => (
                  <option key={icon} value={icon}>
                    {icon}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Priority</p>
              <Input
                max={5}
                min={1}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    priority: Math.min(5, Math.max(1, Number(event.target.value) || 1)),
                  }))
                }
                type="number"
                value={form.priority}
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Sort Order</p>
              <Input
                max={9999}
                min={0}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    sortOrder: Math.min(9999, Math.max(0, Number(event.target.value) || 0)),
                  }))
                }
                type="number"
                value={form.sortOrder}
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Scope</p>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={form.scopeType === "ALL"}
                  onChange={() => setForm((previous) => ({ ...previous, scopeType: "ALL" }))}
                  type="radio"
                />
                ALL
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={form.scopeType === "SELECTED"}
                  onChange={() => setForm((previous) => ({ ...previous, scopeType: "SELECTED" }))}
                  type="radio"
                />
                SELECTED
              </label>
            </div>
            {form.scopeType === "SELECTED" && (
              <div className="rounded-md border border-border p-2">
                {accountsError && <p className="text-xs text-destructive">{accountsError}</p>}
                {!accountsError && accounts.length === 0 && (
                  <p className="text-xs text-muted-foreground">No accounts available.</p>
                )}
                {!accountsError && accounts.length > 0 && (
                  <div className="space-y-1">
                    {accounts.map((account) => (
                      <label className="flex items-center gap-2 text-sm" key={account.id}>
                        <input
                          checked={form.selectedAccountIds.includes(account.id)}
                          onChange={(event) => {
                            setForm((previous) => ({
                              ...previous,
                              selectedAccountIds: event.target.checked
                                ? [...previous.selectedAccountIds, account.id]
                                : previous.selectedAccountIds.filter((id) => id !== account.id),
                            }));
                          }}
                          type="checkbox"
                        />
                        {account.email}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            {formErrors.scopeType && <p className="text-xs text-destructive">{formErrors.scopeType}</p>}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <TagInput
              label="Sender domains"
              onChange={(values) => setForm((previous) => ({ ...previous, senderDomains: values }))}
              placeholder="company.com"
              values={form.senderDomains}
            />
            <TagInput
              label="Sender emails"
              onChange={(values) => setForm((previous) => ({ ...previous, senderEmails: values }))}
              placeholder="boss@company.com"
              values={form.senderEmails}
            />
            <TagInput
              label="Keywords"
              onChange={(values) => setForm((previous) => ({ ...previous, keywords: values }))}
              placeholder="invoice"
              values={form.keywords}
            />
          </div>

          {(formErrors.senderDomains || formErrors.senderEmails || formErrors.keywords) && (
            <p className="text-xs text-destructive">
              {formErrors.senderDomains ?? formErrors.senderEmails ?? formErrors.keywords}
            </p>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              checked={form.unreadOnly}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  unreadOnly: event.target.checked,
                }))
              }
              type="checkbox"
            />
            Unread only
          </label>

          {actionError && <p className="text-sm text-destructive">{actionError}</p>}

          <DialogFooter>
            <Button
              onClick={() => setDialogOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isSaving} onClick={() => void handleSave()} type="button">
              {isSaving ? "Saving..." : "Save View"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
