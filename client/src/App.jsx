import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import logoUrl from "../../assets/whiteNaiLogo.png";
import AppButton from "./components/AppButton.jsx";
import FormField from "./components/FormField.jsx";
import LivenessChallenge from "./components/LivenessChallenge.jsx";
import UserAvatar from "./components/UserAvatar.jsx";
import EnrollmentFlow from "./pages/EnrollmentFlow.jsx";
import AdminPanel from "./pages/AdminPanel.jsx";
import { api, clearToken, getToken, setToken } from "./lib/api.js";
import { navigate, useHashRoute } from "./lib/router.js";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
const PERSONA_SDK_URL = "https://cdn.withpersona.com/dist/persona-v4.8.0.js";
const PERSONA_DONE_PATTERNS = [
  "/complete",
  "/completed",
  "status=completed",
  "status=approved",
  "/success",
];
const STATUS_TO_ROUTE = {
  pending_kyc: "/kyc",
  pending_video: "/face-verify",
  pending_passkey: "/face-verify",
  pending_enrollment: "/enroll",
  pending_admin: "/enroll",
  active: "/home",
  rejected: "/rejected",
};

export default function App() {
  const { pathname, params } = useHashRoute();
  const [bootState, setBootState] = useState("loading");
  const [account, setAccount] = useState(null);
  const [status, setStatus] = useState(null);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const token = getToken();
      if (!token) {
        if (cancelled) return;
        setAccount(null);
        setStatus(null);
        setBootState("guest");
        if (!isPublicRoute(pathname)) {
          navigate("/");
        }
        return;
      }

      try {
        const claims = decodeJwt(token);
        if (claims?.isAdmin) {
          if (cancelled) return;
          setAccount({
            legalName: "Admin",
            email: claims.email ?? "admin",
            isAdmin: true,
          });
          setStatus("admin");
          setBootState("ready");
          if (
            pathname === "/" ||
            pathname === "/login" ||
            pathname === "/register"
          ) {
            navigate("/admin", undefined, { replace: true });
          }
          return;
        }

        const [me, kyc] = await Promise.all([api.me(), api.kycStatus()]);
        if (cancelled) return;
        setAccount({ ...me, isAdmin: false });
        setStatus(kyc.status);
        setBootState("ready");

        const nextPath = STATUS_TO_ROUTE[kyc.status] ?? "/home";
        if (
          pathname === "/" ||
          pathname === "/login" ||
          pathname === "/register"
        ) {
          navigate(nextPath, undefined, { replace: true });
        }
      } catch {
        if (cancelled) return;
        clearToken();
        setAccount(null);
        setStatus(null);
        setBootState("guest");
        navigate("/", undefined, { replace: true });
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    const token = getToken();
    if (!token || bootState !== "ready" || account?.isAdmin) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = io(BASE, {
      auth: { token },
      transports: ["polling", "websocket"],
    });
    socketRef.current = socket;

    socket.on(
      "verification:incoming",
      ({ sessionId, requesterName, requesterPhoto }) => {
        const next = {
          sessionId,
          peerName: requesterName,
          peerPhoto: requesterPhoto ?? "",
          mode: "incoming",
        };
        setIncomingRequest(next);
        navigate("/verify", next);
      },
    );

    return () => {
      socket.disconnect();
    };
  }, [bootState, account?.isAdmin]);

  async function refreshAccount() {
    const token = getToken();
    if (!token) return;

    const claims = decodeJwt(token);
    if (claims?.isAdmin) {
      setStatus("admin");
      return;
    }

    const [me, kyc] = await Promise.all([api.me(), api.kycStatus()]);
    setAccount({ ...me, isAdmin: false });
    setStatus(kyc.status);
    return kyc.status;
  }

  async function handleAuthSuccess(token, destination) {
    setToken(token);
    const claims = decodeJwt(token);
    if (claims?.isAdmin) {
      setAccount({
        legalName: "Admin",
        email: claims.email ?? "admin",
        isAdmin: true,
      });
      setStatus("admin");
      setBootState("ready");
      navigate("/admin", undefined, { replace: true });
      return;
    }

    const nextStatus = await refreshAccount();
    setBootState("ready");
    navigate(destination ?? STATUS_TO_ROUTE[nextStatus] ?? "/home", undefined, {
      replace: true,
    });
  }

  async function handleSignOut() {
    clearToken();
    setAccount(null);
    setStatus(null);
    setIncomingRequest(null);
    socketRef.current?.disconnect();
    navigate("/", undefined, { replace: true });
  }

  if (bootState === "loading") {
    return (
      <CenteredShell>
        <LoadingState message="Loading your identity profile..." />
      </CenteredShell>
    );
  }

  if (bootState === "guest") {
    if (pathname === "/login") {
      return (
        <AuthShell
          title="Welcome back"
          copy="Sign in to continue into the same verification flows you use on mobile."
          alternateLabel="Need an account?"
          alternateAction="Create one"
          onAlternate={() => navigate("/register")}
        >
          <LoginScreen onSuccess={handleAuthSuccess} />
        </AuthShell>
      );
    }

    if (pathname === "/register") {
      return (
        <AuthShell
          title="Create account"
          copy="Set up your account, complete KYC, and use the same verification products across mobile and web."
          alternateLabel="Already have an account?"
          alternateAction="Sign in"
          onAlternate={() => navigate("/login")}
        >
          <RegisterScreen onSuccess={handleAuthSuccess} />
        </AuthShell>
      );
    }

    return <WelcomeScreen />;
  }

  const routeParams =
    pathname === "/verify" && incomingRequest?.sessionId === params.sessionId
      ? { ...params, ...incomingRequest }
      : params;

  if (status !== "admin" && requiresKyc(status) && !isKycRoute(pathname)) {
    const nextPath = STATUS_TO_ROUTE[status] ?? "/home";
    if (pathname !== nextPath) {
      navigate(nextPath, undefined, { replace: true });
      return (
        <CenteredShell>
          <LoadingState message="Redirecting..." />
        </CenteredShell>
      );
    }
  }

  if (status === "admin") {
    return (
      <MainShell
        account={account}
        onSignOut={handleSignOut}
        title="Enrollment review"
        kicker="Admin"
      >
        <AdminPanel />
      </MainShell>
    );
  }

  if (pathname === "/kyc") {
    return (
      <CenteredShell>
        <KycScreen
          onComplete={async () => {
            const nextStatus = await refreshAccount();
            navigate(STATUS_TO_ROUTE[nextStatus] ?? "/home", undefined, {
              replace: true,
            });
          }}
        />
      </CenteredShell>
    );
  }

  if (pathname === "/face-verify") {
    if (status === "active") {
      navigate("/home", undefined, { replace: true });
      return (
        <CenteredShell>
          <LoadingState message="Redirecting..." />
        </CenteredShell>
      );
    }
    return (
      <CenteredShell>
        <FaceVerifyScreen
          onComplete={async () => {
            setStatus("active");
            navigate("/home", undefined, { replace: true });
            refreshAccount().catch(() => {});
          }}
        />
      </CenteredShell>
    );
  }

  if (pathname === "/rejected") {
    return (
      <CenteredShell>
        <RejectedScreen onSignOut={handleSignOut} />
      </CenteredShell>
    );
  }

  if (pathname === "/enroll") {
    return (
      <MainShell
        account={account}
        onSignOut={handleSignOut}
        title="Legacy enrollment"
        kicker="Fallback"
      >
        <EnrollmentFlow />
      </MainShell>
    );
  }

  if (pathname === "/request") {
    return (
      <MainShell
        account={account}
        onSignOut={handleSignOut}
        title="Who are you meeting?"
        kicker="Request verification"
      >
        <RequestVerificationScreen />
      </MainShell>
    );
  }

  if (pathname === "/meet") {
    return (
      <MainShell
        account={account}
        onSignOut={handleSignOut}
        title="Google Meet"
        kicker=""
      >
        <CategoryScreen
          title="Google Meet"
          description="Use this when you want to verify people in a live Google Meet flow. Hosts create the session and participants join with the shared meet code."
          backLabel="Back to Home"
          onBack={() => navigate("/home")}
          actions={[
            {
              kicker: "Meet",
              title: "Make a Meet",
              onClick: () => navigate("/meet/host"),
            },
            {
              kicker: "Meet",
              title: "Join a Meet",
              onClick: () => navigate("/meet/join"),
            },
          ]}
        />
      </MainShell>
    );
  }

  if (pathname === "/bots") {
    return (
      <MainShell
        account={account}
        onSignOut={handleSignOut}
        title="Bots"
        kicker=""
      >
        <CategoryScreen
          title="Bots"
          description="Use this when a Telegram or Discord bot gives you a 4-character code and you need to complete identity verification for that bot session."
          backLabel="Back to Home"
          onBack={() => navigate("/home")}
          actions={[
            {
              kicker: "Telegram",
              title: "Telegram Bot",
              onClick: () => navigate("/telegram-auth"),
            },
            {
              kicker: "Discord",
              title: "Discord Bot",
              onClick: () => navigate("/discord-auth"),
            },
          ]}
        />
      </MainShell>
    );
  }

  if (pathname === "/direct") {
    return (
      <MainShell
        account={account}
        onSignOut={handleSignOut}
        title="Direct"
        kicker=""
      >
        <CategoryScreen
          title="Direct"
          description="Use this for one-to-one verification requests when you want to directly confirm the identity of another verified user."
          backLabel="Back to Home"
          onBack={() => navigate("/home")}
          actions={[
            {
              kicker: "Verify",
              title: "Request Verification",
              onClick: () => navigate("/request"),
            },
          ]}
        />
      </MainShell>
    );
  }

  if (pathname === "/verify") {
    return (
      <MainShell
        account={account}
        onSignOut={handleSignOut}
        title="Verification session"
        kicker="Live session"
      >
        <VerifyScreen
          sessionId={routeParams.sessionId}
          peerName={routeParams.peerName}
          peerPhoto={routeParams.peerPhoto}
          mode={routeParams.mode}
        />
      </MainShell>
    );
  }

  if (pathname === "/meet/host") {
    return (
      <MainShell
        account={account}
        onSignOut={handleSignOut}
        title="Make a meeting"
        kicker="Meet"
      >
        <MeetHostScreen />
      </MainShell>
    );
  }

  if (pathname === "/meet/join") {
    return (
      <MainShell
        account={account}
        onSignOut={handleSignOut}
        title="Join a meeting"
        kicker="Meet"
      >
        <MeetJoinScreen />
      </MainShell>
    );
  }

  if (pathname === "/meet/authenticate") {
    return (
      <MainShell
        account={account}
        onSignOut={handleSignOut}
        title="Authenticate for Meet"
        kicker="Meet"
      >
        <MeetAuthenticateScreen
          sessionId={params.sessionId}
          meetingCode={params.meetingCode}
        />
      </MainShell>
    );
  }

  if (pathname === "/telegram-auth") {
    return (
      <MainShell
        account={account}
        onSignOut={handleSignOut}
        title="Telegram auth"
        kicker="Code flow"
      >
        <CodeAuthScreen
          kind="telegram"
          title="Paste your Telegram code"
          copy="Tap Authenticate in Telegram, then enter the 4-character code here to run a fresh face-liveness check."
        />
      </MainShell>
    );
  }

  if (pathname === "/discord-auth") {
    return (
      <MainShell
        account={account}
        onSignOut={handleSignOut}
        title="Discord auth"
        kicker="Code flow"
      >
        <CodeAuthScreen
          kind="discord"
          title="Paste your Discord code"
          copy="Run the Discord slash command, tap Authenticate, and enter the 4-character code here."
        />
      </MainShell>
    );
  }

  return (
    <MainShell
      account={account}
      onSignOut={handleSignOut}
      title="Home"
      kicker=""
    >
      <HomeScreen account={account} onSignOut={handleSignOut} />
    </MainShell>
  );
}

