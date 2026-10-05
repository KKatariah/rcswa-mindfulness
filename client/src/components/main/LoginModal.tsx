import { useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import Modal from "@/components/main/Modal";
import GoogleSignIn from "@/components/main/GoogleSignIn";
import { FormActions, FormError, TextField } from "@/components/ui/form";
import { useAuth } from "@/context/AuthContext";
import { useFormSubmit } from "@/hooks/useFormSubmit";

type LoginModalProps = {
	isOpen: boolean;
	onClose: () => void;
};

export default function LoginModal({ isOpen, onClose }: LoginModalProps) {
	const router = useRouter();
	const { login } = useAuth();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const { submitting, error, setError, run } = useFormSubmit("Login failed");

	async function finish() {
		onClose();
		await router.push("/modules");
	}

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		void run(async () => {
			await login(email, password);
			await finish();
		});
	}

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Log in">
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
				<TextField
					id="login-password"
					label="Password"
					type="password"
					required
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					placeholder="Enter your password"
				/>
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
