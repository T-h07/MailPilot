import { useOutletContext } from "react-router-dom";
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AppOutletContext } from "@/App";
import { getApiHealth, resolveApiBase } from "@/lib/api/client";

export function SettingsPage() {
  const { themeMode, setThemeMode } = useOutletContext<AppOutletContext>();
  const nextTheme = themeMode === "dark" ? "light" : "dark";
  const modeLabel = themeMode === "dark" ? "Dark" : "Light";
  const nextThemeLabel = nextTheme === "dark" ? "Dark" : "Light";
  const apiBase = useMemo(() => resolveApiBase(), []);
  const [healthStatus, setHealthStatus] = useState<string>("Unknown");
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  const handleTestConnection = async () => {
    setIsCheckingHealth(true);
    try {
      const health = await getApiHealth();
      setHealthStatus(`${health.status.toUpperCase()} · ${health.time}`);
    } catch (error) {
      if (error instanceof Error) {
        setHealthStatus(`Error · ${error.message}`);
      } else {
        setHealthStatus("Error · Connection failed");
      }
    } finally {
      setIsCheckingHealth(false);
    }
  };

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
          <Badge variant="secondary">Current mode: {modeLabel}</Badge>
          <Button onClick={() => setThemeMode(nextTheme)}>
            Switch to {nextThemeLabel}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>System</CardTitle>
          <CardDescription>Connection and update controls for local development.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Backend endpoint: {apiBase}</p>
          <p>Sync scheduler: Disabled</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={isCheckingHealth}
              onClick={handleTestConnection}
              size="sm"
              variant="outline"
            >
              {isCheckingHealth ? "Testing..." : "Test connection"}
            </Button>
            <Badge variant="secondary">{healthStatus}</Badge>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
