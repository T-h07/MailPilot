import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function FocusPage() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Focus</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Focus mode will surface high-priority items first: urgent senders, due followups, and
          low-noise execution queues for deep work sessions.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Priority Channels</CardTitle>
            <CardDescription>Your critical contexts will be pinned here.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge>Leadership</Badge>
            <Badge variant="secondary">Launches</Badge>
            <Badge variant="secondary">Customer escalations</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Attention Queue</CardTitle>
            <CardDescription>Sorted by urgency and response confidence.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Placeholder: top 10 messages requiring immediate action.</p>
            <p>Placeholder: due-followup and snooze wake-up timeline.</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