function WelcomeScreen() {
  return (
    <CenteredShell>
      <div className="app-card app-card--welcome stack-xl">
        <div className="brand-mark">
          <img src={logoUrl} alt="NAI logo" className="brand-mark__image" />
        </div>
        <div className="stack">
          <h1 className="hero-title">TrustHandshake</h1>
          <p className="hero-copy">
            Mutual identity verification. Know exactly who you&apos;re talking
            to across meetings, chat bots, and direct requests.
          </p>
        </div>
        <div className="actions">
          <AppButton onClick={() => navigate("/register")}>
            Get Started
          </AppButton>
          <AppButton variant="outline" onClick={() => navigate("/login")}>
            Sign In
          </AppButton>
        </div>
      </div>
    </CenteredShell>
  );
}

function AuthShell({
  title,
  copy,
  alternateLabel,
  alternateAction,
  onAlternate,
  children,
}) {
  return (
    <CenteredShell>
      <div className="app-card stack-xl">
        <button className="back-link" onClick={() => navigate("/")}>
          ← Back
        </button>
        <div className="stack">
          <div className="brand-mark">
            <img src={logoUrl} alt="NAI logo" className="brand-mark__image" />
          </div>
          <h1 className="page-title">{title}</h1>
          <p className="page-copy">{copy}</p>
        </div>
        {children}
        <p className="muted" style={{ margin: 0 }}>
          {alternateLabel}{" "}
          <button className="back-link" onClick={onAlternate}>
            {alternateAction}
          </button>
        </p>
      </div>
    </CenteredShell>
  );
}

