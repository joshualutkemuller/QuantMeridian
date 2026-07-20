export function simFallbackEnabled(req: Request): boolean {
  return new URL(req.url).searchParams.get("sim") === "1";
}

export function snapshotFallbackEnabled(req: Request): boolean {
  return new URL(req.url).searchParams.get("snapshot") === "1";
}

export function unavailableSeries(id: string, observations: { date: string; value: number }[] = []) {
  return { id, observations, source: "ERR" as const };
}
