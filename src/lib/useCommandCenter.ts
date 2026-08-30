import { useEffect, useState } from "react";
import { EMPTY_COMMAND_CENTER, type CommandCenterPayload, type CommandCenterSource } from "@/lib/commandCenter";
import { fetchJson, peekFresh } from "@/lib/fetchCache";

export type CommandCenterHookSource = CommandCenterSource | "LOADING";

const URL = "/api/command-center";

export function useCommandCenter(): { data: CommandCenterPayload; source: CommandCenterHookSource } {
  const cached = peekFresh<CommandCenterPayload>(URL);
  const [data, setData] = useState<CommandCenterPayload>(cached ?? EMPTY_COMMAND_CENTER);
  const [source, setSource] = useState<CommandCenterHookSource>(cached?.source ?? "LOADING");

  useEffect(() => {
    let alive = true;
    const seed = peekFresh<CommandCenterPayload>(URL);
    if (seed) {
      setData(seed);
      setSource(seed.source);
    } else {
      setSource("LOADING");
    }

    fetchJson<CommandCenterPayload>(URL)
      .then((json) => {
        if (!alive) return;
        setData(json);
        setSource(json.source);
      })
      .catch((err) => {
        if (!alive) return;
        setData({ ...EMPTY_COMMAND_CENTER, generatedAt: new Date().toISOString(), error: (err as Error).message });
        setSource("ERR");
      });

    return () => {
      alive = false;
    };
  }, []);

  return { data, source };
}
