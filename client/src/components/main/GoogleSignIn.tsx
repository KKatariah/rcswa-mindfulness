import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "@/context/AuthContext";
import { errorMessage } from "@/lib/errors";
import type { AuthUser } from "@/types/user";

/** "or" divider plus the Google button, shown under the log-in and sign-up forms. */
export default function GoogleSignIn({
	onStart,
	onSignedIn,
	onError,
	failureMessage,
}: {
	onStart: () => void;
	onSignedIn: (user: AuthUser) => Promise<void>;
	onError: (message: string) => void;
	failureMessage: string;
}) {
	const { loginWithGoogle } = useAuth();

	async function handleCredential(credential: string | undefined) {
		if (!credential) return;
		onStart();
		try {
			await onSignedIn(await loginWithGoogle(credential));
		} catch (err) {
			onError(errorMessage(err, failureMessage));
		}
	}

	return (
		<div className="mt-6 flex flex-col items-center gap-4">
			<div className="flex w-full items-center gap-3">
				<div className="h-px flex-1 bg-gray-200" />
				<span className="text-sm text-muted">or</span>
				<div className="h-px flex-1 bg-gray-200" />
			</div>
			{process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
				<GoogleLogin
					onSuccess={(response) => handleCredential(response.credential)}
					onError={() => onError(failureMessage)}
				/>
			)}
		</div>
	);
}
