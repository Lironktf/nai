import { useState, useEffect, useCallback } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { api } from "../lib/api.js";
import AppButton from "../components/AppButton.jsx";
import { navigate } from "../lib/router.js";

export default function WalletLink() {
  const { address, isConnected, chain } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [linkedWallets, setLinkedWallets] = useState([]);
  const [attestations, setAttestations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [walletsRes, attestRes] = await Promise.all([
        api.walletLinked().catch(() => ({ wallets: [] })),
        api.attestationUser().catch(() => ({ attestations: [] })),
      ]);
      setLinkedWallets(walletsRes.wallets || []);
      setAttestations(attestRes.attestations || []);
    } catch {
      // Blockchain may not be enabled — ignore silently.
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleLink() {
    if (!isConnected || !address) return;
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const challenge = await api.walletChallenge(address);
      const signature = await signMessageAsync({ message: challenge.message });
      const result = await api.walletVerify(challenge.linkId, signature);
      setSuccess(`Wallet ${shortenAddress(result.wallet.wallet_address)} linked successfully.`);
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to link wallet");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlink(walletId) {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await api.attestationRevokeAllForWallet(walletId).catch(() => {});
      await api.walletUnlink(walletId);
      setSuccess("Wallet unlinked.");
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to unlink wallet");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetPrimary(walletId) {
    setError("");
    try {
      await api.walletSetPrimary(walletId);
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to set primary wallet");
    }
  }

  async function handleIssueVerifiedHuman(walletLinkId) {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const result = await api.attestVerifiedHuman(walletLinkId);
      setSuccess(`VerifiedHumanWallet attestation issued. UID: ${shortenHash(result.attestation.attestation_uid)}`);
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to issue attestation");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(uid) {
    setError("");
    setLoading(true);
    try {
      await api.attestationRevoke(uid);
      setSuccess("Attestation revoked.");
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to revoke attestation");
    } finally {
      setLoading(false);
    }
  }

  const activeWallets = linkedWallets.filter((w) => w.status === "active");
  const alreadyLinkedAddress =
    address &&
    activeWallets.some(
      (w) => w.wallet_address.toLowerCase() === address.toLowerCase(),
    );

  const connectedLinkedWallet = address
    ? activeWallets.find(
        (w) => w.wallet_address.toLowerCase() === address.toLowerCase(),
      )
    : null;

  return (
    <div className="page-grid">

      <button className="back-link" onClick={() => navigate("/home")}>
        ← Back
      </button>

      {error && (
        <div className="surface-block surface-block--danger">
          <p className="page-copy" style={{ margin: 0 }}>{error}</p>
        </div>
      )}
      {success && (
        <div className="surface-block surface-block--success">
          <p className="page-copy" style={{ margin: 0 }}>{success}</p>
        </div>
      )}

      {/* ── Connect wallet ──────────────────────────────────────── */}
      <section className="stack">
        <div className="page-header">
          <div>
            <h2 className="section-title" style={{ fontSize: "1.4rem" }}>Connect wallet</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Link an EVM wallet to receive on-chain attestations on Base.
            </p>
          </div>
        </div>

        {isConnected ? (
          <div className="stack">
            <div className="surface-block">
              <p className="page-copy" style={{ margin: 0 }}>
                <strong>{shortenAddress(address)}</strong>
                {chain ? (
                  <span className="muted"> · {chain.name}</span>
                ) : null}
              </p>
            </div>
            {alreadyLinkedAddress ? null : (
              <button
                className="action-card"
                onClick={handleLink}
                disabled={loading}
              >
                <span className="action-card__kicker">Wallet</span>
                <span className="action-card__title">
                  {loading ? "Linking..." : "Link this wallet"}
                </span>
              </button>
            )}
            {connectedLinkedWallet ? (
              <button
                className="action-card"
                onClick={() => handleUnlink(connectedLinkedWallet.id)}
                disabled={loading}
              >
                <span className="action-card__kicker">Wallet</span>
                <span className="action-card__title">Unlink wallet</span>
              </button>
            ) : (
              <button className="action-card" onClick={() => disconnect()}>
                <span className="action-card__kicker">Wallet</span>
                <span className="action-card__title">Disconnect</span>
              </button>
            )}
          </div>
        ) : (
          <div className="stack">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                className="action-card"
                onClick={() => connect({ connector })}
              >
                <span className="action-card__kicker">Wallet</span>
                <span className="action-card__title">{connector.name}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Linked wallets ──────────────────────────────────────── */}
      {linkedWallets.length > 0 && (
        <section className="stack">
          <div className="page-header">
            <h2 className="section-title" style={{ fontSize: "1.4rem" }}>Linked wallets</h2>
          </div>
          <div className="stack">
            {linkedWallets.map((w) => (
              <div key={w.id} className="stack">
                <div className="surface-block">
                  <div className="list-item__title">
                    {shortenAddress(w.wallet_address)}
                    {w.is_primary && (
                      <span className="pill" style={{ marginLeft: "0.5rem" }}>primary</span>
                    )}
                  </div>
                  <div className="list-item__subtitle">
                    Chain {w.chain_id}
                    {w.linked_at ? ` · Linked ${new Date(w.linked_at).toLocaleDateString()}` : ""}
                  </div>
                </div>
                {w.status === "active" && (
                  <>
                    <button
                      className="action-card"
                      onClick={() => handleIssueVerifiedHuman(w.id)}
                      disabled={loading}
                    >
                      <span className="action-card__kicker">On-chain</span>
                      <span className="action-card__title">Issue attestation</span>
                    </button>
                    {!w.is_primary && (
                      <button
                        className="action-card"
                        onClick={() => handleSetPrimary(w.id)}
                      >
                        <span className="action-card__kicker">Wallet</span>
                        <span className="action-card__title">Set as primary</span>
                      </button>
                    )}
                    <button
                      className="action-card"
                      onClick={() => handleUnlink(w.id)}
                      disabled={loading}
                    >
                      <span className="action-card__kicker">Wallet</span>
                      <span className="action-card__title">Unlink wallet</span>
                    </button>
                  </>
                )}
                {w.status === "revoked" && (
                  <span className="status-tag status-tag--failed">Unlinked</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Attestations ────────────────────────────────────────── */}
      {attestations.length > 0 && (
        <section className="stack">
          <div className="page-header">
            <h2 className="section-title" style={{ fontSize: "1.4rem" }}>Attestations</h2>
          </div>
          <div className="stack">
            {attestations.map((a) => (
              <div key={a.id} className="stack">
                <div className="surface-block">
                  <div className="list-item__title">
                    {a.attestation_type === "verified_human_wallet"
                      ? "Verified Human"
                      : "Presence Checkpoint"}
                    {a.source && (
                      <span className="muted" style={{ marginLeft: "0.5rem", fontWeight: 400 }}>
                        via {a.source}
                      </span>
                    )}
                    <span className="pill" style={{ marginLeft: "0.5rem" }}>
                      {a.active ? "Active" : a.revoked ? "Revoked" : "Expired"}
                    </span>
                  </div>
                  <div className="list-item__subtitle">
                    {new Date(a.created_at).toLocaleDateString()}
                    {a.expires_at ? ` · Expires ${new Date(a.expires_at).toLocaleDateString()}` : ""}
                  </div>
                  <div className="list-item__subtitle" style={{ marginTop: "6px" }}>
                    <a
                      href={`https://base.easscan.org/attestation/view/${a.attestation_uid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontFamily: '"SF Mono", "Menlo", monospace',
                        fontSize: "0.78rem",
                        wordBreak: "break-all",
                        color: "var(--muted)",
                      }}
                    >
                      {a.attestation_uid}
                    </a>
                  </div>
                </div>
                {a.active && !a.revoked && (
                  <button
                    className="action-card"
                    onClick={() => handleRevoke(a.attestation_uid)}
                    disabled={loading}
                  >
                    <span className="action-card__kicker">On-chain</span>
                    <span className="action-card__title">Revoke attestation</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function shortenAddress(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function shortenHash(hash) {
  if (!hash) return "";
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}
