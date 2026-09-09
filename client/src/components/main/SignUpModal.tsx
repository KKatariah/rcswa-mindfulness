import { useState, type FormEvent } from "react";
import Modal from "@/components/main/Modal";
import { useAuth } from "@/context/AuthContext";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";

type SignUpModalProps = {
	isOpen: boolean;
	onClose: () => void;
};

export default function SignUpModal({ isOpen, onClose }: SignUpModalProps) {
	const { register, loginWithGoogle } = useAuth();
	const [email, setEmail] = useState("");
	const [fullName, setFullName] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError(null);

		if (password !== confirmPassword) {
			setError("Passwords do not match.");
			return;
		}

		setIsSubmitting(true);
		try {
			await register(email, fullName, password);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Registration failed");
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
			setError(err instanceof Error ? err.message : "Google sign up failed");
		}
	}

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Sign up">
			<form onSubmit={handleSubmit} className="flex flex-col gap-6">
				{error && (
					<p className="text-sm text-red-600" role="alert">
						{error}
					</p>
				)}

				<div className="flex flex-col gap-2">
					<label htmlFor="signup-email" className="text-sm font-semibold text-ink">
						Email
					</label>
					<input
						id="signup-email"
						type="email"
						required
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="email@example.com"
						className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue"
					/>
				</div>

				<div className="flex flex-col gap-2">
					<label htmlFor="signup-fullname" className="text-sm font-semibold text-ink">
						Full name
					</label>
					<input
						id="signup-fullname"
						type="text"
						required
						value={fullName}
						onChange={(event) => setFullName(event.target.value)}
						placeholder="Enter your full name"
						className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue"
					/>
				</div>

				<div className="flex flex-col gap-2">
					<label htmlFor="signup-password" className="text-sm font-semibold text-ink">
						Password
					</label>
					<input
						id="signup-password"
						type="password"
						required
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						placeholder="Enter password"
						className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue"
					/>
				</div>

				<div className="flex flex-col gap-2">
					<label htmlFor="signup-confirm-password" className="text-sm font-semibold text-ink">
						Confirm Password
					</label>
					<input
						id="signup-confirm-password"
						type="password"
						required
						value={confirmPassword}
						onChange={(event) => setConfirmPassword(event.target.value)}
						placeholder="Confirm password"
						className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue"
					/>
				</div>

				<button
					type="submit"
					disabled={isSubmitting}
					className="h-12 rounded-xl bg-brand-blue-dark text-[15px] font-bold text-white disabled:opacity-50"
				>
					{isSubmitting ? "Signing up..." : "Sign up"}
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
					onError={() => setError("Google sign up failed")}
				/>
			</div>
		</Modal>
	);
}