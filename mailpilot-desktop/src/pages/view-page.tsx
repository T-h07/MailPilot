import { useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const viewDescriptions: Record<string, string> = {
  work: "Mail grouped by professional threads, clients, and internal execution loops.",
  linkedin: "Networking and opportunity-related conversations with social context.",
  gaming: "Community notifications and coordination threads for gaming channels.",
  marketing: "Campaign, growth, and outreach mail streams for brand work.",
};

function formatViewName(viewKey: string): string {
  return viewKey
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function ViewPage() {
  const { viewKey = "custom" } = useParams();
  const title = formatViewName(viewKey);
  const description =
    viewDescriptions[viewKey] ??
    "Custom saved view placeholder. Rule-based filtering will be linked to database-backed views.";

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title} View</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>View Rules</CardTitle>
            <CardDescription>Domain, sender, and keyword rules will be rendered here.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="secondary">DOMAIN</Badge>
            <Badge variant="secondary">SENDER_EMAIL</Badge>
            <Badge variant="secondary">KEYWORD</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Result Lane</CardTitle>
            <CardDescription>Messages matching this view will populate this area.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Placeholder cards will become real mailbox rows once backend queries are connected.
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