function LoginScreen({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { token } = await api.login(email.trim(), password);
      await onSuccess(token);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <FormField
        label="Email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        placeholder="you@example.com"
        required
      />
      <FormField
        label="Password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        placeholder="••••••••"
        required
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <AppButton type="submit" disabled={loading}>
        {loading ? "Signing in..." : "Sign In"}
      </AppButton>
    </form>
  );
}

function RegisterScreen({ onSuccess }) {
  const [form, setForm] = useState({
    legalName: "",
    phone: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { token } = await api.register(
        form.email.trim(),
        form.password,
        form.legalName.trim() || undefined,
        form.phone.trim() || undefined,
      );
      await onSuccess(token, "/kyc");
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <FormField
        label="Full name"
        value={form.legalName}
        onChange={(event) =>
          setForm((current) => ({ ...current, legalName: event.target.value }))
        }
        autoComplete="name"
        placeholder="Jane Smith"
      />
      <FormField
        label="Phone"
        value={form.phone}
        onChange={(event) =>
          setForm((current) => ({ ...current, phone: event.target.value }))
        }
        autoComplete="tel"
        placeholder="+1 555 000 0000"
      />
      <FormField
        label="Email"
        type="email"
        value={form.email}
        onChange={(event) =>
          setForm((current) => ({ ...current, email: event.target.value }))
        }
        autoComplete="email"
        placeholder="you@example.com"
        required
      />
      <FormField
        label="Password"
        type="password"
        value={form.password}
        onChange={(event) =>
          setForm((current) => ({ ...current, password: event.target.value }))
        }
        autoComplete="new-password"
        hint="Minimum 8 characters"
        placeholder="Minimum 8 characters"
        required
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <AppButton type="submit" disabled={loading}>
        {loading ? "Creating account..." : "Continue"}
      </AppButton>
    </form>
  );
}

function KycScreen({ onComplete }) {
  const [step, setStep] = useState("loading");
  const [error, setError] = useState("");
  const pollRef = useRef(null);
  const advancedRef = useRef(false);
  const personaClientRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return undefined;
    startedRef.current = true;
    startKyc();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      personaClientRef.current?.close?.();
      personaClientRef.current?.destroy?.();
    };
  }, []);

  async function startKyc() {
    try {
      const { inquiryId, sessionToken } = await api.mobileKycStart();
      await launchPersona(inquiryId, sessionToken);
      setStep("persona");
      startPolling();
    } catch (err) {
      setError(err.message || "Failed to start verification");
      setStep("error");
    }
  }

  async function launchPersona(inquiryId, sessionToken) {
    await loadScript(PERSONA_SDK_URL);

    const client = new window.Persona.Client({
      inquiryId,
      sessionToken,
      onLoad: () => setStep("persona"),
      onComplete: async () => {
        client.destroy?.();
        personaClientRef.current = null;
        setStep("processing");
        await handleSyncCheck();
      },
      onCancel: () => {
        client.destroy?.();
        personaClientRef.current = null;
        setStep("persona");
      },
      onError: (personaError) => {
        client.destroy?.();
        personaClientRef.current = null;
        setError(personaError?.message || "Persona failed to start.");
        setStep("error");
      },
    });

    personaClientRef.current = client;
    client.open();
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      try {
        const { status } = await api.kycStatus();
        if (["pending_video", "pending_passkey", "active"].includes(status)) {
          if (advancedRef.current) return;
          advancedRef.current = true;
          clearInterval(pollRef.current);
          personaClientRef.current?.close?.();
          personaClientRef.current?.destroy?.();
          personaClientRef.current = null;
          onComplete();
          return;
        }
      } catch {
        // Keep polling on transient network errors.
      }

      attempts += 1;
      if (attempts >= 40) {
        clearInterval(pollRef.current);
        setStep("timeout");
      }
    }, 3000);
  }

  async function handleSyncCheck() {
    setStep("processing");
    try {
      const { status } = await api.kycSync();
      if (["pending_video", "pending_passkey", "active"].includes(status)) {
        personaClientRef.current?.close?.();
        personaClientRef.current?.destroy?.();
        personaClientRef.current = null;
        onComplete();
        return;
      }
      startPolling();
      setStep("persona");
    } catch {
      startPolling();
      setStep("persona");
    }
  }

  if (step === "loading" || step === "processing") {
    return (
      <div className="app-card centered-state">
        <div className="spinner" />
        <h1 className="page-title">
          {step === "loading" ? "Preparing KYC" : "Processing verification"}
        </h1>
        <p className="page-copy">
          {step === "loading"
            ? "Starting the Persona inquiry and loading the hosted identity flow."
            : "Checking Persona status and advancing your account as soon as review completes."}
        </p>
      </div>
    );
  }

  if (step === "timeout") {
    return (
      <div className="app-card centered-state">
        <h1 className="page-title">Still processing</h1>
        <p className="page-copy">
          Verification is taking longer than expected. Check again once Persona
          has fully completed.
        </p>
        <AppButton onClick={handleSyncCheck}>Check again</AppButton>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="app-card centered-state">
        <Notice tone="danger">{error}</Notice>
        <AppButton onClick={() => window.location.reload()}>
          Try Again
        </AppButton>
      </div>
    );
  }

  return (
    <div className="app-card stack-lg">
      <div className="stack">
        <h1 className="page-title">Verify your identity</h1>
        <p className="page-copy">
          Persona opens inside this page. Once it completes, you move into the
          post-KYC liveness confirmation path.
        </p>
      </div>
      <div className="surface-block stack">
        <LoadingState message="Opening Persona verification..." />
        <p className="timeline-note">
          We still sync inquiry state and poll the backend so the flow can
          recover cleanly if callbacks or webhooks lag.
        </p>
      </div>
    </div>
  );
}

