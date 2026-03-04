import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function InsightsPage() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          This area will summarize response velocity, sender patterns, and followup health to help
          prioritize attention and reduce inbox drift.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Response Analytics</CardTitle>
            <CardDescription>Turnaround and completion trend placeholders.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Median response time: --</p>
            <Separator />
            <p>Messages closed this week: --</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workload Forecast</CardTitle>
            <CardDescription>Due and snoozed followups timeline.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Today due: --</p>
            <p>Overdue followups: --</p>
            <p>Snoozed waking in 24h: --</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
