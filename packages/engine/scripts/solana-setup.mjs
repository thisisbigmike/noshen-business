// Sets up NosHen's Solana wallet on devnet, once: NosHen's wallet (pays every network fee, holds released coin), the
// demo wallet (behind "Send from NosHen's demo wallet"), the secret that turns each deal into its own address, and
// NosHen's test USDC and USDT tokens (6 decimals, minted by NosHen's wallet). Safe to run again: it keeps what's there.
//
// Usage: pnpm solana:setup     → writes .solana-devnet.vars (never committed; the keys are never printed)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  address, appendTransactionMessageInstructions, createKeyPairSignerFromPrivateKeyBytes, createSolanaRpc, createTransactionMessage,
  generateKeyPairSigner, getBase64EncodedWireTransaction, getSignatureFromTransaction, lamports, pipe,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS, getInitializeMint2Instruction, getMintSize } from "@solana-program/token";

const FILE = new URL("../../../.solana-devnet.vars", import.meta.url);
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(RPC_URL);

const vars = {};
if (existsSync(FILE)) for (const line of readFileSync(FILE, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) vars[m[1]] = m[2].trim();
}
const save = () => writeFileSync(FILE, [
  "# NosHen's Solana devnet setup (pnpm solana:setup). Secrets: never commit or paste this file.",
  ...Object.entries(vars).map(([k, v]) => `${k}=${v}`), "",
].join("\n"), { mode: 0o600 });
const newSecret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const signerOf = (b64) => createKeyPairSignerFromPrivateKeyBytes(Uint8Array.from(Buffer.from(b64, "base64")));
const explorer = (kind, id) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

vars.SOLANA_RPC_URL ??= RPC_URL;
vars.SOLANA_WALLET ??= newSecret();
vars.SOLANA_DEMO_WALLET ??= newSecret();
vars.SOLANA_DEPOSIT_SECRET ??= newSecret();
save();
const wallet = await signerOf(vars.SOLANA_WALLET);
const demo = await signerOf(vars.SOLANA_DEMO_WALLET);
console.log(`NosHen's wallet: ${wallet.address}\n  ${explorer("address", wallet.address)}`);
console.log(`Demo wallet:     ${demo.address}`);

async function confirm(sig, what) {
  for (let i = 0; i < 60; i++) {
    const { value } = await rpc.getSignatureStatuses([sig]).send();
    const s = value[0];
    if (s?.err) throw new Error(`${what} failed: ${JSON.stringify(s.err, (_, v) => typeof v === "bigint" ? String(v) : v)}`);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${what}: not confirmed after a minute`);
}

async function send(instructions, what) {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(wallet, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const tx = await signTransactionMessageWithSigners(message);
  const sig = getSignatureFromTransaction(tx);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", preflightCommitment: "confirmed" }).send();
  await confirm(sig, what);
  return sig;
}

// SOL for network fees: devnet hands it out free (it often limits how much and how often).
const { value: balance } = await rpc.getBalance(wallet.address, { commitment: "confirmed" }).send();
console.log(`SOL for fees:    ${Number(balance) / 1e9}`);
if (balance < 500_000_000n) {
  try {
    const sig = await rpc.requestAirdrop(wallet.address, lamports(1_000_000_000n), { commitment: "confirmed" }).send();
    await confirm(sig, "the airdrop");
    console.log("Airdropped 1 devnet SOL.");
  } catch (e) {
    console.error(`\nDevnet wouldn't airdrop SOL right now (${String(e.message ?? e).slice(0, 120)}).`);
    console.error(`Get some at https://faucet.solana.com for ${wallet.address}, then run this again.`);
    process.exit(2);
  }
}

// NosHen's test USDC and USDT: 6 decimals like the real ones, minted only by NosHen's wallet.
for (const coin of ["USDC", "USDT"]) {
  const key = `SOLANA_${coin}_MINT`;
  if (vars[key]) {
    const info = await rpc.getAccountInfo(address(vars[key]), { encoding: "base64" }).send();
    if (info.value) { console.log(`Test ${coin}:       ${vars[key]}`); continue; }
  }
  const mint = await generateKeyPairSigner();
  const space = BigInt(getMintSize());
  const rent = await rpc.getMinimumBalanceForRentExemption(space).send();
  await send([
    getCreateAccountInstruction({ payer: wallet, newAccount: mint, lamports: rent, space, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeMint2Instruction({ mint: mint.address, decimals: 6, mintAuthority: wallet.address }),
  ], `creating test ${coin}`);
  vars[key] = mint.address;
  save();
  console.log(`Test ${coin}:       ${mint.address} (new)\n  ${explorer("address", mint.address)}`);
}
console.log("\nSaved to .solana-devnet.vars. Secrets in it: SOLANA_WALLET, SOLANA_DEMO_WALLET, SOLANA_DEPOSIT_SECRET.");
