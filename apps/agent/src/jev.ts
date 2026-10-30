/**
 * Jev AI (TypeSafe AI) "System One": a fast fraud-risk rating for a deal, from TypeSafe's API.
 * It needs JEV_API_KEY (or TYPESAFE_API_KEY); without one the agent doesn't offer the check.
 */

const apiKey = () => process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY || "";
export const jevConfigured = () => apiKey().startsWith("jv_");

export interface JevDecision {
  verdict: "APPROVE" | "REVIEW" | "BLOCK_SCAM";
  risk: "low" | "medium" | "high";
  reason: string;
  latencyMs: number;
}

const VERDICTS = {
  low: { verdict: "APPROVE", reason: "Jev rated the fraud risk low: a normal market price, a verified vendor and a standard item." },
  medium: { verdict: "REVIEW", reason: "Jev rated the fraud risk medium: a slight anomaly, a new seller or a high value. Check before paying." },
  high: { verdict: "BLOCK_SCAM", reason: "Jev rated the fraud risk high: an unrealistic price, counterfeit risk or a fake listing." },
} as const;

export async function evaluateRiskWithJev(state: {
  title: string;
  priceUsd: number;
  platform: string;
  sellerDetails?: string;
}): Promise<JevDecision> {
  const start = Date.now();
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    // A slow risk check should not hold up the reply for long.
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({
      model: "jev-latest",
      state: JSON.stringify(state),
      questions: {
        fraud_risk: {
          type: "choice",
          instructions: "Evaluate the risk of fraud, scam, or extreme price anomaly for this transaction",
          criteria: {
            low: "Normal market price, verified vendor, standard item",
            medium: "Slight anomaly, new seller, high value",
            high: "Unrealistic price (e.g. new iPhone for $50), counterfeit risk, fake listing",
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`Jev AI answered ${response.status}`);

  const json: any = await response.json();
  const risk = json?.decisions?.fraud_risk?.choice as JevDecision["risk"];
  if (!(risk in VERDICTS)) throw new Error("Jev AI gave no risk rating");
  return { risk, ...VERDICTS[risk], latencyMs: Date.now() - start };
}
