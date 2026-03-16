// ── wagmi configuration ──────────────────────────────────────────────────────
// Minimal config for wallet connection on Base / Base Sepolia.
// Used only on the optional wallet-linking page — does not affect core flows.

import { http, createConfig } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: [injected()],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
});
