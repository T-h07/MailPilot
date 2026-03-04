import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function InboxPage() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          This is the future command center for incoming messages, triage actions, and quick
          context. Mailbox list and preview will be implemented in the next milestone.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Search & Triage</CardTitle>
            <CardDescription>Global mailbox filtering controls will live here.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input disabled placeholder="Search sender, subject, snippet..." />
            <div className="flex gap-2">
              <Badge variant="secondary">Unread</Badge>
              <Badge variant="secondary">Attachments</Badge>
              <Badge variant="secondary">Followups</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Queue Snapshot</CardTitle>
            <CardDescription>Compact metrics for workload awareness.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-muted-foreground">Unread</p>
              <p className="pt-1 text-xl font-semibold">--</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-muted-foreground">Needs reply</p>
              <p className="pt-1 text-xl font-semibold">--</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