function FaceVerifyScreen({ onComplete }) {
  const [step, setStep] = useState("intro");
  const [error, setError] = useState("");
  const [livenessSessionId, setLivenessSessionId] = useState(null);

  async function startLiveness() {
    setError("");
    setStep("loading");
    try {
      const { sessionId } = await api.livenessStart();
      setLivenessSessionId(sessionId);
      setStep("liveness");
    } catch (err) {
      setError(err.message || "Failed to start liveness challenge.");
      setStep("error");
    }
  }

  async function handleLivenessComplete() {
    setStep("checking");
    try {
      console.log("[post-kyc] calling /mobile/liveness/complete", {
        livenessSessionId,
      });
      const result = await api.livenessComplete(livenessSessionId);
      console.log("[post-kyc] /mobile/liveness/complete response", result);
      if (!result.livenessPass || !result.faceMatchPassed) {
        setError("Liveness or face match did not pass. Try again.");
        setStep("error");
        return;
      }
      console.log("[post-kyc] calling /mobile/post-kyc/finalize");
      await api.postKycFinalize();
      console.log("[post-kyc] /mobile/post-kyc/finalize succeeded");
      console.log("[post-kyc] invoking onComplete transition");
      await onComplete();
      console.log("[post-kyc] onComplete transition resolved");
    } catch (err) {
      console.error("[post-kyc] activation flow failed", err);
      setError(err.message || "Verification failed");
      setStep("error");
    }
  }

  if (step === "liveness") {
    return (
      <div className="stack-lg">
        <LivenessChallenge
          sessionId={livenessSessionId}
          onComplete={handleLivenessComplete}
          onError={(message) => {
            setError(message || "Liveness check failed");
            setStep("error");
          }}
        />
      </div>
    );
  }

  if (step === "loading" || step === "checking") {
    return (
      <div className="app-card centered-state">
        <div className="spinner" />
        <h1 className="page-title">
          {step === "loading" ? "Preparing liveness" : "Checking identity"}
        </h1>
        <p className="page-copy">
          {step === "loading"
            ? "Starting the AWS liveness challenge."
            : "Checking liveness and face match against your KYC photo."}
        </p>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="app-card centered-state">
        <Notice tone="danger">{error}</Notice>
        <AppButton onClick={() => setStep("intro")}>Try Again</AppButton>
      </div>
    );
  }

  return (
    <div className="app-card stack-lg">
      <div className="stack">
        <h1 className="page-title">Confirm your identity</h1>
        <p className="page-copy">
          Complete AWS face liveness, then we compare the liveness reference
          image against your KYC photo before activating the account.
        </p>
      </div>
      <AppButton onClick={startLiveness}>Start Liveness</AppButton>
    </div>
  );
}

