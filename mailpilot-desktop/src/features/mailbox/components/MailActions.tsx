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
  onPrimaryAction: (action: "reply" | "reply-all" | "forward") => void;
  onToggleRead: () => void;
  onSecondaryAction: (action: "export-pdf" | "download-attachments" | "open-gmail") => void;
};

export function MailActions({
  isUnread,
  onPrimaryAction,
  onToggleRead,
  onSecondaryAction,
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
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onToggleRead}>
            {isUnread ? "Mark as read" : "Mark as unread"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onSecondaryAction("export-pdf")}>
            Export PDF (placeholder)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSecondaryAction("download-attachments")}>
            Download attachments (placeholder)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSecondaryAction("open-gmail")}>
            Open in Gmail (placeholder)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
