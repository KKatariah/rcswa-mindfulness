import { useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import Modal from "@/components/main/Modal";
import GoogleSignIn from "@/components/main/GoogleSignIn";
import { FormActions, FormError, TextField } from "@/components/ui/form";
import { useAuth } from "@/context/AuthContext";
import { useFormSubmit } from "@/hooks/useFormSubmit";

type SignUpModalProps = {
	isOpen: boolean;
	onClose: () => void;
};

// Cleans up a full name 
function formatFullName(value: string) {
	return value
		.trim()
		.replace(/\s+/g, " ")
		.split(" ")
		.map((word) =>
			word.length === 0 ? word : word[0].toUpperCase() + word.slice(1).toLowerCase(),
		)
		.join(" ");
}

export default function SignUpModal({ isOpen, onClose }: SignUpModalProps) {
	const router = useRouter();
	const { register } = useAuth();
	const [email, setEmail] = useState("");
	const [fullName, setFullName] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const { submitting, error, setError, run } = useFormSubmit("Registration failed");

	async function finish() {
		onClose();
		await router.push("/modules");
	}

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError(null);

		if (password !== confirmPassword) {
			setError("Passwords do not match.");
			return;
		}

		const cleanedFullName = formatFullName(fullName);
		setFullName(cleanedFullName);

		void run(async () => {
			await register(email, cleanedFullName, password);
			await finish();
		});
	}

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Sign up">
			<form onSubmit={handleSubmit} className="flex flex-col gap-6">
				<FormError message={error} />
				<TextField
					id="signup-email"
					label="Email"
					type="email"
					required
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					placeholder="email@example.com"
				/>
				<TextField
					id="signup-fullname"
					label="Full name"
					type="text"
					required
					value={fullName}
					onChange={(event) => setFullName(event.target.value)}
					onBlur={() => setFullName((prev) => formatFullName(prev))}
					placeholder="Enter your full name"
				/>
				<TextField
					id="signup-password"
					label="Password"
					type="password"
					required
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					placeholder="Enter password"
				/>
				<TextField
					id="signup-confirm-password"
					label="Confirm Password"
					type="password"
					required
					value={confirmPassword}
					onChange={(event) => setConfirmPassword(event.target.value)}
					placeholder="Confirm password"
				/>
				<FormActions submitting={submitting} submitLabel="Sign up" busyLabel="Signing up..." className="" />
			</form>

			<GoogleSignIn
				onStart={() => setError(null)}
				onSignedIn={finish}
				onError={setError}
				failureMessage="Google sign up failed"
			/>
		</Modal>
	);
}
