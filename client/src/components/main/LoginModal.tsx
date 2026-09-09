import { useState, type FormEvent } from "react";
import Modal from "@/components/main/Modal";
import { useAuth } from "@/context/AuthContext";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";

type LoginModalProps = {
	isOpen: boolean;
	onClose: () => void;
};

export default function LoginModal({ isOpen, onClose }: LoginModalProps) {
	const { login, loginWithGoogle } = useAuth();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError(null);
		setIsSubmitting(true);

		try {
			await login(email, password);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Login failed");
		} finally {
			setIsSubmitting(false);
		}
	}

	async function handleGoogleSuccess(credentialResponse: CredentialResponse) {
		if (!credentialResponse.credential) return;
		setError(null);
		try {
			await loginWithGoogle(credentialResponse.credential);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Google login failed");
		}
	}

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Log in">
			<form onSubmit={handleSubmit} className="flex flex-col gap-6">
				{error && (
					<p className="text-sm text-red-600" role="alert">
						{error}
					</p>
				)}

				<div className="flex flex-col gap-2">
					<label htmlFor="login-email" className="text-sm font-semibold text-ink">
						Email
					</label>
					<input
						id="login-email"
						type="email"
						required
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="you@example.com"
						className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue"
					/>
				</div>

				<div className="flex flex-col gap-2">
					<label htmlFor="login-password" className="text-sm font-semibold text-ink">
						Password
					</label>
					<input
						id="login-password"
						type="password"
						required
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						placeholder="Enter your password"
						className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue"
					/>
				</div>

				<button
					type="submit"
					disabled={isSubmitting}
					className="h-12 rounded-xl bg-brand-blue-dark text-[15px] font-bold text-white disabled:opacity-50"
				>
					{isSubmitting ? "Logging in..." : "Login"}
				</button>
			</form>

			<div className="mt-6 flex flex-col items-center gap-4">
				<div className="flex w-full items-center gap-3">
					<div className="h-px flex-1 bg-gray-200" />
					<span className="text-sm text-muted">or</span>
					<div className="h-px flex-1 bg-gray-200" />
				</div>
				<GoogleLogin
					onSuccess={handleGoogleSuccess}
					onError={() => setError("Google login failed")}
				/>
			</div>
		</Modal>
	);
}