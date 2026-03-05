import { useCallback, useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { openUrl } from "@tauri-apps/plugin-opener";

type EmailHtmlViewProps = {
  html: string;
  isDark: boolean;
};

type EmailPalette = {
  background: string;
  foreground: string;
  muted: string;
  border: string;
  link: string;
};

function toThemeColor(token: string, fallback: string): string {
  if (!token) {
    return fallback;
  }
  return `hsl(${token})`;
}

function resolvePalette(isDark: boolean): EmailPalette {
  if (typeof window === "undefined") {
    return {
      background: isDark ? "#0f172a" : "#ffffff",
      foreground: isDark ? "#f8fafc" : "#111827",
      muted: isDark ? "#94a3b8" : "#4b5563",
      border: isDark ? "#1e293b" : "#dbe3ee",
      link: isDark ? "#93c5fd" : "#1d4ed8",
    };
  }

  const style = window.getComputedStyle(window.document.documentElement);
  const backgroundToken = style.getPropertyValue("--background").trim();
  const foregroundToken = style.getPropertyValue("--foreground").trim();
  const mutedToken = style.getPropertyValue("--muted-foreground").trim();
  const borderToken = style.getPropertyValue("--border").trim();
  const primaryToken = style.getPropertyValue("--primary").trim();

  return {
    background: toThemeColor(backgroundToken, isDark ? "#0f172a" : "#ffffff"),
    foreground: toThemeColor(foregroundToken, isDark ? "#f8fafc" : "#111827"),
    muted: toThemeColor(mutedToken, isDark ? "#94a3b8" : "#4b5563"),
    border: toThemeColor(borderToken, isDark ? "#1e293b" : "#dbe3ee"),
    link: toThemeColor(primaryToken, isDark ? "#93c5fd" : "#1d4ed8"),
  };
}

function buildSrcDoc(content: string, palette: EmailPalette): string {
  const baseCss = `
    :root {
      color-scheme: light dark;
    }
    * {
      box-sizing: border-box;
      max-width: 100%;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: ${palette.background};
      color: ${palette.foreground};
      font-family: "Segoe UI Variable", "Inter", "Segoe UI", sans-serif;
      line-height: 1.45;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    body {
      padding: 14px;
    }
    a {
      color: ${palette.link};
    }
    hr {
      border: 0;
      border-top: 1px solid ${palette.border};
    }
    blockquote {
      margin: 0.5rem 0;
      padding-left: 0.75rem;
      border-left: 2px solid ${palette.border};
      color: ${palette.muted};
    }
    pre, code {
      white-space: pre-wrap;
      word-break: break-word;
    }
    table {
      border-collapse: collapse;
    }
    img, iframe, video {
      height: auto;
      max-width: 100%;
    }
  `;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <base target="_blank" />
    <style>${baseCss}</style>
  </head>
  <body>${content}</body>
</html>`;
}

export function EmailHtmlView({ html, isDark }: EmailHtmlViewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const clickCleanupRef = useRef<(() => void) | null>(null);
  const palette = useMemo(() => resolvePalette(isDark), [isDark]);
  const sanitizedHtml = useMemo(
    () => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }),
    [html],
  );
  const srcDoc = useMemo(() => buildSrcDoc(sanitizedHtml, palette), [palette, sanitizedHtml]);

  const attachLinkHandler = useCallback(() => {
    clickCleanupRef.current?.();
    clickCleanupRef.current = null;

    const frame = iframeRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) {
      return;
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      const rawHref = anchor.getAttribute("href")?.trim();
      if (!rawHref || rawHref.startsWith("#")) {
        return;
      }

      event.preventDefault();
      try {
        const resolvedHref = new URL(rawHref, anchor.baseURI).toString();
        void openUrl(resolvedHref);
      } catch {
        // Ignore invalid URLs in malformed emails.
      }
    };

    doc.addEventListener("click", onClick);
    clickCleanupRef.current = () => {
      doc.removeEventListener("click", onClick);
    };
  }, []);

  useEffect(() => {
    return () => {
      clickCleanupRef.current?.();
      clickCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    clickCleanupRef.current?.();
    clickCleanupRef.current = null;
  }, [srcDoc]);

  return (
    <iframe
      className="h-full w-full border-0"
      onLoad={attachLinkHandler}
      ref={iframeRef}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      title="Email HTML body"
    />
  );
}
