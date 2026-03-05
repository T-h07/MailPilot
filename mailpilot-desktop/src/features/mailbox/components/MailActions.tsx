import { MoreVertical, Reply, ReplyAll, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type MailActionsProps = {
  isUnread: boolean;
  onRefreshMessage: () => void;
  isRefreshingMessage?: boolean;
  onPrimaryAction: (action: "reply" | "reply-all" | "forward") => void;
  onToggleRead: () => void;
  onExportMessagePdf: () => void;
  onExportThreadPdf: () => void;
  canExportThread: boolean;
  isExportingPdf?: boolean;
  onOpenInGmail: () => void;
};

export function MailActions({
  isUnread,
  onRefreshMessage,
  isRefreshingMessage = false,
  onPrimaryAction,
  onToggleRead,
  onExportMessagePdf,
  onExportThreadPdf,
  canExportThread,
  isExportingPdf = false,
  onOpenInGmail,
}: MailActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button className="gap-2" onClick={() => onPrimaryAction("reply")} size="sm" variant="outline">
        <Reply className="h-4 w-4" />
        Reply
      </Button>
      <Button
        className="gap-2"
        onClick={() => onPrimaryAction("reply-all")}
        size="sm"
        variant="outline"
      >
        <ReplyAll className="h-4 w-4" />
        Reply all
      </Button>
      <Button className="gap-2" onClick={() => onPrimaryAction("forward")} size="sm" variant="outline">
        <Send className="h-4 w-4" />
        Forward
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="outline">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="z-[60] border-border bg-popover text-popover-foreground shadow-md"
        >
          <DropdownMenuItem disabled={isRefreshingMessage} onClick={onRefreshMessage}>
            {isRefreshingMessage ? "Refreshing..." : "Refresh message"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onToggleRead}>
            {isUnread ? "Mark as read" : "Mark as unread"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={isExportingPdf} onClick={onExportMessagePdf}>
            {isExportingPdf ? "Exporting..." : "Export Email to PDF"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canExportThread || isExportingPdf} onClick={onExportThreadPdf}>
            Export Thread to PDF
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenInGmail}>
            Open in Gmail
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
