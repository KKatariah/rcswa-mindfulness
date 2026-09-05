const API_BASE_URL = "http://127.0.0.1:8000/api";

type LoginPayload = { email: string; password: string };
type RegisterPayload = { email: string; full_name: string; password: string };

type AuthUser = { id: number; email: string; full_name: string };
type AuthResponse = { message: string; token: string; user: AuthUser };

async function handleResponse<T>(res: Response): Promise<T> {
	const data = await res.json();
	if (!res.ok) {
		const message = typeof data === "object" && data !== null
			? Object.values(data).flat().join(" ")
			: "Something went wrong";
		throw new Error(message);
	}
	return data as T;
}

export async function loginUser(payload: LoginPayload): Promise<AuthResponse> {
	const res = await fetch(`${API_BASE_URL}/login/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	const data = await handleResponse<AuthResponse>(res);
	localStorage.setItem("token", data.token);
	return data;
}

export async function registerUser(payload: RegisterPayload): Promise<{ message: string; user: AuthUser }> {
	const res = await fetch(`${API_BASE_URL}/register/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	return handleResponse<{ message: string; user: AuthUser }>(res);
}

export async function logoutUser(): Promise<void> {
	const token = localStorage.getItem("token");
	await fetch(`${API_BASE_URL}/logout/`, {
		method: "POST",
		headers: { Authorization: `Token ${token}` },
	});
	localStorage.removeItem("token");
}

export async function loginWithGoogle(credential: string): Promise<AuthResponse> {
	const res = await fetch(`${API_BASE_URL}/google-login/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ credential }),
	});
	const data = await handleResponse<AuthResponse>(res);
	localStorage.setItem("token", data.token);
	return data;
}