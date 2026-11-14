import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import "./index.css";
import { createApiClient } from "./lib/api";
import { createSupabaseAuthService } from "./lib/authService";
import { createSupabase, readConfig } from "./lib/config";
import { createSupabaseBattleData, createSupabaseLive } from "./lib/live";
import { DEFAULT_TIMING, ServicesProvider, type Services } from "./services";

const root = createRoot(document.getElementById("root")!);
const config = readConfig(import.meta.env);

if (!config) {
  root.render(
    <main className="mx-auto max-w-xl p-10">
      <h1 className="font-display text-3xl font-bold uppercase">Setup needed</h1>
      <p className="text-soft">
        Copy <code>apps/web/.env.example</code> to <code>apps/web/.env.local</code> and fill in the
        Supabase URL, the anon key and the API address, then restart the dev server.
      </p>
    </main>,
  );
} else {
  const supabase = createSupabase(config);
  const authService = createSupabaseAuthService(supabase);
  const services: Services = {
    api: createApiClient({
      baseUrl: config.apiBaseUrl,
      getToken: () => authService.getAccessToken(),
    }),
    live: createSupabaseLive(supabase),
    data: createSupabaseBattleData(supabase),
    timing: DEFAULT_TIMING,
  };
  root.render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider service={authService}>
          <ServicesProvider value={services}>
            <App />
          </ServicesProvider>
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}
