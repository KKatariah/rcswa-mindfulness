import { useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import Modal from "@/components/main/Modal";
import { useAuth } from "@/context/AuthContext";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";

type LoginModalProps = {
	isOpen: boolean;
	onClose: () => void;
};

const SUPPORT_EMAIL = "sarah.j.moore@rcswa.edu.au";

export default function LoginModal({ isOpen, onClose }: LoginModalProps) {
	const router = useRouter();
	const { login, loginWithGoogle } = useAuth();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [view, setView] = useState<"login" | "forgot">("login");

	function handleClose() {
		setView("login");
		setError(null);
		onClose();
	}

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError(null);
		setIsSubmitting(true);

		try {
			await login(email, password);
			handleClose();
			await router.push("/modules");
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
			handleClose();
			await router.push("/modules");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Google login failed");
		}
	}

	if (view === "forgot") {
		return (
			<Modal isOpen={isOpen} onClose={handleClose} title="Forgot password?">
				<div className="flex flex-col gap-6 text-center">
					<p className="text-[15px] text-ink">
						Email Sarah to get a temporary password.
						{" "}
						<a
							href={`mailto:${SUPPORT_EMAIL}?subject=Temporary%20password%20request`}
							className="font-semibold text-brand-blue hover:underline"
						>
							{SUPPORT_EMAIL}
						</a>
					</p>
					<p className="text-sm text-muted">
						Once you log in with the temporary password, change it from your Profile page.
					</p>
					<button
						type="button"
						onClick={() => setView("login")}
						className="h-12 rounded-xl bg-brand-blue-dark text-[15px] font-bold text-white"
					>
						Back to log in
					</button>
				</div>
			</Modal>
		);
	}

	return (
		<Modal isOpen={isOpen} onClose={handleClose} title="Log in">
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
					<button
						type="button"
						onClick={() => {
							setError(null);
							setView("forgot");
						}}
						className="w-fit text-sm font-semibold text-brand-blue hover:underline"
					>
						Forgot password?
					</button>
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
				{process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && <GoogleLogin
					onSuccess={handleGoogleSuccess}
					onError={() => setError("Google login failed")}
				/>}
			</div>
		</Modal>
	);
}
