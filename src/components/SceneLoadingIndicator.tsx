"use client";

import { useT } from "@/lib/i18n/dict";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

export default function SceneLoadingIndicator() {
  const t = useT();
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
      {reducedMotion ? (
        <div
          className="h-10 w-10 rounded-full border-2"
          style={{ borderTopColor: "rgb(var(--accent))", borderRightColor: "rgb(var(--accent))", borderColor: "rgb(var(--line) / 0.15)" }}
        />
      ) : (
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-transparent"
          style={{ borderTopColor: "rgb(var(--accent))", borderRightColor: "rgb(var(--accent))" }}
        />
      )}
      <p className="text-sm text-muted">{t("state.loading.title")}</p>
      <p className="text-xs text-muted/70">{t("state.loading.body")}</p>
    </div>
  );
}
