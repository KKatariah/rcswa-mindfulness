import { useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import Modal from "@/components/main/Modal";
import GoogleSignIn from "@/components/main/GoogleSignIn";
import { FormActions, FormError, TextField } from "@/components/ui/form";
import { useAuth } from "@/context/AuthContext";
import type { AuthUser } from "@/types/user";
import { landingPathFor } from "@/components/main/ApprovalGate";
import { useFormSubmit } from "@/hooks/useFormSubmit";
import Button from "@/components/ui/Button";

type LoginModalProps = {
	isOpen: boolean;
	onClose: () => void;
};

const SUPPORT_EMAIL = "sarah.j.moore@rcswa.edu.au";

export default function LoginModal({ isOpen, onClose }: LoginModalProps) {
	const router = useRouter();
	const { login } = useAuth();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [view, setView] = useState<"login" | "forgot">("login");
	const { submitting, error, setError, run } = useFormSubmit("Login failed");

	function handleClose() {
		setView("login");
		setError(null);
		onClose();
	}

	async function finish(signedIn: AuthUser) {
		handleClose();
		await router.push(landingPathFor(signedIn));
	}

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		void run(async () => {
			await finish(await login(email, password));
		});
	}

	if (view === "forgot") {
		return (
			<Modal isOpen={isOpen} onClose={handleClose} title="Forgot password?">
				<div className="flex flex-col gap-6 text-center">
					<p className="text-md text-ink">
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
					<Button
						type="button"
						onClick={() => setView("login")}
						variant="dark" size="lg"
					>
						Back to log in
					</Button>
				</div>
			</Modal>
		);
	}

	return (
		<Modal isOpen={isOpen} onClose={handleClose} title="Log in">
			<form onSubmit={handleSubmit} className="flex flex-col gap-6">
				<FormError message={error} />
				<TextField
					id="login-email"
					label="Email"
					type="email"
					required
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					placeholder="you@example.com"
				/>
				<div className="flex flex-col gap-2">
					<TextField
						id="login-password"
						label="Password"
						type="password"
						required
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						placeholder="Enter your password"
					/>
					<button
						type="button"
						onClick={() => {
							setError(null);
							setView("forgot");
						}}
						className="w-fit text-sm font-semibold text-brand-blue hover:underline cursor-pointer"
					>
						Forgot password?
					</button>
				</div>
				<FormActions submitting={submitting} submitLabel="Login" busyLabel="Logging in..." className="" />
			</form>

			<GoogleSignIn
				onStart={() => setError(null)}
				onSignedIn={finish}
				onError={setError}
				failureMessage="Google login failed"
			/>
		</Modal>
	);
}
