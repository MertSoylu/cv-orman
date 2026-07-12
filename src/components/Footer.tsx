"use client";

import { useT } from "@/lib/i18n/dict";
import { MAIN_SITE_URL, SOCIAL_LINKS } from "@/lib/site";
import { IconGithub, IconLinkedin, IconTree } from "./icons";

export default function Footer() {
  const t = useT();
  const year = new Date().getFullYear();

  const pages = [
    { label: t("nav.about"), href: `${MAIN_SITE_URL}/#about` },
    { label: t("nav.projects"), href: `${MAIN_SITE_URL}/#projects` },
    { label: t("nav.contact"), href: `${MAIN_SITE_URL}/#contact` },
  ];

  return (
    <footer className="mt-auto border-t px-5 py-14" style={{ borderColor: "rgb(var(--line) / 0.1)" }}>
      <div className="container-wide">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-2.5">
              <span
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-accent"
                style={{ backgroundColor: "rgb(var(--accent-soft))" }}
              >
                <IconTree className="h-5 w-5" />
              </span>
              <h3 className="font-display text-2xl font-semibold text-fg">Mert Soylu</h3>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-muted">{t("footer.tagline")}</p>
          </div>

          <div>
            <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted">{t("footer.pages")}</h4>
            <ul className="space-y-2.5">
              {pages.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="link-underline text-sm font-medium text-muted transition-colors hover:text-fg">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted">{t("footer.connect")}</h4>
            <div className="flex gap-3">
              <a
                href={SOCIAL_LINKS.github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("nav.github")}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border bg-surface text-fg transition-colors hover:bg-surface-2"
                style={{ borderColor: "rgb(var(--line) / 0.12)" }}
              >
                <IconGithub className="h-5 w-5" />
              </a>
              <a
                href={SOCIAL_LINKS.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("nav.linkedin")}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border bg-surface text-fg transition-colors hover:bg-surface-2"
                style={{ borderColor: "rgb(var(--line) / 0.12)" }}
              >
                <IconLinkedin className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col justify-between gap-3 border-t pt-6 text-sm text-muted md:flex-row" style={{ borderColor: "rgb(var(--line) / 0.1)" }}>
          <p suppressHydrationWarning>© {year} Mert Soylu.</p>
          <p>{t("footer.builtWith")}</p>
        </div>
      </div>
    </footer>
  );
}
