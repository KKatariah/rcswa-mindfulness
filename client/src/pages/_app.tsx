import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Work_Sans } from "next/font/google";
import { AuthProvider } from "@/context/AuthContext";
import { GoogleOAuthProvider } from "@react-oauth/google";

const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-work-sans",
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ""}>
      <AuthProvider>
        <main className={`${workSans.variable} font-sans`}>
          <Component {...pageProps} />
        </main>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}

