import { CheckCircle2, ChevronDown } from "lucide-react";
import type { AccountScope, MailAccount } from "@/features/mailbox/model/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AccountScopeDropdownProps = {
  accounts: MailAccount[];
  scope: AccountScope;
  onScopeChange: (scope: AccountScope) => void;
};

export function AccountScopeDropdown({
  accounts,
  scope,
  onScopeChange,
}: AccountScopeDropdownProps) {
  const scopeLabel =
    scope === "ALL"
      ? "All Accounts"
      : accounts.find((account) => account.id === scope)?.accountLabel ?? "Unknown account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="gap-2" variant="outline">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          {scopeLabel}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="z-[60] w-72 border border-border bg-popover text-popover-foreground shadow-md"
      >
        <DropdownMenuLabel>Account scope</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          onValueChange={(value) => onScopeChange(value)}
          value={scope}
        >
          <DropdownMenuRadioItem value="ALL">All Accounts</DropdownMenuRadioItem>
          {accounts.map((account) => (
            <DropdownMenuRadioItem key={account.id} value={account.id}>
              {account.accountLabel}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
