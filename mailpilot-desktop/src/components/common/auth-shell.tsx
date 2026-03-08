import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type AuthShellProps = {
  badge?: string;
  title: string;
  description: string;
  highlights?: string[];
  children: ReactNode;
  footer?: ReactNode;
  cardClassName?: string;
};

export function AuthShell({
  badge = "MailPilot",
  title,
  description,
  highlights = [
    "Local password only unlocks this desktop app",
    "Runtime files stay under %LOCALAPPDATA%\\MailPilot",
    "Recovery uses your primary connected Gmail account",
  ],
  children,
  footer,
  cardClassName,
}: AuthShellProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-[360px] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_46%),radial-gradient(circle_at_top_right,_rgba(234,179,8,0.12),_transparent_34%)]" />
        <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <div className="relative grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,520px)]">
        <section className="hidden rounded-[28px] border border-border/70 bg-card/70 p-8 shadow-sm backdrop-blur lg:flex lg:flex-col lg:justify-between">
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <img
                alt="MailPilot"
                className="h-12 w-12 rounded-2xl border border-border object-cover shadow-sm"
                src="/mailpilot-icon.png"
              />
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-300">
                  {badge}
                </p>
                <p className="pt-1 text-3xl font-semibold tracking-tight">Inbox cockpit</p>
              </div>
            </div>
            <div>
              <p className="text-4xl font-semibold leading-tight tracking-tight">{title}</p>
              <p className="max-w-xl pt-3 text-base text-muted-foreground">{description}</p>
            </div>
          </div>

          <div className="space-y-3">
            {highlights.map((highlight) => (
              <div
                className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/65 px-4 py-3"
                key={highlight}
              >
                <div className="mt-0.5 rounded-full bg-emerald-500/15 p-1.5 text-emerald-300">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <p className="text-sm text-muted-foreground">{highlight}</p>
              </div>
            ))}
          </div>
        </section>

        <Card className={cn("border-border/80 bg-card/95 shadow-xl backdrop-blur", cardClassName)}>
          <CardHeader className="space-y-3 pb-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-sky-300 lg:hidden">
              <img
                alt="MailPilot"
                className="h-8 w-8 rounded-xl border border-border object-cover shadow-sm"
                src="/mailpilot-icon.png"
              />
              {badge}
            </div>
            <CardTitle className="text-2xl tracking-tight">{title}</CardTitle>
            <CardDescription className="max-w-md text-sm leading-6">{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {children}
            {footer ? <div className="border-t border-border/70 pt-4">{footer}</div> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
