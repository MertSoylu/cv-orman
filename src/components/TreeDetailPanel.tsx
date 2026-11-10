"use client";

import { useEffect, useRef } from "react";
import type { PlacedTreeData } from "@/lib/forest/treeData";
import { useLanguage } from "@/context/LanguageContext";
import { useT } from "@/lib/i18n/dict";
import { HEALTH } from "@/lib/config";
import { IconExternal, IconX } from "./icons";
import SpeciesSprite from "./SpeciesSprite";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function formatDate(iso: string, lang: "tr" | "en"): string {
  return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function formatRelative(iso: string, lang: "tr" | "en"): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(lang === "tr" ? "tr-TR" : "en-US", { numeric: "auto" });
  return rtf.format(-days, "day");
}

// Same ramp the 3D foliage wilts through -- the health bar tier-matches the tree's color.
function healthBarColor(value: number): string {
  if (value >= HEALTH.HEALTHY_STAGE_THRESHOLD) return "#6fae4f";
  if (value >= HEALTH.WILTED_FLOOR + 0.15) return "#d9a441";
  return "#c8762b";
}

/** A meter in ten blocks rather than a smooth bar -- quantities here come in cubes. */
function Meter({
  label,
  value,
  barColor,
  lang,
}: {
  label: string;
  value: number;
  barColor: string;
  lang: "tr" | "en";
}) {
  const pct = Math.round(value * 100);
  const filled = Math.max(1, Math.round(value * 10));
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
        <span className="font-pixel text-sm font-semibold text-fg">{lang === "tr" ? `%${pct}` : `${pct}%`}</span>
      </div>
      <div className="flex gap-1" role="img" aria-label={`${label}: ${pct}%`}>
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className="h-3 flex-1"
            style={
              i < filled
                ? { backgroundColor: barColor, boxShadow: "inset -2px -2px 0 rgb(0 0 0 / 0.22)" }
                : { backgroundColor: "rgb(var(--surface-2))" }
            }
          />
        ))}
      </div>
    </div>
  );
}

export interface TreeDetailPanelProps {
  tree: PlacedTreeData | null;
  onClose: () => void;
}

export default function TreeDetailPanel({ tree, onClose }: TreeDetailPanelProps) {
  const { language } = useLanguage();
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!tree) return;
    previouslyFocused.current = document.activeElement as HTMLElement;
    closeButtonRef.current?.focus();

    const main = document.getElementById("main-content");
    const header = document.querySelector("header");
    const footer = document.querySelector("footer");
    if (main) main.inert = true;
    if (header) header.inert = true;
    if (footer) footer.inert = true;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (main) main.inert = false;
      if (header) header.inert = false;
      if (footer) footer.inert = false;
      previouslyFocused.current?.focus();
    };
  }, [tree, onClose]);

  if (!tree) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div
        className="absolute inset-0 bg-black/40 sm:bg-black/10"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClose(); } }}
        role="button"
        aria-label={t("panel.close")}
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tree-panel-title"
        aria-describedby="tree-panel-body"
        className="card relative flex h-full w-full max-w-sm flex-col overflow-y-auto p-6 sm:m-3 sm:h-[calc(100%-1.5rem)]"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={t("panel.close")}
          className="icon-block absolute right-4 top-4"
        >
          <IconX className="h-4 w-4" />
        </button>

        <div className="mb-4 flex items-center gap-3 pr-12">
          <span className="block-edge inline-flex bg-surface-2 p-2">
            <SpeciesSprite species={tree.species} size={42} />
          </span>
          <span className="leading-tight">
            <span className="eyebrow">{t("hover.repo")}</span>
            <span className="block text-sm text-muted">
              {t(`species.${tree.species}`)} · {tree.primaryLanguage ?? t("panel.noLanguage")}
            </span>
          </span>
        </div>
        <h2 id="tree-panel-title" className="mb-2 pr-10 font-display text-2xl font-semibold text-fg">
          {tree.name}
        </h2>
        <p id="tree-panel-body" className="mb-6 text-sm leading-relaxed text-muted">{tree.description || t("panel.noDescription")}</p>

        <div className="mb-6 flex flex-col gap-4">
          <Meter label={t("panel.growth")} value={tree.growthScore} barColor="rgb(var(--accent))" lang={language} />
          <Meter label={t("panel.health")} value={tree.healthStage} barColor={healthBarColor(tree.healthStage)} lang={language} />
        </div>

        <dl className="mb-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="mb-1 text-xs uppercase tracking-wide text-muted">{t("panel.stars")}</dt>
            <dd className="font-pixel text-xl font-semibold text-fg">{tree.stars.toLocaleString(language === "tr" ? "tr-TR" : "en-US")}</dd>
          </div>
          <div>
            <dt className="mb-1 text-xs uppercase tracking-wide text-muted">{t("panel.commits")}</dt>
            <dd className="font-pixel text-xl font-semibold text-fg">{tree.commitCount.toLocaleString(language === "tr" ? "tr-TR" : "en-US")}</dd>
          </div>
          <div>
            <dt className="mb-1 text-xs uppercase tracking-wide text-muted">{t("panel.created")}</dt>
            <dd className="text-fg">{formatDate(tree.createdAt, language)}</dd>
          </div>
          <div>
            <dt className="mb-1 text-xs uppercase tracking-wide text-muted">{t("panel.lastPush")}</dt>
            <dd className="text-fg">{formatRelative(tree.lastPushedAt, language)}</dd>
          </div>
        </dl>

        <a href={tree.url} target="_blank" rel="noopener noreferrer" className="btn-primary mt-auto">
          {t("panel.viewOnGithub")}
          <IconExternal className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}
