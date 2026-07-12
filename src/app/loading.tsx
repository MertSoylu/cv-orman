"use client";

import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SceneLoadingIndicator from "@/components/SceneLoadingIndicator";
import { useT } from "@/lib/i18n/dict";

export default function Loading() {
  const t = useT();

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex flex-1 flex-col">
        <div className="container-wide pb-2 pt-8 sm:pt-10">
          <span className="eyebrow mb-3">{t("hero.badge")}</span>
          <h1 className="mb-2 font-display text-3xl font-semibold text-fg sm:text-4xl">{t("hero.title")}</h1>
        </div>
        <div className="container-wide flex flex-1 items-center justify-center py-20">
          <SceneLoadingIndicator />
        </div>
      </main>
      <Footer />
    </div>
  );
}
