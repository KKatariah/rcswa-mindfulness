import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { loginUser, registerUser, logoutUser } from "@/lib/api";

type AuthUser = { id: number; email: string; full_name: string };

type AuthContextValue = {
	user: AuthUser | null;
	isLoading: boolean;
	login: (email: string, password: string) => Promise<void>;
	register: (email: string, fullName: string, password: string) => Promise<void>;
	logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<AuthUser | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const storedUser = localStorage.getItem("user");
		if (storedUser) {
			setUser(JSON.parse(storedUser));
		}
		setIsLoading(false);
	}, []);

	async function login(email: string, password: string) {
		const data = await loginUser({ email, password });
		setUser(data.user);
		localStorage.setItem("user", JSON.stringify(data.user));
	}

	async function register(email: string, fullName: string, password: string) {
		await registerUser({ email, full_name: fullName, password });
	}

	async function logout() {
		await logoutUser();
		setUser(null);
		localStorage.removeItem("user");
	}

	return (
		<AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
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