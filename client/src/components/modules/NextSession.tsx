import { CalendarIcon } from "@/components/ui/icons";

type NextSessionProps = {
  moduleTitle: string;
  compactOnMobile?: boolean;
  /** ISO 8601 date, or timestamp including the session's timezone offset. */
  startsAt?: string;
  /** Display labels supplied by the page in the intended timezone. timeLabel is omitted for date-only sessions. */
  dateLabel?: string;
  timeLabel?: string;
};

export default function NextSession({
  moduleTitle,
  compactOnMobile = false,
  startsAt,
  dateLabel,
  timeLabel,
}: NextSessionProps) {
  return (
    <section className={`w-full min-w-0 rounded-xl border border-gray-200 bg-white p-5 text-ink shadow-card ${compactOnMobile ? "grid grid-cols-2 items-center gap-x-3 md:block" : ""}`}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-blue text-white">
          <CalendarIcon className="size-5" aria-hidden="true" />
        </span>
        <h2 className="text-base font-extrabold leading-6">Next Session</h2>
      </div>

      <div>
      <p className={`${compactOnMobile ? "md:mt-2.5" : "mt-2.5"} break-words text-sm font-semibold leading-5`}>
        {moduleTitle}
      </p>
      {startsAt && dateLabel ? <time dateTime={startsAt} className="mt-1 block text-sm leading-5 text-muted">
        {dateLabel}
        {timeLabel && <>
          {" "}<span aria-hidden="true">•</span><span className="sr-only"> at </span>{" "}
          <span className="whitespace-nowrap">{timeLabel}</span>
        </>}
      </time> : <p className="mt-1 text-sm text-muted">Available now · Continue module</p>}
      </div>
    </section>
  );
}
