// The numbers the card's sentences name ({outside}, {rank}, ...), reported by the figures as their
// data arrives. The page holds them (how-page.tsx); a figure reports through the context; a dash
// stands in until a number is known, so a sentence never shows its braces.
import { createContext, useCallback, useContext, useState } from "react";

export type HowFacts = Record<string, string | number>;

/** Every placeholder of the section words, with the page's fixed facts filled in. */
export const HOW_FACTS_PENDING: HowFacts = {
  group: 4009, block: 4009,
  outside: "—", prefix: "—", rank: "—", patches: "—", pictures: "—", level: "—", explained: "—", pass1: "—", pass3: "—", update: "—", wins: "—",
};

const ReportContext = createContext<(facts: HowFacts) => void>(() => {});
export const HowFactsReporter = ReportContext.Provider;

/** The page's facts and the function the figures report with. */
export function useHowFactsState(): { facts: HowFacts; report: (facts: HowFacts) => void } {
  const [facts, setFacts] = useState<HowFacts>(HOW_FACTS_PENDING);
  const report = useCallback((known: HowFacts) => {
    setFacts((previous) => {
      const changed = Object.entries(known).some(([key, value]) => previous[key] !== value);
      return changed ? { ...previous, ...known } : previous;
    });
  }, []);
  return { facts, report };
}

/** In a figure: report the numbers it has computed. */
export function useReportFacts(): (facts: HowFacts) => void {
  return useContext(ReportContext);
}
