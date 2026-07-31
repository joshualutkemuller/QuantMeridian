/**
 * FOMC probability engine: reads gold.fomc_probability and gold.fomc_meeting_path,
 * builds FomcMeeting[] and implied policy path from the Gold tables.
 *
 * Replaces the macro_data_etl snapshot (etlMacro.ts fomcFromEtl / impliedPathFromEtl).
 */

import { GoldStore } from "./goldStore";
import type { FomcMeeting } from "@/data/econRates";

interface GoldFomcProbability {
  meeting_date: string;
  target_lower_bps: number | null;
  target_upper_bps: number | null;
  outcome_bps: number | null; // single outcome (distribution is embedded elsewhere if needed)
  probability: number;
  model_vintage: string;
  n_inputs: number;
}

interface GoldFomcPath {
  meeting_date: string;
  implied_rate: number;
  implied_move_bps: number;
  cumulative_move_bps: number;
  model_vintage: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function daysFromToday(meetingDate: string, today = new Date().toISOString().split("T")[0]): number {
  const ms = Date.parse(meetingDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z");
  return Math.round(ms / 86400000);
}

function labelFor(meetingDate: string): string {
  const [y, m] = meetingDate.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * Build FomcMeeting[] from gold.fomc_probability and gold.fomc_meeting_path.
 *
 * Gold stores a single outcome per meeting in fomc_probability.outcome_bps; the
 * terminal's FomcMeeting shape expects an outcomes array (move, prob pairs).
 * For now, emit a single-point distribution: the most likely move with 100%
 * probability, or a balanced distribution if outcome_bps is null.
 *
 * Returns null if Gold has no FOMC data (empty tables).
 */
export async function buildFomcFromGold(
  store: GoldStore,
  spotEffectiveRate?: number,
): Promise<{ meetings: FomcMeeting[]; path: { label: string; rate: number }[] } | null> {
  const [probs, paths] = await Promise.all([
    store.latest<GoldFomcProbability>("fomc_probability"),
    store.latest<GoldFomcPath>("fomc_meeting_path"),
  ]);

  if (!probs.length || !paths.length) return null;

  // Sort by meeting date
  probs.sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
  paths.sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));

  // Build a meeting -> implied_rate map from paths
  const pathMap = new Map(paths.map((p) => [p.meeting_date, p]));

  // Compute target from the first probability row (constant across meetings)
  const firstProb = probs[0];
  const targetLow =
    firstProb.target_lower_bps != null ? firstProb.target_lower_bps / 100 : 4.0;
  const targetHigh = firstProb.target_upper_bps != null ? firstProb.target_upper_bps / 100 : 4.25;

  // Build meetings from probability rows, grouped by meeting_date
  const meetingsByDate = new Map<string, GoldFomcProbability[]>();
  for (const prob of probs) {
    if (!meetingsByDate.has(prob.meeting_date)) {
      meetingsByDate.set(prob.meeting_date, []);
    }
    meetingsByDate.get(prob.meeting_date)!.push(prob);
  }

  const meetings: FomcMeeting[] = [];
  for (const [meetingDate, meetingProbs] of meetingsByDate) {
    const path = pathMap.get(meetingDate);
    if (!path) continue; // Skip if no path row

    // Group outcomes by move bps (sum probabilities for the same move)
    const moveProbs = new Map<number, number>();
    for (const prob of meetingProbs) {
      if (prob.outcome_bps != null) {
        const move = prob.outcome_bps;
        moveProbs.set(move, (moveProbs.get(move) ?? 0) + prob.probability);
      }
    }

    // If no measured outcomes, emit a balanced distribution
    const outcomes: { move: number; prob: number }[] = Array.from(moveProbs, ([move, prob]) => ({
      move,
      prob: Number(prob.toFixed(4)),
    }));

    if (outcomes.length === 0) {
      // Fallback: no specific outcomes measured, emit a neutral distribution
      outcomes.push({ move: -25, prob: 0.25 });
      outcomes.push({ move: 0, prob: 0.5 });
      outcomes.push({ move: 25, prob: 0.25 });
    }

    // Determine most likely outcome
    const ml = outcomes.reduce((a, b) => (b.prob > a.prob ? b : a), outcomes[0]);
    const mostLikely =
      ml.move === 0 ? "Hold" : ml.move < 0 ? `${Math.abs(ml.move)}bp Cut` : `${ml.move}bp Hike`;

    meetings.push({
      date: meetingDate,
      label: labelFor(meetingDate),
      daysOut: daysFromToday(meetingDate),
      outcomes,
      impliedRate: path.implied_rate,
      mostLikely,
    });
  }

  // Build path: prepend "Now" with the spot rate or target mid
  const nowRate =
    spotEffectiveRate != null
      ? spotEffectiveRate / 100 // Gold stores bps, terminal uses percent
      : (targetLow + targetHigh) / 2;

  const path = [{ label: "Now", rate: nowRate }];
  for (const p of paths) {
    path.push({ label: labelFor(p.meeting_date), rate: p.implied_rate });
  }

  return { meetings, path };
}
