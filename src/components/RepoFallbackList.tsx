"use client";

import { useT } from "@/lib/i18n/dict";
import { useLanguage } from "@/context/LanguageContext";
import { HEALTH } from "@/lib/config";
import type { PlacedTreeData } from "@/lib/forest/treeData";

export interface RepoFallbackListProps {
  trees: PlacedTreeData[];
  /** Screen-reader/crawler-only (sr-only) vs. a visible fallback list (used when the 3D canvas fails to render). */
  visuallyHidden?: boolean;
}

/** DOM-real repo list -- the only way a11y tools, search crawlers, and no-JS/no-WebGL clients ever see the repo data, since the rest of the page is a 3D canvas. */
export default function RepoFallbackList({ trees, visuallyHidden = false }: RepoFallbackListProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = language === "tr" ? "tr-TR" : "en-US";

  return (
    <section aria-labelledby="repo-list-heading" className={visuallyHidden ? "sr-only" : "container-wide py-10"}>
      <h2 id="repo-list-heading" className={visuallyHidden ? undefined : "mb-4 font-display text-xl font-semibold text-fg"}>
        {t("a11y.repoListHeading")}
      </h2>
      <ul className={visuallyHidden ? undefined : "flex flex-col gap-3"}>
        {trees.map((tree) => {
          const healthLabel = tree.healthStage >= HEALTH.HEALTHY_STAGE_THRESHOLD ? t("legend.healthy") : t("legend.wilted");
          return (
            <li key={tree.id} className={visuallyHidden ? undefined : "card p-4"}>
              <a
                href={tree.url}
                target="_blank"
                rel="noopener noreferrer"
                className={visuallyHidden ? undefined : "font-display text-base font-semibold text-fg"}
              >
                {tree.name}
              </a>
              {tree.description && (
                <p className={visuallyHidden ? undefined : "mt-1 text-sm text-muted"}>{tree.description}</p>
              )}
              <p className={visuallyHidden ? undefined : "mt-1 text-xs text-muted"}>
                {tree.primaryLanguage ?? "—"} · {tree.stars.toLocaleString(locale)}★ · {tree.commitCount.toLocaleString(locale)} commits — {healthLabel}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
