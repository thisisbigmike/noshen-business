export interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
  checkoutUrl?: string;
  txHash?: string;
  trackingId?: string;
  error?: string;
}

export interface PlatformProduct {
  id: string;
  title: string;
  price: number;
  currency: string;
  url: string;
  vendor?: string;
  platform: "shopify" | "stripe" | "ebay" | "aliexpress" | "coinbase" | "skyfire" | "noshen";
}
