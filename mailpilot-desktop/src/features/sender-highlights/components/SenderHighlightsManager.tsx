import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  createSenderRule,
  deleteSenderRule,
  listSenderRules,
  updateSenderRule,
  type SenderRuleMatchType,
  type SenderRuleRecord,
  type SenderRuleUpsertPayload,
} from "@/lib/api/sender-rules";
import { ApiClientError } from "@/lib/api/client";
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

const EMPTY_RULE_FORM: RuleForm = {
  matchType: "EMAIL",
  matchValue: "",
  label: "BOSS",
  accent: "gold",
};

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

export function SenderHighlightsManager() {
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
    void loadSenderRules();
  }, [loadSenderRules]);

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
    const validationErrors = validateRuleForm(ruleForm);
    setRuleFormErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setIsSavingRule(true);
    setRuleActionError(null);
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
    const confirmed = window.confirm(`Delete rule "${rule.matchType}:${rule.matchValue}"?`);
    if (!confirmed) {
      return;
    }

    setDeletingRuleId(rule.id);
    setRuleActionError(null);
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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Sender Highlights</CardTitle>
            <CardDescription>
              Global sender rules. Exact EMAIL matches override DOMAIN rules.
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
                      onClick={() => {
                        void handleDeleteRule(rule);
                      }}
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
    </Card>
  );
}
