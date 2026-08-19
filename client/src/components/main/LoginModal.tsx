import { useState, type FormEvent } from "react";
import Modal from "@/components/main/Modal";

type LoginModalProps = {
	isOpen: boolean;
	onClose: () => void;
};

export default function LoginModal({ isOpen, onClose }: LoginModalProps) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
	}

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Log in">
			<form onSubmit={handleSubmit} className="flex flex-col gap-6">
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
					className="h-12 rounded-xl bg-brand-blue-dark text-[15px] font-bold text-white"
				>
					Login
				</button>
			</form>
		</Modal>
	);
}