function HomeScreen({ account, onSignOut }) {
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    api
      .recentVerifications()
      .then(setRecent)
      .catch(() => {});
  }, []);

  return (
    <div className="page-grid">
      <section className="hero-card surface-block">
        <div className="page-header">
          <div className="stack" style={{ gap: 10 }}>
            <div className="inline-actions" style={{ alignItems: "center" }}>
              <h1 className="page-title">
                {account?.legalName ?? account?.email ?? "—"}
              </h1>
              <span className="pill">Verified</span>
            </div>
          </div>
        </div>

        <div className="stack">
          <ActionCard
            kicker="Category"
            title="Google Meet"
            onClick={() => navigate("/meet")}
          />
          <ActionCard
            kicker="Category"
            title="Bots"
            onClick={() => navigate("/bots")}
          />
          <ActionCard
            kicker="Category"
            title="Direct"
            onClick={() => navigate("/direct")}
          />
        </div>
      </section>

      <section className="stack">
        <div className="page-header">
          <div>
            <h2 style={{ margin: 0 }}>Recent</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Previous mutual identity checks and verification codes.
            </p>
          </div>
        </div>

        {recent.length === 0 ? (
          <div className="surface-block centered-state">
            <p className="page-copy">
              No verifications yet. Request one to get started.
            </p>
          </div>
        ) : (
          <div className="list">
            {recent.map((item) => (
              <div className="list-item" key={item.id}>
                <div className="list-item__meta">
                  <UserAvatar name={item.peerName} photoUrl={null} size={52} />
                  <div>
                    <div className="list-item__title">{item.peerName}</div>
                    <div className="list-item__subtitle">
                      {new Date(item.verifiedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="code-chip">{item.code}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RequestVerificationScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch(value) {
    setQuery(value);
    setError("");

    if (value.trim().length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      const data = await api.searchUsers(value.trim());
      setResults(data);
    } catch (err) {
      setError(err.message || "Search failed");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleSelect(user) {
    try {
      const { sessionId } = await api.requestVerification(user.id);
      navigate("/verify", {
        sessionId,
        peerName: user.legalName,
        peerPhoto: user.photoUrl ?? "",
        mode: "outgoing",
      });
    } catch (err) {
      setError(err.message || "Failed to send request");
    }
  }

  return (
    <div className="page-grid">
      <button className="back-link" onClick={() => navigate("/home")}>
        ← Back
      </button>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          Search verified users
        </p>
        <FormField
          label="Name, email, or code"
          value={query}
          onChange={(event) => handleSearch(event.target.value)}
          placeholder="Search by name, email, or code..."
          autoFocus
        />
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {searching ? (
        <LoadingState message="Searching verified users..." />
      ) : (
        <div className="list">
          {results.map((user) => (
            <button
              className="list-item"
              key={user.id}
              onClick={() => handleSelect(user)}
            >
              <div className="list-item__meta">
                <UserAvatar
                  name={user.legalName}
                  photoUrl={user.photoUrl}
                  size={52}
                />
                <div>
                  <div className="list-item__title">{user.legalName}</div>
                  <div className="list-item__subtitle">
                    {user.userCode ?? "Verified user"}
                  </div>
                </div>
              </div>
              <div className="code-chip">Verify</div>
            </button>
          ))}
          {!results.length && query.length >= 2 ? (
            <div className="surface-block centered-state">
              <p className="page-copy">No verified users found.</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function VerifyScreen({ sessionId, peerName, peerPhoto, mode = "outgoing" }) {
  const [step, setStep] = useState(
    mode === "incoming" ? "incoming" : "waiting",
  );
  const [error, setError] = useState("");
  const [livenessSessionId, setLivenessSessionId] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (mode !== "incoming") {
      pollForAcceptance();
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sessionId, mode]);

  function pollForAcceptance() {
    pollRef.current = setInterval(async () => {
      try {
        const { state } = await api.sessionStatus(sessionId);
        if (state === "awaiting_both") {
          clearInterval(pollRef.current);
          setStep("auth");
        } else if (state === "failed") {
          clearInterval(pollRef.current);
          setError("Request declined or expired.");
          setStep("error");
        }
      } catch {
        // Keep polling.
      }
    }, 2000);
  }

  function pollForCompletion() {
    setStep("peer_pending");
    pollRef.current = setInterval(async () => {
      try {
        const { state, verificationCode } = await api.sessionStatus(sessionId);
        if (state === "verified" && verificationCode) {
          clearInterval(pollRef.current);
          setStep("done");
          setError(verificationCode);
        } else if (state === "failed") {
          clearInterval(pollRef.current);
          setStep("error");
          setError("Verification failed on the other side.");
        }
      } catch {
        // Keep polling.
      }
    }, 1500);
  }

  async function handleAccept() {
    await api.acceptVerification(sessionId);
    setStep("auth");
  }

  async function handleDecline() {
    await api.declineVerification(sessionId);
    navigate("/home", undefined, { replace: true });
  }

  async function handleStartLiveness() {
    setError("");
    setStep("liveness_loading");
    try {
      const { sessionId: id } = await api.livenessStart();
      setLivenessSessionId(id);
      setStep("liveness");
    } catch (err) {
      setError(err.message || "Failed to start liveness");
      setStep("error");
    }
  }

  async function handleLivenessDone() {
    try {
      const result = await api.livenessComplete(livenessSessionId);
      if (!result.livenessPass || !result.faceMatchPassed) {
        setError(
          `Face verification failed (score: ${result.faceMatchScore?.toFixed(1) ?? 0}%). Please retry in better lighting.`,
        );
        setStep("error");
        return;
      }

      await api.testAssertBypass(sessionId);
      pollForCompletion();
    } catch (err) {
      setError(err.message || "Authentication failed");
      setStep("error");
    }
  }

  if (!sessionId) {
    return <Notice tone="danger">Missing session information.</Notice>;
  }

  if (step === "liveness") {
    return (
      <div className="stack-lg">
        <button className="back-link" onClick={() => setStep("auth")}>
          ← Back
        </button>
        <LivenessChallenge
          sessionId={livenessSessionId}
          onComplete={handleLivenessDone}
          onError={(message) => {
            setError(message || "Liveness failed");
            setStep("error");
          }}
        />
      </div>
    );
  }

  if (step === "waiting" || step === "peer_pending") {
    return (
      <div className="surface-block centered-state">
        <UserAvatar name={peerName} photoUrl={peerPhoto} size={112} />
        <h2 style={{ margin: 0 }}>
          {step === "waiting" ? peerName : `Waiting for ${peerName}...`}
        </h2>
        <p className="page-copy">
          {step === "waiting"
            ? "Waiting for them to respond to your verification request."
            : "Your liveness check is complete. Waiting for the other participant to finish."}
        </p>
        <div className="spinner" />
      </div>
    );
  }

  if (step === "incoming") {
    return (
      <div className="surface-block centered-state">
        <UserAvatar name={peerName} photoUrl={peerPhoto} size={112} />
        <h2 style={{ margin: 0 }}>{peerName}</h2>
        <p className="page-copy">Wants to verify with you.</p>
        <div className="actions">
          <AppButton onClick={handleAccept}>Accept</AppButton>
          <AppButton variant="ghost" onClick={handleDecline}>
            Decline
          </AppButton>
        </div>
      </div>
    );
  }

  if (step === "auth" || step === "liveness_loading") {
    return (
      <div className="surface-block centered-state">
        <UserAvatar name={peerName} photoUrl={peerPhoto} size={112} />
        <h2 style={{ margin: 0 }}>{peerName}</h2>
        <p className="page-copy">
          {step === "auth"
            ? "Complete face liveness to confirm you are the verified identity on file."
            : "Preparing liveness challenge..."}
        </p>
        {step === "auth" ? (
          <AppButton onClick={handleStartLiveness}>
            Verify with Face Liveness
          </AppButton>
        ) : (
          <div className="spinner" />
        )}
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="surface-block surface-block--success centered-state">
        <h2 style={{ margin: 0 }}>Verification complete</h2>
        <p className="page-copy">Your mutual identity check is finished.</p>
        <div className="code-chip">{error}</div>
        <AppButton
          onClick={() => navigate("/home", undefined, { replace: true })}
        >
          Back to Home
        </AppButton>
      </div>
    );
  }

  return (
    <div className="surface-block centered-state">
      <Notice tone="danger">{error || "Verification failed."}</Notice>
      <AppButton onClick={() => setStep("auth")}>Try Again</AppButton>
      <AppButton
        variant="ghost"
        onClick={() => navigate("/home", undefined, { replace: true })}
      >
        Cancel
      </AppButton>
    </div>
  );
}

function MeetHostScreen() {
  const [meetingCode, setMeetingCode] = useState("");
  const [reauthMinutes, setReauthMinutes] = useState("15");
  const [sessionData, setSessionData] = useState(null);
  const [step, setStep] = useState("idle");
  const [error, setError] = useState("");
  const [livenessSessionId, setLivenessSessionId] = useState(null);

  async function handleStart() {
    const trimmed = meetingCode.trim();
    if (trimmed.length < 3) {
      setError("Enter a meeting code with at least 3 characters.");
      return;
    }

    setError("");
    setStep("starting");
    try {
      const session = await api.meetStartSession(
        trimmed,
        Number(reauthMinutes) || undefined,
      );
      await api.meetJoin(session.meetingCode);
      const { livenessSessionId: id } = await api.meetLivenessStart(
        session.sessionId,
      );
      setSessionData(session);
      setLivenessSessionId(id);
      setStep("liveness");
    } catch (err) {
      setError(err.message || "Failed to start meeting session");
      setStep("error");
    }
  }

  async function handleComplete() {
    try {
      const result = await api.meetLivenessComplete(
        sessionData.sessionId,
        livenessSessionId,
      );
      if (!result.livenessPass || !result.faceMatchPassed) {
        await api.meetEndSession(sessionData.sessionId).catch(() => {});
        setError(
          `Face verification failed (score: ${result.faceMatchScore?.toFixed(1) ?? 0}%).`,
        );
        setStep("error");
        return;
      }

      const complete = await api.meetCompleteAuth(sessionData.sessionId, {
        status: "verified",
      });
      setSessionData((current) => ({
        ...current,
        verificationExpiresAt: complete.verificationExpiresAt ?? null,
        reauthIntervalMinutes:
          complete.reauthIntervalMinutes ?? current.reauthIntervalMinutes,
      }));
      setStep("active");
    } catch (err) {
      setError(err.message || "Verification failed");
      setStep("error");
    }
  }

  async function handleEnd() {
    if (!sessionData?.sessionId) return;
    await api.meetEndSession(sessionData.sessionId).catch(() => {});
    setSessionData(null);
    setStep("idle");
    setMeetingCode("");
    setError("");
  }

  if (step === "liveness") {
    return (
      <div className="stack-lg">
        <LivenessChallenge
          sessionId={livenessSessionId}
          onComplete={handleComplete}
          onError={(message) => {
            setError(message || "Liveness failed");
            setStep("error");
          }}
        />
      </div>
    );
  }

  if (step === "active" && sessionData) {
    return (
      <div className="stack-lg">
        <div className="surface-block surface-block--success stack">
          <div className="pill">You are verified</div>
          <div className="code-chip">{sessionData.meetingCode}</div>
          <p className="page-copy">
            Share this meeting code with participants. They use it in the app or
            website under Join a Meeting.
          </p>
          {sessionData.verificationExpiresAt ? (
            <p className="timeline-note">
              Valid until{" "}
              {new Date(sessionData.verificationExpiresAt).toLocaleTimeString()}
            </p>
          ) : null}
        </div>
        <div className="actions">
          <AppButton
            variant="outline"
            onClick={() =>
              navigator.clipboard.writeText(sessionData.meetingCode)
            }
          >
            Copy Code
          </AppButton>
          <AppButton onClick={handleEnd}>End Session</AppButton>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="stack">
        <p className="page-copy">
          Create a meeting code, verify yourself first, and then let others join
          with the same code.
        </p>
      </div>
      <div className="form-grid">
        <FormField
          label="Meeting code"
          value={meetingCode}
          onChange={(event) => setMeetingCode(event.target.value.toUpperCase())}
          placeholder="DAILY-STANDUP"
        />
        <FormField
          label="Reverify interval (minutes)"
          type="number"
          min="5"
          max="60"
          value={reauthMinutes}
          onChange={(event) => setReauthMinutes(event.target.value)}
          hint="Same reverify concept as the mobile Meet host flow."
        />
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {step === "starting" ? (
        <LoadingState message="Starting meeting session..." />
      ) : null}
      <AppButton onClick={handleStart} disabled={step === "starting"}>
        Start and Verify
      </AppButton>
    </div>
  );
}

function MeetJoinScreen() {
  const [meetingCode, setMeetingCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    setError("");
    setLoading(true);
    try {
      const joined = await api.meetJoin(
        meetingCode.trim(),
        displayName.trim() || undefined,
      );
      navigate("/meet/authenticate", {
        sessionId: joined.sessionId,
        meetingCode: joined.meetingCode,
      });
    } catch (err) {
      setError(err.message || "Could not join meeting session");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack-lg">
      <button className="back-link" onClick={() => navigate("/home")}>
        ← Back
      </button>
      <FormField
        label="Meeting code"
        value={meetingCode}
        onChange={(event) => setMeetingCode(event.target.value.toUpperCase())}
        placeholder="ABC-123"
      />
      <FormField
        label="Your meeting name"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        placeholder="Optional display name"
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <AppButton onClick={handleJoin} disabled={loading}>
        {loading ? "Joining..." : "Continue to Authentication"}
      </AppButton>
    </div>
  );
}

function MeetAuthenticateScreen({ sessionId, meetingCode }) {
  const [step, setStep] = useState("idle");
  const [error, setError] = useState("");
  const [livenessSessionId, setLivenessSessionId] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);

  async function beginAuth() {
    setError("");
    setStep("loading");
    try {
      const { livenessSessionId: id } = await api.meetLivenessStart(sessionId);
      setLivenessSessionId(id);
      setStep("liveness");
    } catch (err) {
      setError(err.message || "Failed to start liveness");
      setStep("error");
    }
  }

  async function handleComplete() {
    try {
      const result = await api.meetLivenessComplete(
        sessionId,
        livenessSessionId,
      );
      if (!result.livenessPass || !result.faceMatchPassed) {
        await api
          .meetCompleteAuth(sessionId, {
            status: "failed",
            failureReason: "Liveness or face match did not pass",
          })
          .catch(() => {});
        setError("Liveness or face match failed. Please retry.");
        setStep("error");
        return;
      }

      const complete = await api.meetCompleteAuth(sessionId, {
        status: "verified",
      });
      setExpiresAt(complete.verificationExpiresAt ?? null);
      setStep("done");
    } catch (err) {
      await api
        .meetCompleteAuth(sessionId, {
          status: "failed",
          failureReason: err.message || "Authentication failed",
        })
        .catch(() => {});
      setError(err.message || "Authentication failed");
      setStep("error");
    }
  }

  if (step === "liveness") {
    return (
      <LivenessChallenge
        sessionId={livenessSessionId}
        onComplete={handleComplete}
        onError={(message) => {
          setError(message || "Liveness failed");
          setStep("error");
        }}
      />
    );
  }

  return (
    <div className="stack-lg">
      <div className="surface-block stack">
        <h2 style={{ margin: 0 }}>Authenticate for Meet</h2>
        <p className="page-copy">
          Meeting code: <strong>{meetingCode}</strong>
        </p>
        {step === "idle" ? (
          <p className="page-copy">
            Run the same liveness and face match flow used in the mobile app.
          </p>
        ) : null}
        {step === "loading" ? (
          <LoadingState message="Preparing liveness challenge..." />
        ) : null}
        {step === "done" ? (
          <Notice tone="success">
            Verified
            {expiresAt
              ? ` until ${new Date(expiresAt).toLocaleTimeString()}`
              : "."}
          </Notice>
        ) : null}
        {step === "error" ? <Notice tone="danger">{error}</Notice> : null}
      </div>
      {step === "idle" ? (
        <AppButton onClick={beginAuth}>Start Authentication</AppButton>
      ) : null}
      {step === "done" || step === "error" ? (
        <AppButton
          variant="ghost"
          onClick={() => navigate("/home", undefined, { replace: true })}
        >
          Back to Home
        </AppButton>
      ) : null}
    </div>
  );
}

function CodeAuthScreen({ kind, title, copy }) {
  const [code, setCode] = useState("");
  const [step, setStep] = useState("idle");
  const [error, setError] = useState("");
  const [livenessSessionId, setLivenessSessionId] = useState(null);
  const [details, setDetails] = useState(null);

  const startAuth =
    kind === "telegram" ? api.telegramStartAuth : api.discordStartAuth;
  const startLiveness =
    kind === "telegram" ? api.telegramLivenessStart : api.discordLivenessStart;
  const completeAuth =
    kind === "telegram" ? api.telegramCompleteAuth : api.discordCompleteAuth;

  async function handleValidate() {
    setError("");
    setStep("validating");
    try {
      const info = await startAuth(code.trim().toUpperCase());
      const { livenessSessionId: id } = await startLiveness();
      setDetails(info);
      setLivenessSessionId(id);
      setStep("liveness");
    } catch (err) {
      setError(err.message || "Invalid code");
      setStep("error");
    }
  }

  async function handleComplete() {
    try {
      await completeAuth(code.trim().toUpperCase(), livenessSessionId);
      setStep("done");
    } catch (err) {
      setError(err.message || "Authentication failed");
      setStep("error");
    }
  }

  if (step === "liveness") {
    return (
      <div className="stack-lg">
        {details ? (
          <div className="surface-block stack">
            <div className="page-header">
              <div>
                <p className="muted" style={{ margin: 0 }}>
                  Linked participant
                </p>
                <h2 style={{ margin: "6px 0 0" }}>
                  {details.displayName ?? details.telegramUsername ?? kind}
                </h2>
              </div>
              <div className="code-chip">{details.code}</div>
            </div>
          </div>
        ) : null}
        <LivenessChallenge
          sessionId={livenessSessionId}
          onComplete={handleComplete}
          onError={(message) => {
            setError(message || "Liveness failed");
            setStep("error");
          }}
        />
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="stack">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <p className="page-copy">{copy}</p>
      </div>
      <FormField
        label="4-character code"
        className="input--code"
        value={code}
        onChange={(event) =>
          setCode(event.target.value.toUpperCase().slice(0, 4))
        }
        placeholder="A7KQ"
        maxLength={4}
      />
      {step === "validating" ? (
        <LoadingState message="Checking code..." />
      ) : null}
      {step === "done" ? (
        <Notice tone="success">
          Authentication complete. Return to{" "}
          {kind === "telegram" ? "Telegram" : "Discord"}.
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {step !== "done" ? (
        <AppButton
          onClick={handleValidate}
          disabled={code.trim().length !== 4 || step === "validating"}
        >
          Continue
        </AppButton>
      ) : null}
      <AppButton variant="ghost" onClick={() => navigate("/home")}>
        Back to Home
      </AppButton>
    </div>
  );
}

function RejectedScreen({ onSignOut }) {
  return (
    <div className="app-card centered-state">
      <Notice tone="danger">
        Your identity could not be verified. Contact support if you believe this
        is an error.
      </Notice>
      <AppButton onClick={onSignOut}>Sign Out</AppButton>
    </div>
  );
}

function MainShell({ account, onSignOut, title, kicker, children }) {
  return (
    <div className="app-shell">
      <div className="app-shell__content stack-xl">
        <header className="page-header">
          <div className="stack" style={{ gap: 8 }}>
            {kicker ? (
              <p className="shell-kicker" style={{ margin: 0 }}>
                {kicker}
              </p>
            ) : null}
            <h1 className="page-title">{title}</h1>
          </div>
          <div className="inline-actions" style={{ alignItems: "center" }}>
            <AppButton variant="ghost" onClick={onSignOut}>
              Sign Out
            </AppButton>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}

function CenteredShell({ children }) {
  return <div className="app-shell app-shell--centered">{children}</div>;
}

function ActionCard({ kicker, title, onClick }) {
  return (
    <button className="action-card" onClick={onClick}>
      <span className="action-card__kicker">{kicker}</span>
      <span className="action-card__title">{title}</span>
    </button>
  );
}

function CategoryScreen({ title, description, actions, backLabel, onBack }) {
  return (
    <div className="stack-lg">
      <button className="back-link" onClick={onBack}>
        ← {backLabel}
      </button>
      <div className="surface-block stack">
        <h2 className="section-title">{title}</h2>
        <p className="page-copy">{description}</p>
      </div>
      <div className="stack">
        {actions.map((action) => (
          <ActionCard
            key={action.title}
            kicker={action.kicker}
            title={action.title}
            onClick={action.onClick}
          />
        ))}
      </div>
    </div>
  );
}

function LoadingState({ message }) {
  return (
    <div className="centered-state">
      <div className="spinner" />
      <p className="page-copy" style={{ margin: 0 }}>
        {message}
      </p>
    </div>
  );
}

function Notice({ children, tone = "neutral" }) {
  const className =
    tone === "danger"
      ? "surface-block surface-block--danger"
      : tone === "success"
        ? "surface-block surface-block--success"
        : "surface-block";

  return <div className={className}>{children}</div>;
}

function decodeJwt(token) {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

function isPublicRoute(pathname) {
  return pathname === "/" || pathname === "/login" || pathname === "/register";
}

function isKycRoute(pathname) {
  return ["/kyc", "/face-verify", "/rejected", "/enroll"].includes(pathname);
}

function requiresKyc(status) {
  return [
    "pending_kyc",
    "pending_video",
    "pending_passkey",
    "pending_enrollment",
    "pending_admin",
    "rejected",
  ].includes(status);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Persona) {
      resolve();
      return;
    }

    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (window.Persona) {
          clearInterval(timer);
          resolve();
        } else if (attempts > 50) {
          clearInterval(timer);
          reject(new Error(`Failed to initialize script: ${src}`));
        }
      }, 100);
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}
