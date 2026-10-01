export const PLAN_CATALOG = {
  free: {
    label: "Free",
    description: "Personal automation for getting started.",
    price: "$0",
    period: "/mo",
    limits: ["3 workflows", "250 executions per day", "15 nodes per workflow"],
    features: ["Core integrations", "No shared workspaces", "No invitations", "No advanced RBAC"],
  },
  starter: {
    label: "Starter",
    description: "Shared workspaces for small teams.",
    price: "$15",
    period: "/mo",
    limits: ["25 workflows", "20,000 executions per month", "60 nodes per workflow"],
    features: ["Core and advanced integrations", "Shared workspaces and projects", "Member invitations", "No granular workflow permissions"],
  },
  pro: {
    label: "Pro",
    description: "Advanced automation and full team controls.",
    price: "$99",
    period: "/mo",
    limits: ["9,999 workflows", "150,000 executions per month", "200 nodes per workflow"],
    features: ["AI, Code, Database, Loops, Merge", "Owner/Admin/Member roles", "Viewer/Editor workflow permissions", "Audit log and advanced security", "Managed backups and priority support"],
  },
};

export const PLAN_ORDER = ["free", "starter", "pro"];
