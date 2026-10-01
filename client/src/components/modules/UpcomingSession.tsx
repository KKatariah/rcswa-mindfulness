import { useEffect, useState } from "react";
import NextSession from "@/components/modules/NextSession";
import { listModules, type ApiModule } from "@/lib/api";

export default function UpcomingSession() {
    const [nextModule, setNextModule] = useState<ApiModule | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadNextSession() {
            const token = localStorage.getItem("token");
            if (!token) return;

            try {
                const modules = await listModules(token);
                const now = Date.now();

                const upcoming = modules
                    .filter(
                        (module) =>
                            module.is_published &&
                            module.unlock_at !== null &&
                            new Date(module.unlock_at).getTime() > now
                    )
                    .sort(
                        (a, b) =>
                            new Date(a.unlock_at!).getTime() -
                            new Date(b.unlock_at!).getTime()
                    )[0];

                if (!cancelled) {
                    setNextModule(upcoming ?? null);
                }
            } catch (error) {
                console.error("Failed to load next session:", error);
            }
        }

        loadNextSession();

        return () => {
            cancelled = true;
        };
    }, []);

    if (!nextModule?.unlock_at) return null;

    const date = new Date(nextModule.unlock_at);

    return (
        <NextSession
            moduleTitle={`Module Week ${nextModule.week_number}`}
            startsAt={nextModule.unlock_at}
            dateLabel={date.toLocaleDateString("en-AU", {
                timeZone: "Australia/Perth",
                weekday: "short",
                month: "short",
                day: "numeric",
            })}
            timeLabel={date.toLocaleTimeString("en-AU", {
                timeZone: "Australia/Perth",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
            })}
        />
    );
}