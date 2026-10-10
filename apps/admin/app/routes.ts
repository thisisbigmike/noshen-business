import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

// The staff site (admin.noshen.com in production). Every page inside the layout needs a signed-in staff member.
export default [
  route("signin", "routes/signin.tsx"),
  route("setup-2fa", "routes/setup-2fa.tsx"),
  route("signout", "routes/signout.tsx"),
  layout("routes/_layout.tsx", [
    index("routes/dashboard.tsx"),
    route("listings", "routes/listings.tsx"),
    route("users", "routes/users.tsx"),
    route("disputes/:id", "routes/dispute.tsx"),
    route("holds/:id", "routes/hold.tsx"),
    route("money", "routes/money.tsx"),
    route("audit", "routes/audit.tsx"),
  ]),
] satisfies RouteConfig;
