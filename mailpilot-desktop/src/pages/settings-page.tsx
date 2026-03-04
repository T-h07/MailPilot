import { useOutletContext } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AppOutletContext } from "@/App";

export function SettingsPage() {
  const { themeMode, setThemeMode } = useOutletContext<AppOutletContext>();
  const nextTheme = themeMode === "dark" ? "light" : "dark";

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Application preferences and account controls will live here. For now this page includes
          a local theme toggle to validate token-driven styling.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>
            Persisted locally. This only affects desktop shell visuals for now.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary">Current: {themeMode}</Badge>
          <Button onClick={() => setThemeMode(nextTheme)}>
            Switch to {nextTheme}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>System</CardTitle>
          <CardDescription>Connection and update controls are placeholders.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Backend endpoint: Not configured</p>
          <p>Sync scheduler: Disabled</p>
        </CardContent>
      </Card>
    </section>
  );
}
