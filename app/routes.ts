import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/_app.tsx", [
    index("routes/landing.tsx"),
    route("browse", "routes/browse.tsx"),
    route("l/:id", "routes/listing.tsx"),
    route("l/:id/buy", "routes/buy.tsx"),
    route("deals", "routes/deals.tsx"),
    route("d/:id", "routes/deal.tsx"),
    route("d/:id/pay", "routes/pay.tsx"),
    route("d/:id/code", "routes/release-code.tsx"),
    route("d/:id/enter-code", "routes/enter-code.tsx"),
    route("d/:id/report", "routes/report.tsx"),
    route("d/:id/evidence", "routes/evidence.tsx"),
    route("sell", "routes/sell.tsx"),
    route("sell/:id/details", "routes/sell-details.tsx"),
    route("sell/:id/share", "routes/sell-share.tsx"),
    route("account", "routes/account.tsx"),
    route("account/verify", "routes/verify.tsx"),
    route("notifications", "routes/notifications.tsx"),
    route("signin", "routes/signin.tsx"),
    route("signout", "routes/signout.tsx"),
    // Legal and help pages: one module, one route per document.
    ...["terms", "deal-terms", "privacy", "cookies", "prohibited-items", "safety"].map((slug) => route(slug, "routes/legal.tsx", { id: `legal-${slug}` })),
  ]),
  route("staff/signin", "routes/staff/signin.tsx"),
  route("staff/setup-2fa", "routes/staff/setup-2fa.tsx"),
  route("staff/signout", "routes/staff/signout.tsx"),
  layout("routes/staff/_layout.tsx", [
    route("staff", "routes/staff/queues.tsx"),
    route("staff/disputes/:id", "routes/staff/dispute.tsx"),
    route("staff/holds/:id", "routes/staff/hold.tsx"),
    route("staff/listings", "routes/staff/listings.tsx"),
    route("staff/users", "routes/staff/users.tsx"),
    route("staff/money", "routes/staff/money.tsx"),
    route("staff/audit", "routes/staff/audit.tsx"),
  ]),
] satisfies RouteConfig;
