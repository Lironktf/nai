// ── Ethers provider + issuer signer ──────────────────────────────────────────
// Lazy-initialised so the server boots fine even when blockchain is disabled.

import { ethers } from "ethers";
import { getChainConfig } from "./config.js";

let _provider = null;
let _signer = null;

export function getProvider() {
  if (!_provider) {
    const chain = getChainConfig();
    _provider = new ethers.JsonRpcProvider(chain.rpcUrl, {
      name: chain.name,
      chainId: chain.chainId,
    });
  }
  return _provider;
}

export function getIssuerSigner() {
  if (!_signer) {
    const pk = process.env.BLOCKCHAIN_ISSUER_PRIVATE_KEY;
    if (!pk) {
      throw new Error(
        "BLOCKCHAIN_ISSUER_PRIVATE_KEY is required when blockchain is enabled",
      );
    }
    _signer = new ethers.Wallet(pk, getProvider());
  }
  return _signer;
}

export function getIssuerAddress() {
  return getIssuerSigner().address;
}
