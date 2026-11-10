"use client";

import { useEffect, useState } from "react";
import { useDarkMode } from "@/context/DarkModeContext";
import { useT } from "@/lib/i18n/dict";
import { MAIN_SITE_URL, SOCIAL_LINKS } from "@/lib/site";
import { useLanguage } from "@/context/LanguageContext";
import { IconGithub, IconLinkedin, IconMoon, IconSun, IconTree } from "./icons";

function IconToggle({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="icon-block"
    >
      {children}
    </button>
  );
}

export default function Navbar() {
  const { isDark, toggleDarkMode } = useDarkMode();
  const { isTurkish, toggleLanguage } = useLanguage();
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { label: t("nav.about"), href: `${MAIN_SITE_URL}/#about` },
    { label: t("nav.projects"), href: `${MAIN_SITE_URL}/#projects` },
    { label: t("nav.contact"), href: `${MAIN_SITE_URL}/#contact` },
  ];

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 border-b bg-canvas/85 backdrop-blur-md" style={{ borderColor: "rgb(var(--line) / 0.1)" }}>
      <nav className="container-wide flex h-16 items-center justify-between gap-4">
        <a href={MAIN_SITE_URL} className="group flex items-center gap-2.5 py-1" aria-label={t("nav.home")}>
          <span
            className="inline-flex h-9 w-9 items-center justify-center text-accent transition-transform duration-200 group-hover:-translate-y-0.5"
            style={{ backgroundColor: "rgb(var(--accent-soft))" }}
          >
            <IconTree className="h-5 w-5" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-display text-base font-semibold tracking-tight text-fg">Mert Soylu</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">cv·orman</span>
          </span>
        </a>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="link-underline px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-fg">
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <a
            href={SOCIAL_LINKS.github}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("nav.github")}
            className="icon-block hidden sm:inline-flex"
          >
            <IconGithub className="h-4.5 w-4.5" />
          </a>
          <a
            href={SOCIAL_LINKS.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("nav.linkedin")}
            className="icon-block hidden sm:inline-flex"
          >
            <IconLinkedin className="h-4.5 w-4.5" />
          </a>

          <IconToggle onClick={toggleDarkMode} label={isDark ? t("nav.toggleToLight") : t("nav.toggleToDark")}>
            {isDark ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
          </IconToggle>

          <IconToggle onClick={toggleLanguage} label={isTurkish ? t("nav.toggleToEnglish") : t("nav.toggleToTurkish")}>
            <span className="text-[11px] font-bold">{isTurkish ? "TR" : "EN"}</span>
          </IconToggle>

          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? t("nav.closeMenu") : t("nav.menu")}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            className="icon-block md:hidden"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              {menuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div
          id="mobile-menu"
          className="border-b bg-canvas/95 backdrop-blur-md md:hidden"
          style={{ borderColor: "rgb(var(--line) / 0.1)" }}
        >
          <div className="container-wide flex flex-col gap-1 py-4">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                {link.label}
              </a>
            ))}
            <div className="flex gap-3 px-3 pt-3">
              <a
                href={SOCIAL_LINKS.github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("nav.github")}
                onClick={() => setMenuOpen(false)}
                className="icon-block"
              >
                <IconGithub className="h-5 w-5" />
              </a>
              <a
                href={SOCIAL_LINKS.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("nav.linkedin")}
                onClick={() => setMenuOpen(false)}
                className="icon-block"
              >
                <IconLinkedin className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}