import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type OnboardingPageProps = {
  onStartSetup: () => void;
};

export function OnboardingPage({ onStartSetup }: OnboardingPageProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-xl border-border bg-card">
        <CardHeader>
          <CardTitle className="text-2xl">Welcome to MailPilot</CardTitle>
          <CardDescription className="pt-1 text-sm text-muted-foreground">
            Setup wizard will guide you through connecting Gmail and creating your profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Onboarding wizard coming next (MP-PT17).</p>
          <Button onClick={onStartSetup}>Start setup</Button>
        </CardContent>
      </Card>
    </div>
  );
}
