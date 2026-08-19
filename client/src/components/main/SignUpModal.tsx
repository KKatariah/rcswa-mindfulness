import { useState, type FormEvent } from "react";
import Modal from "@/components/main/Modal";

type SignUpModalProps = {
	isOpen: boolean;
	onClose: () => void;
};

export default function SignUpModal({ isOpen, onClose }: SignUpModalProps) {
	const [email, setEmail] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
	}

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Sign up">
			<form onSubmit={handleSubmit} className="flex flex-col gap-6">
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
					<label htmlFor="signup-username" className="text-sm font-semibold text-ink">
						Username
					</label>
					<input
						id="signup-username"
						type="text"
						required
						value={username}
						onChange={(event) => setUsername(event.target.value)}
						placeholder="Enter username"
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
					className="h-12 rounded-xl bg-brand-blue-dark text-[15px] font-bold text-white"
				>
					Sign up
				</button>
			</form>
		</Modal>
	);
}
