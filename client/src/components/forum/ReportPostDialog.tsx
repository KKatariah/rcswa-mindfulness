import { type FormEvent, useId, useState } from "react";
import Modal from "@/components/main/Modal";
import { FormActions, FormError, TextAreaField } from "@/components/ui/form";
import { errorMessage } from "@/lib/errors";

// Matches ForumFlag.reason's max_length in app/models.py.
const REASON_MAX_CHARS = 500;

/** Asks why a post is being reported (optional), then sends the report to the moderators. */
export default function ReportPostDialog({
  kind,
  onSubmit,
  onClose,
}: {
  kind: "thread" | "reply";
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Failed to send report"));
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={kind === "thread" ? "Report thread" : "Report reply"}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          A moderator will review it against the forum rules. The author won&apos;t be told who reported it.
        </p>
        <TextAreaField
          id={reasonId}
          label="What's the problem? (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={REASON_MAX_CHARS}
          placeholder="e.g. it's unkind, off-topic, or shares someone's private details"
        />
        <FormError message={error} />
        <FormActions submitting={submitting} submitLabel="Send report" busyLabel="Sending…" onCancel={onClose} />
      </form>
    </Modal>
  );
}
