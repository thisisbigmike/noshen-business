// Exports NosHen's Solana devnet keys so a wallet app (Phantom, Solflare) can import them. Writes them to
// .solana-devnet-keys.txt (never committed) and prints only the addresses.
//
// Usage: pnpm solana:keys               → NosHen's wallet and the demo wallet
//        pnpm solana:keys <deal id>     → also that deal's own USDC and USDT deposit addresses
import { readFileSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { createKeyPairSignerFromPrivateKeyBytes, getAddressEncoder, getBase58Decoder } from "@solana/kit";

const root = new URL("../../../", import.meta.url);
const vars = Object.fromEntries(readFileSync(new URL(".solana-devnet.vars", root), "utf8").split("\n")
  .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const dealId = process.argv[2];

/** A 32-byte secret → its address, plus the 64-byte secret key (secret + public key) in base58, as Phantom imports it. */
async function exportKey(label, seed) {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const pub = getAddressEncoder().encode(signer.address);
  const full = new Uint8Array(64);
  full.set(seed, 0);
  full.set(pub, 32);
  return { label, address: signer.address, base58: getBase58Decoder().decode(full), json: JSON.stringify(Array.from(full)) };
}
const fromB64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));
// The same derivation as the site (packages/engine/src/partner/solana.ts): HMAC-SHA256 of the deal with the deposit secret.
const depositSeed = (coin) => new Uint8Array(createHmac("sha256", vars.SOLANA_DEPOSIT_SECRET).update(`noshen:solana-deposit:v1:${coin}:${dealId}`).digest());

const keys = [
  await exportKey("NosHen's wallet (pays fees, receives released coin, mints the test tokens)", fromB64(vars.SOLANA_WALLET)),
  await exportKey("Demo wallet (behind \"Send from NosHen's demo wallet\")", fromB64(vars.SOLANA_DEMO_WALLET)),
  ...(dealId ? [
    await exportKey(`Deal ${dealId}: USDC deposit address`, depositSeed("usdc")),
    await exportKey(`Deal ${dealId}: USDT deposit address`, depositSeed("usdt")),
  ] : []),
];

const out = [
  "NosHen Solana DEVNET keys. Private: never share, commit or paste these anywhere. Devnet only (test tokens, no real money).",
  "Import into Phantom: Add account → Import Private Key → paste the base58 key. Set Phantom to Devnet to see the test tokens.",
  "Solflare/CLI: use the JSON array form.",
  `Test USDC mint: ${vars.SOLANA_USDC_MINT}`,
  `Test USDT mint: ${vars.SOLANA_USDT_MINT}`,
  "",
  ...keys.flatMap((k) => [k.label, `  address:            ${k.address}`, `  private key base58: ${k.base58}`, `  private key JSON:   ${k.json}`, ""]),
].join("\n");
writeFileSync(new URL(".solana-devnet-keys.txt", root), out, { mode: 0o600 });
for (const k of keys) console.log(`${k.label}\n  ${k.address}\n  https://explorer.solana.com/address/${k.address}?cluster=devnet`);
console.log("\nPrivate keys written to .solana-devnet-keys.txt (not shown here, never committed).");
