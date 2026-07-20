import clsx from "clsx";
import {
  provenanceMeta,
  PROVENANCE_TONE_CLASS,
  classifyFreshness,
  FRESHNESS_TONE_CLASS,
} from "@/lib/provenance";
import { useSimMode } from "@/lib/simMode";

/**
 * Canonical data-provenance pill. Renders any source code (FRED, DB, FILE,
 * SNAPSHOT, ECON, SIM, …) with a consistent label, tone, dot, and tooltip
 * across every module. See `lib/provenance.ts` for the vocabulary.
 *
 * Pass `asOf` to append a freshness marker: nothing while the data is current,
 * an amber "Nd" once it is aging, and a red "STALE · Nd" once it is stale. This
 * is independent of the source tier, so a live-but-unrefreshed pipeline or an
 * old committed snapshot both read as stale rather than looking current.
 */
export function ProvenanceBadge({
  source,
  asOf,
  className,
}: {
  source: string;
  asOf?: string | null;
  className?: string;
}) {
  const { simEnabled, snapshotFallbackEnabled } = useSimMode();
  const effectiveSource =
    source === "SIM" && !simEnabled ? "ERR"
    : source === "SNAPSHOT" && !snapshotFallbackEnabled ? "ERR"
    : source;
  const meta = provenanceMeta(effectiveSource);
  const tone = PROVENANCE_TONE_CLASS[meta.tone];
  const fresh = asOf !== undefined ? classifyFreshness(asOf) : null;
  const stale = fresh && (fresh.status === "AGING" || fresh.status === "STALE") ? fresh : null;

  const pill = (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-3xs font-semibold uppercase tracking-wide",
        tone.pill,
        !stale && className
      )}
      title={meta.title}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", tone.dot)} />
      {meta.label}
    </span>
  );

  if (!stale) return pill;

  const freshTone = FRESHNESS_TONE_CLASS[stale.status as "AGING" | "STALE"];
  return (
    <span className={clsx("inline-flex items-center gap-1", className)}>
      {pill}
      <span
        className={clsx(
          "inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-3xs font-semibold uppercase tracking-wide",
          freshTone.pill
        )}
        title={stale.title}
      >
        <span className={clsx("h-1.5 w-1.5 rounded-full", freshTone.dot)} />
        {stale.label}
      </span>
    </span>
  );
}
