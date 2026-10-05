import { useState } from "react";
import { errorMessage } from "@/lib/errors";

/** Submitting/error state for a form: `run` clears the error, awaits the action and shows any failure. */
export function useFormSubmit(errorFallback: string) {
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function run(action: () => Promise<void>) {
		setError(null);
		setSubmitting(true);
		try {
			await action();
		} catch (err) {
			setError(errorMessage(err, errorFallback));
		} finally {
			setSubmitting(false);
		}
	}

	return { submitting, error, setError, run };
}
