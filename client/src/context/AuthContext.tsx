import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { loginUser, registerUser, logoutUser, loginWithGoogle as loginWithGoogleApi, getCurrentUser } from "@/lib/api";

type AuthUser = { id: number; email: string; full_name: string; display_name?: string; auth_provider?: string; cohort_start_date?: string | null };

type AuthContextValue = {
	user: AuthUser | null;
	isLoading: boolean;
	login: (email: string, password: string) => Promise<void>;
	register: (email: string, fullName: string, password: string) => Promise<void>;
	logout: () => Promise<void>;
	loginWithGoogle: (credential: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<AuthUser | null>(null);
	const [isLoading, setIsLoading] = useState(true);

		useEffect(() => {
		async function initAuth() {
			const token = localStorage.getItem("token");
			if (!token) {
				setIsLoading(false);
				return;
			}

			try {
				const storedUser = localStorage.getItem("user");
				if (storedUser) setUser(JSON.parse(storedUser));
			} catch {
				localStorage.removeItem("user");
			}

			try {
				const data = await getCurrentUser();
				setUser(data.user);
				localStorage.setItem("user", JSON.stringify(data.user));
			} catch {
				setUser(null);
				localStorage.removeItem("user");
				localStorage.removeItem("token");
			} finally {
				setIsLoading(false);
			}
		}

		initAuth();
	}, []);

	async function login(email: string, password: string) {
		const data = await loginUser({ email, password });
		setUser(data.user);
		localStorage.setItem("user", JSON.stringify(data.user));
	}

	async function register(email: string, fullName: string, password: string) {
		await registerUser({ email, full_name: fullName, password });
		await login(email, password);
	}

	async function logout() {
		try {
			await logoutUser();
		} finally {
			setUser(null);
			localStorage.removeItem("user");
			localStorage.removeItem("token");
		}
	}

	async function loginWithGoogle(credential: string) {
		const data = await loginWithGoogleApi(credential);
		setUser(data.user);
		localStorage.setItem("user", JSON.stringify(data.user));
	}

	return (
		<AuthContext.Provider value={{ user, isLoading, login, register, logout, loginWithGoogle }}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
