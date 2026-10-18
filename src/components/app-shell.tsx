"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, BadgeCheck, Bell, Building2, CalendarDays, Check, ChevronDown, ClipboardCheck, Clock3, CreditCard, Download, FileCheck2, FileText, Filter, LayoutDashboard, LogOut, Plus, Receipt, Search, Settings, ShieldCheck, Truck, Users, Wallet, X, ScrollText } from "lucide-react";
import { GstinStatus } from "@/components/gstin-status";
import { InvoiceCapture } from "@/components/invoice-capture";
import { BillLineItemsEditor, billLineSubtotal, type BillLineItemDraft } from "@/components/bill-line-items-editor";
import type { InvoiceSuggestions } from "@/lib/invoice-ocr";
import { validateGstin } from "@/lib/gstin";

type User = { id: string; name: string; email: string; role: "TEAM_1" | "TEAM_2" | "ADMIN" };
type Branding = { companyName: string; companyLogoUrl: string };
type Bill = { id: string; billNumber: string; currentStatus: string; totalAmount: string; billDate: string; createdAt: string; vendor: { id: string; name: string }; project: { id: string; name: string; code?: string }; createdBy?: { id: string; name: string }; payment?: { paidAmount: string; utrNumber?: string | null; paymentReference?: string | null; paidBy?: { id: string; name: string } } | null; history?: Array<{ action: string; userId: string; user: { name: string } }> };
type Project = { id: string; name: string; code: string; location: string; status: string; _count?: { bills: number } };
type Vendor = { id: string; name: string; companyName?: string; gstin?: string; gstRegistered?: boolean; mobile?: string; email?: string; active: boolean; _count?: { bills: number } };
type AutoBillField = "billNumber" | "billDate" | "billAmount" | "gstAmount" | "vendorId" | "vendorContact" | "vendorEmail";
type AutoBillFields = Partial<Record<AutoBillField, string>>;
type Notification = { id: string; title: string; message: string; href?: string; readAt?: string; createdAt: string };
type Kpis = { totalBills: number; drafts: number; submitted: number; underVerification: number; pendingAdmin: number; approved: number; rejected: number; paymentPending: number; paidBills: number; duplicates: number; totalAmount: string; paidAmount: string; pendingAmount: string; unread: number };
type SettingsData = { companyName: string; companyLogoUrl: string; supportEmail: string; currency: string; billNumberFormat: string; gstEnabled: boolean; notificationsEnabled: boolean };
type Audit = { id: string; bill?: { billNumber: string } | null; userName: string; role: string; action: string; previous?: string; next?: string; remarks?: string; ipAddress?: string; createdAt: string };

const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "WORKSPACE" },
  { id: "bills", label: "All bills", icon: Receipt, group: "WORKSPACE" },
  { id: "verification", label: "Pending verification", icon: ClipboardCheck, role: ["TEAM_2"], group: "WORKFLOW" },
  { id: "approval", label: "Pending approval", icon: ShieldCheck, role: ["ADMIN"], group: "WORKFLOW" },
  { id: "payment", label: "Payment pending", icon: CreditCard, role: ["TEAM_2"], group: "WORKFLOW" },
  { id: "paid", label: "Paid bills", icon: BadgeCheck, group: "WORKFLOW" },
  { id: "projects", label: "Projects", icon: Building2, group: "MANAGE" },
  { id: "vendors", label: "Vendors", icon: Truck, group: "MANAGE" },
  { id: "reports", label: "Reports", icon: BarChart3, role: ["ADMIN", "TEAM_2"], group: "INSIGHTS" },
  { id: "notifications", label: "Notifications", icon: Bell, group: "INSIGHTS" },
  { id: "users", label: "User management", icon: Users, role: ["ADMIN"], group: "ADMINISTRATION" },
  { id: "settings", label: "Settings", icon: Settings, role: ["ADMIN"], group: "ADMINISTRATION" },
  { id: "audit", label: "Audit log", icon: ScrollText, role: ["ADMIN"], group: "ADMINISTRATION" },
];
const defaultBranding: Branding = { companyName: "J.P. PROJECTS", companyLogoUrl: "/jp-projects-logo.jpeg" };
let currentCurrency = "INR";

async function api<T = any>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: options?.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options?.headers }, credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request could not be completed.");
  return body as T;
}
const money = (value: string | number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: currentCurrency, maximumFractionDigits: 0 }).format(Number(value || 0));
const shortDate = (value?: string) => value ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—";
const initials = (value: string) => value.split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
const roleLabel = (role: string) => role === "TEAM_1" ? "Bill entry team" : role === "TEAM_2" ? "Verification & payment" : "Administrator";
const vendorHasGst = (vendor?: Vendor) => vendor?.gstRegistered ?? Boolean(vendor?.gstin);
const sameLineItems = (left: BillLineItemDraft[], right: BillLineItemDraft[]) => JSON.stringify(left) === JSON.stringify(right);
function Status({ value }: { value: string }) {
  const css = value === "SUBMITTED" ? "submitted" : ["TEAM_2_REVIEW"].includes(value) ? "review" : ["ADMIN_PENDING"].includes(value) ? "admin" : ["ADMIN_APPROVED"].includes(value) ? "approved" : ["ADMIN_REJECTED"].includes(value) ? "rejected" : ["PAYMENT_PENDING"].includes(value) ? "payment" : value === "PAID" ? "paid" : value === "DUPLICATE" ? "duplicate" : value === "CORRECTION_REQUIRED" ? "correction" : "neutral";
  const label = value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return <span className={`status ${css}`}>{label}</span>;
}

export default function AppShell() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [branding, setBranding] = useState<Branding>(defaultBranding);
  const [authChecked, setAuthChecked] = useState(false);
  const [active, setActive] = useState("overview");
  const [bills, setBills] = useState<Bill[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [search, setSearch] = useState("");
  const [bellOpen, setBellOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(async (currentUser: User) => {
    setLoading(true);
    try {
      const [dash, billData, projectData, vendorData, notificationData] = await Promise.all([
        api<{ kpis: Kpis; currency?: string }>("/api/dashboard"), api<{ bills: Bill[] }>("/api/bills"), api<{ projects: Project[] }>("/api/projects"),
        api<{ vendors: Vendor[] }>("/api/vendors"), api<{ notifications: Notification[] }>("/api/notifications"),
      ]);
      currentCurrency = dash.currency || "INR"; setKpis(dash.kpis); setBills(billData.bills); setProjects(projectData.projects); setVendors(vendorData.vendors); setNotifications(notificationData.notifications);
      if (currentUser.role === "ADMIN") {
        const [userData, settingData, auditData] = await Promise.all([api<{ users: any[] }>("/api/users"), api<{ settings: SettingsData }>("/api/settings"), api<{ logs: Audit[] }>("/api/audit")]);
        setUsers(userData.users); setSettings(settingData.settings); setAudit(auditData.logs);
      }
    } catch (error) { showToast(error instanceof Error ? error.message : "Could not load workspace data."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void api<{ branding: Branding }>("/api/branding").then((result) => setBranding({ ...defaultBranding, ...result.branding })).catch(() => undefined);
    api<{ user: User }>("/api/auth/session").then((r) => { setUser(r.user); return refresh(r.user); }).catch(() => setUser(null)).finally(() => setAuthChecked(true));
  }, [refresh]);
  useEffect(() => { if (user && reloadKey) void refresh(user); }, [reloadKey, refresh, user]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      api<{ bills: Bill[] }>(`/api/bills${q}`, { signal: controller.signal }).then((result) => setBills(result.bills)).catch((error) => { if (!controller.signal.aborted) console.error(error); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, user]);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(""), 4000); return () => window.clearTimeout(timeout); }, [toast]);
  function showToast(message: string) { setToast(message); }

  const filteredBills = useMemo(() => {
    let rows = bills;
    if (active === "verification") rows = rows.filter((b) => b.currentStatus === "SUBMITTED");
    if (active === "approval") rows = rows.filter((b) => b.currentStatus === "ADMIN_PENDING");
    if (active === "payment") rows = rows.filter((b) => b.currentStatus === "PAYMENT_PENDING");
    if (active === "paid") rows = rows.filter((b) => b.currentStatus === "PAID");
    if (search.trim()) { const term = search.toLowerCase(); rows = rows.filter((b) => [b.billNumber, b.vendor.name, b.project.name, b.createdBy?.name, b.payment?.utrNumber, b.payment?.paymentReference].some((v) => v?.toLowerCase().includes(term))); }
    return rows;
  }, [bills, active, search]);

  if (!authChecked) return <div className="login-page"><div className="login-side"><div className="login-card"><Brand branding={branding} /><p className="muted">Loading your secure workspace…</p></div></div></div>;
  if (!user) return <Login branding={branding} onLogin={(u) => { setUser(u); void refresh(u); }} />;

  const currentNav = nav.find((item) => item.id === active);
  const titles: Record<string, [string, string]> = {
    overview: ["Good morning", "Here’s what’s moving across your projects today."], bills: ["All bills", "Search, filter and follow each bill through its approval journey."],
    verification: ["Pending verification", "Review supporting documents and send verified bills forward."], approval: ["Pending approval", "Final decisions waiting for your review."], payment: ["Payment pending", "Approved bills ready for payment processing."], paid: ["Paid bills", "Completed payments and their transaction references."],
    projects: ["Projects", "Keep project details and bill activity in one place."], vendors: ["Vendors", "Your contractor and supplier directory."], reports: ["Reports & exports", "A clear view of bill exposure and completed payments."],
    notifications: ["Notifications", "Status changes and actions that need your attention."], users: ["User management", "Manage access for your finance and project teams."], settings: ["Company settings", "Set the defaults used by your bill workflow."], audit: ["Audit log", "A time-stamped record of bill and payment activity."], new: ["Create new bill", "Enter bill details and attach the original supporting document."],
  };
  const title = titles[active] || titles.overview;
  const setView = (id: string) => { setActive(id); setSearch(""); window.scrollTo({ top: 0, behavior: "smooth" }); };
  async function logout() { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); setUser(null); setActive("overview"); }
  async function markAllRead() { try { await api("/api/notifications", { method: "POST", body: JSON.stringify({ all: true }) }); setNotifications((n) => n.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() }))); setKpis((k) => k ? { ...k, unread: 0 } : k); } catch (e) { showToast((e as Error).message); } }

  return <div className="app-layout">
    <aside className="sidebar"><Brand branding={branding} />
      {Array.from(new Set(nav.filter((item) => !item.role || item.role.includes(user.role)).map((item) => item.group))).map((group) => <div key={group}>
        <div className="nav-label">{group}</div><div className="nav-list">{nav.filter((item) => item.group === group && (!item.role || item.role.includes(user.role))).map((item) => {
          const Icon = item.icon; const count = item.id === "verification" ? kpis?.submitted : item.id === "approval" ? kpis?.pendingAdmin : item.id === "payment" ? kpis?.paymentPending : item.id === "notifications" ? kpis?.unread : 0;
          return <button key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => setView(item.id)}><Icon />{item.label}{count ? <span className="nav-count">{count > 99 ? "99+" : count}</span> : null}</button>;
        })}</div>
      </div>)}
      <div className="sidebar-bottom"><div className="help-card"><strong>Need a hand?</strong><p>Reach your finance administrator for workflow or access support.</p></div><div className="user-mini"><div className="avatar">{initials(user.name)}</div><div><div className="user-mini-name">{user.name}</div><div className="user-mini-role">{roleLabel(user.role)}</div></div></div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="mobile-brand"><span className="mobile-logo"><img src={branding.companyLogoUrl || defaultBranding.companyLogoUrl} alt="" /></span>{branding.companyName}</div><label className="global-search"><Search /><input placeholder="Search bills, vendors, projects, UTR…" value={search} onChange={(e) => setSearch(e.target.value)} /><kbd>⌘ K</kbd></label>
        <div className="topbar-right"><div style={{ position: "relative" }}><button className="icon-button" aria-label="Notifications" onClick={() => setBellOpen((v) => !v)}><Bell />{(kpis?.unread || 0) > 0 && <span className="badge-dot" />}</button>{bellOpen && <NotificationDropdown notifications={notifications} markAllRead={markAllRead} go={(href) => { setBellOpen(false); href && router.push(href); }} />}</div><div className="top-user"><div className="avatar">{initials(user.name)}</div><div className="top-user-copy"><div className="top-user-name">{user.name}</div><div className="top-user-role">{roleLabel(user.role)}</div></div><button aria-label="Log out" className="icon-button" onClick={logout}><LogOut /></button></div></div>
      </header>
      <main className="content">
        <div className="page-head"><div><p className="eyebrow">BUILDING FINANCE · {new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "2-digit", month: "long" }).toUpperCase()}</p><h1 className="page-title">{active === "overview" ? `${title[0]}, ${user.name.split(" ")[0]}` : title[0]}</h1><p className="page-subtitle">{title[1]}</p></div><div className="head-actions">{active === "overview" && user.role !== "TEAM_1" && <button className="button" onClick={() => window.open("/api/reports?format=csv", "_blank")}><Download /> Export report</button>}{user.role === "TEAM_1" && ["overview", "bills"].includes(active) && <button className="button primary" onClick={() => setView("new")}><Plus /> New bill</button>}{loading && <span className="muted" style={{ fontSize: 9 }}>Updating…</span>}</div></div>
        {active === "overview" && <Overview kpis={kpis} bills={bills} projects={projects} user={user} setView={setView} />}
        {["bills", "verification", "approval", "payment", "paid"].includes(active) && <BillList active={active} bills={filteredBills} projects={projects} vendors={vendors} setReload={() => setReloadKey((n) => n + 1)} />}
        {active === "new" && <NewBill projects={projects} vendors={vendors} user={user} showToast={showToast} onDone={(id) => { void refresh(user); router.push(`/bills/${id}`); }} onCancel={() => setView("bills")} />}
        {active === "projects" && <ProjectsView projects={projects} user={user} showToast={showToast} refresh={() => setReloadKey((n) => n + 1)} />}
        {active === "vendors" && <VendorsView vendors={vendors} user={user} showToast={showToast} refresh={() => setReloadKey((n) => n + 1)} />}
        {active === "reports" && <ReportsView projects={projects} />}
        {active === "notifications" && <NotificationsView notifications={notifications} markAllRead={markAllRead} />}
        {active === "users" && <UsersView users={users} showToast={showToast} refresh={() => setReloadKey((n) => n + 1)} />}
        {active === "settings" && settings && <SettingsView settings={settings} setSettings={setSettings} showToast={showToast} onBrandingChange={setBranding} />}
        {active === "audit" && <AuditView logs={audit} />}
      </main>
    </div>
    <nav className="mobile-nav">{["overview", "bills", user.role === "ADMIN" ? "approval" : user.role === "TEAM_2" ? "verification" : "new", "notifications"].map((id) => { const item = nav.find((n) => n.id === id); const Icon = item?.icon || Plus; return <button className={active === id ? "active" : ""} key={id} onClick={() => setView(id)}><Icon />{id === "new" ? "New bill" : item?.label.split(" ")[0]}</button>; })}</nav>
    {toast && <div role="status" className="toast">{toast}</div>}
  </div>;
}

function Brand({ branding }: { branding: Branding }) { return <div className="brand"><span className="brand-logo-window"><img src={branding.companyLogoUrl || defaultBranding.companyLogoUrl} alt={`${branding.companyName || defaultBranding.companyName} logo`} /></span><div><span className="brand-name">{branding.companyName || defaultBranding.companyName}</span><span className="brand-sub">BILL MANAGEMENT</span></div></div>; }

const demoAccounts = [
  { name: "Ananya Kapoor", role: "Admin · Final approval", email: "admin@buildflow.local" },
  { name: "Aarav Mehta", role: "Team 1 · Bill entry", email: "team11@buildflow.local" },
  { name: "Riya Nair", role: "Team 2 · Verification & payment", email: "team21@buildflow.local" },
];

function Login({ onLogin, branding }: { onLogin: (user: User) => void; branding: Branding }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setPending(true); setError(""); try { const result = await api<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email: email.trim().toLowerCase(), password }) }); onLogin(result.user); } catch (e) { setError((e as Error).message); } finally { setPending(false); } }
  return <div className="login-page"><section className="login-art"><Brand branding={branding} /><div className="login-art-copy"><p className="eyebrow" style={{ color: "#f1a552" }}>PROJECT FINANCE WORKSPACE</p><h1>Every project bill,<br />clearly accounted for.</h1><p>Review materials, track approvals and keep each project payment documented in one place.</p></div><div className="login-foot">© 2026 {branding.companyName} · Finance workspace</div></section><section className="login-side"><form className="login-card" onSubmit={submit}><Brand branding={branding} /><p className="eyebrow">SECURE WORKSPACE</p><h2>Welcome back</h2><p className="intro">Sign in with the work email and initial password provided by your administrator.</p>{error && <div className="alert error">{error}</div>}<div className="field"><label>Work email</label><input type="email" autoComplete="username" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></div><div className="field"><label>Password</label><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div><button className="button primary" disabled={pending}>{pending ? "Signing in…" : "Sign in securely"}</button><p className="field-hint">If you don’t have your initial password or can’t sign in, contact your administrator.</p><section className="demo-accounts" aria-label="Demo login credentials"><div className="demo-accounts-head"><div><strong>Demo login credentials</strong><span>Shared demo password: <code>Demo123!</code></span></div><span className="demo-badge">DEMO ONLY</span></div><p className="demo-warning">Public demo access: anyone can sign in and change demo records. Never use these accounts for company or financial data.</p><div className="demo-account-list">{demoAccounts.map((account) => <div className="demo-account-row" key={account.email}><div className="demo-account-copy"><strong>{account.role}</strong><span>{account.name} · {account.email}</span></div><button className="button small" type="button" onClick={() => { setEmail(account.email); setPassword("Demo123!"); setError(""); }}>Use</button></div>)}</div></section></form></section></div>;
}

function Overview({ kpis, bills, projects, user, setView }: { kpis: Kpis | null; bills: Bill[]; projects: Project[]; user: User; setView: (v: string) => void }) {
  const max = Math.max(1, ...projects.map((p) => bills.filter((b) => b.project.id === p.id).reduce((sum, b) => sum + Number(b.totalAmount), 0)));
  const stats = [
    ["Total bills", kpis?.totalBills || 0, <FileText key="a" />, `${kpis?.drafts || 0} drafts`],
    ["Pending review", (kpis?.submitted || 0) + (kpis?.underVerification || 0) + (kpis?.pendingAdmin || 0), <Clock3 key="b" />, `${kpis?.pendingAdmin || 0} awaiting admin`],
    ["Payment pending", kpis?.paymentPending || 0, <Wallet key="c" />, "Approved and ready"],
    ["Total paid", money(kpis?.paidAmount || "0"), <BadgeCheck key="d" />, `${kpis?.paidBills || 0} bills completed`],
  ] as const;
  const queued = bills.filter((b) => ["SUBMITTED", "ADMIN_PENDING", "PAYMENT_PENDING", "CORRECTION_REQUIRED"].includes(b.currentStatus)).slice(0, 6);
  return <>
    <section className="kpi-grid">{stats.map(([label, value, icon, foot]) => <div className="kpi-card" key={label}><div className="kpi-top"><span className="kpi-label">{label}</span><span className="kpi-icon">{icon}</span></div><div className="kpi-value">{value}</div><div className="kpi-foot">{foot}</div></div>)}</section>
    <section className="dashboard-grid"><div className="panel"><div className="panel-head"><div><h2 className="panel-title">Bill value by project</h2><p className="panel-caption">Current bill value across active projects</p></div><div className="spacer" /><span className="chart-legend"><span><i className="legend-dot" />Billed amount</span></span></div><div className="project-list">{projects.slice(0, 5).map((p) => { const value = bills.filter((b) => b.project.id === p.id).reduce((sum, b) => sum + Number(b.totalAmount), 0); return <div className="project-row" key={p.id}><span className="project-name">{p.name}</span><span className="project-value">{money(value)}</span><div className="progress"><span style={{ width: `${Math.max(3, value / max * 100)}%` }} /></div></div>; })}{!projects.length && <div className="empty">Add a project to see bill exposure here.</div>}</div></div>
      <div className="panel"><div className="panel-head"><div><h2 className="panel-title">At a glance</h2><p className="panel-caption">A quick read on your finance queue</p></div></div><div style={{ padding: "1px 17px 16px", display: "grid", gap: 10 }}><QuickStat label="Total bill value" value={money(kpis?.totalAmount || "0")} color="#31634a" /><QuickStat label="Pending value" value={money(kpis?.pendingAmount || "0")} color="#aa7b20" /><QuickStat label="Duplicate attempts blocked" value={String(kpis?.duplicates || 0)} color="#bd5146" />{user.role !== "TEAM_1" && <button className="button small" style={{ justifySelf: "start", marginTop: 4 }} onClick={() => setView("reports")}>View reports <span>↗</span></button>}</div></div></section>
    <section className="panel table-panel"><div className="panel-head"><div><h2 className="panel-title">Bills needing attention</h2><p className="panel-caption">The latest items currently in your workflow</p></div><div className="spacer" /><button className="button small" onClick={() => setView("bills")}>View all bills <span>↗</span></button></div><BillTable bills={queued} /></section>
  </>;
}
function QuickStat({ label, value, color }: { label: string; value: string; color: string }) { return <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, paddingBottom: 8, borderBottom: "1px solid #f0f3f1" }}><span className="muted">{label}</span><strong style={{ color }}>{value}</strong></div>; }

function BillList({ active, bills, projects, vendors, setReload }: { active: string; bills: Bill[]; projects: Project[]; vendors: Vendor[]; setReload: () => void }) {
  const [status, setStatus] = useState(""), [project, setProject] = useState(""), [vendor, setVendor] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [min, setMin] = useState(""), [max, setMax] = useState(""), [submittedBy, setSubmittedBy] = useState(""), [approvedBy, setApprovedBy] = useState(""), [paidBy, setPaidBy] = useState("");
  const title = active === "verification" ? "Newly submitted" : active === "approval" ? "Waiting for Admin" : active === "payment" ? "Approved for payment" : active === "paid" ? "Completed payments" : "Bill register";
  const submitters = Array.from(new Map(bills.filter((b) => b.createdBy).map((b) => [b.createdBy!.id, b.createdBy!.name])).entries());
  const approvers = Array.from(new Map(bills.flatMap((b) => (b.history || []).filter((h) => h.action === "BILL_APPROVED").map((h) => [h.userId, h.user.name] as [string, string]))).entries());
  const payers = Array.from(new Map(bills.flatMap((b) => b.payment?.paidBy ? [[b.payment.paidBy.id, b.payment.paidBy.name] as [string, string]] : [])).entries());
  const filtered = bills.filter((b) => (!status || b.currentStatus === status) && (!project || b.project.id === project) && (!vendor || b.vendor.id === vendor) && (!from || new Date(b.billDate) >= new Date(from)) && (!to || new Date(b.billDate) <= new Date(`${to}T23:59:59`)) && (!min || Number(b.totalAmount) >= Number(min)) && (!max || Number(b.totalAmount) <= Number(max)) && (!submittedBy || b.createdBy?.id === submittedBy) && (!approvedBy || b.history?.some((h) => h.action === "BILL_APPROVED" && h.userId === approvedBy)) && (!paidBy || b.payment?.paidBy?.id === paidBy));
  return <section className="panel table-panel"><div className="panel-head"><div><h2 className="panel-title">{title}</h2><p className="panel-caption">{filtered.length} {filtered.length === 1 ? "bill" : "bills"} shown</p></div></div><div className="table-tools"><span className="muted" style={{ fontSize: 9 }}><Filter size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />Filters</span><select className="filter-control" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{["SUBMITTED", "TEAM_2_REVIEW", "ADMIN_PENDING", "ADMIN_APPROVED", "PAYMENT_PENDING", "ADMIN_REJECTED", "CORRECTION_REQUIRED", "PAID"].map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select><select className="filter-control" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select className="filter-control" value={vendor} onChange={(e) => setVendor(e.target.value)}><option value="">All vendors</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select><input aria-label="From date" className="filter-control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><input aria-label="To date" className="filter-control" type="date" value={to} onChange={(e) => setTo(e.target.value)} /><input aria-label="Minimum amount" className="filter-control" type="number" placeholder="Min ₹" value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 70 }} /><input aria-label="Maximum amount" className="filter-control" type="number" placeholder="Max ₹" value={max} onChange={(e) => setMax(e.target.value)} style={{ width: 70 }} />{submitters.length > 0 && <select className="filter-control" aria-label="Submitted by" value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)}><option value="">Any submitter</option>{submitters.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}{approvers.length > 0 && <select className="filter-control" aria-label="Approved by" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)}><option value="">Any approver</option>{approvers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}{payers.length > 0 && <select className="filter-control" aria-label="Paid by" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}><option value="">Any payer</option>{payers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}<button className="button small" onClick={setReload}>Refresh</button></div><BillTable bills={filtered} /></section>;
}

function BillTable({ bills }: { bills: Bill[] }) {
  if (!bills.length) return <div className="empty"><strong>No bills found</strong>Try adjusting your filters, or check back when a bill enters this queue.</div>;
  return <div className="table-wrap"><table><thead><tr><th>Bill number</th><th>Vendor / Project</th><th>Bill date</th><th>Amount</th><th>Status</th><th>Stage</th><th /></tr></thead><tbody>{bills.map((b) => <tr key={b.id}><td><Link className="bill-number" href={`/bills/${b.id}`}>{b.billNumber}</Link><span className="sub-cell">Created {shortDate(b.createdAt)}</span></td><td><span className="vendor-name">{b.vendor.name}</span><span className="sub-cell">{b.project.name}</span></td><td>{shortDate(b.billDate)}</td><td className="amount">{money(b.totalAmount)}</td><td><Status value={b.currentStatus} /></td><td>{stageLabel(b.currentStatus)}</td><td><Link className="button small" href={`/bills/${b.id}`}>Open <span>↗</span></Link></td></tr>)}</tbody></table></div>;
}
function stageLabel(status: string) { if (["SUBMITTED", "TEAM_2_REVIEW"].includes(status)) return "Team 2 verification"; if (status === "ADMIN_PENDING") return "Admin approval"; if (status === "PAYMENT_PENDING") return "Team 2 payment"; if (status === "PAID") return "Complete"; if (status === "CORRECTION_REQUIRED") return "Correction needed"; if (status === "ADMIN_REJECTED") return "Closed"; return "—"; }

function NewBill({ projects, vendors, user, showToast, onDone, onCancel }: { projects: Project[]; vendors: Vendor[]; user: User; showToast: (m: string) => void; onDone: (id: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ billNumber: "", vendorId: "", projectId: "", vendorContact: "", vendorEmail: "", projectLocation: "", workCategory: "", description: "", billDate: new Date().toISOString().slice(0, 10), billAmount: "", gstAmount: "0", otherCharges: "0", remarks: "" });
  const [lineItems, setLineItems] = useState<BillLineItemDraft[]>([{ description: "", quantity: "1", unit: "nos", rate: "" }]);
  const [autoFilledLineItems, setAutoFilledLineItems] = useState<BillLineItemDraft[] | null>(null), [originalLineItems, setOriginalLineItems] = useState<BillLineItemDraft[] | null>(null);
  const [lineItemsFallback, setLineItemsFallback] = useState(false);
  const [file, setFile] = useState<File | null>(null), [pending, setPending] = useState(false), [duplicate, setDuplicate] = useState<any>(null), [duplicateLoading, setDuplicateLoading] = useState(false), [error, setError] = useState("");
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set()), [detectedGstin, setDetectedGstin] = useState("");
  const [autoFilledValues, setAutoFilledValues] = useState<AutoBillFields>({}), [autoFilledOriginals, setAutoFilledOriginals] = useState<AutoBillFields>({});
  const selectedVendor = vendors.find((v) => v.id === form.vendorId), selectedProject = projects.find((p) => p.id === form.projectId);
  const matchedInvoiceVendor = detectedGstin && validateGstin(detectedGstin).valid ? vendors.find((v) => v.active && v.gstin?.replace(/[^a-z0-9]/gi, "").toUpperCase() === detectedGstin) : undefined;
  const hasStartedItems = lineItems.some((item) => item.description.trim() || item.rate.trim());
  const itemSubtotal = billLineSubtotal(lineItems);
  const billAmount = hasStartedItems ? itemSubtotal.toFixed(2) : form.billAmount;
  const gstAmount = selectedVendor && !vendorHasGst(selectedVendor) ? "0" : form.gstAmount;
  const total = Number(billAmount || 0) + Number(gstAmount || 0) + Number(form.otherCharges || 0);
  useEffect(() => { api<{ billNumber: string }>("/api/bills/next-number").then((r) => setForm((current) => current.billNumber ? current : { ...current, billNumber: r.billNumber })).catch(() => undefined); }, []);
  useEffect(() => { if (!form.billNumber.trim()) { setDuplicate(null); return; } const timer = setTimeout(() => { setDuplicateLoading(true); const q = new URLSearchParams({ billNumber: form.billNumber, ...(form.vendorId ? { vendorId: form.vendorId } : {}), ...(form.projectId ? { projectId: form.projectId } : {}) }); api<{ duplicate: any }>(`/api/bills/check-duplicate?${q}`).then((r) => setDuplicate(r.duplicate)).catch(() => undefined).finally(() => setDuplicateLoading(false)); }, 300); return () => clearTimeout(timer); }, [form.billNumber, form.vendorId, form.projectId]);
  function change(key: string, value: string) {
    setEditedFields((current) => new Set(current).add(key));
    setForm((current) => ({
      ...current, [key]: value,
      ...(key === "vendorId" ? { vendorContact: vendors.find((item) => item.id === value)?.mobile || "", vendorEmail: vendors.find((item) => item.id === value)?.email || "", gstAmount: vendors.find((item) => item.id === value) && !vendorHasGst(vendors.find((item) => item.id === value)) ? "0" : current.gstAmount } : {}),
      ...(key === "projectId" ? { projectLocation: projects.find((item) => item.id === value)?.location || "" } : {}),
    }));
  }
  function changeLineItems(items: BillLineItemDraft[]) {
    setEditedFields((current) => new Set(current).add("lineItems"));
    setLineItems(items);
    setLineItemsFallback(false);
  }
  function applyInvoiceSuggestions(fields: InvoiceSuggestions) {
    if (!Object.keys(fields).length) {
      setDetectedGstin("");
      setLineItemsFallback(false);
      if (Object.keys(autoFilledValues).length) setForm((current) => {
        const restored = { ...current };
        for (const [key, value] of Object.entries(autoFilledValues) as Array<[AutoBillField, string]>) {
          if (!editedFields.has(key) && current[key] === value) restored[key] = autoFilledOriginals[key] || "";
        }
        return restored;
      });
      if (autoFilledLineItems && originalLineItems && sameLineItems(lineItems, autoFilledLineItems)) setLineItems(originalLineItems);
      setAutoFilledValues({});
      setAutoFilledOriginals({});
      setAutoFilledLineItems(null);
      setOriginalLineItems(null);
      return;
    }
    setDetectedGstin(fields.gstin || "");
    const validGstin = fields.gstin && validateGstin(fields.gstin).valid ? fields.gstin : "";
    const vendor = validGstin ? vendors.find((item) => item.active && item.gstin?.replace(/[^a-z0-9]/gi, "").toUpperCase() === validGstin) : undefined;
    const values: AutoBillFields = {
      ...(fields.billNumber && !editedFields.has("billNumber") ? { billNumber: fields.billNumber } : {}),
      ...(fields.billDate && !editedFields.has("billDate") ? { billDate: fields.billDate } : {}),
      ...(fields.billAmount && !editedFields.has("billAmount") ? { billAmount: fields.billAmount } : {}),
      ...(fields.gstAmount !== undefined && !editedFields.has("gstAmount") ? { gstAmount: (vendor || selectedVendor) && !vendorHasGst(vendor || selectedVendor) ? "0" : fields.gstAmount } : {}),
      ...(vendor && !editedFields.has("vendorId") ? { vendorId: vendor.id, vendorContact: vendor.mobile || "", vendorEmail: vendor.email || "" } : {}),
    };
    setAutoFilledOriginals((current) => {
      const originals = { ...current };
      for (const key of Object.keys(values) as AutoBillField[]) if (originals[key] === undefined) originals[key] = form[key];
      return originals;
    });
    setAutoFilledValues((current) => ({ ...current, ...values }));
    setForm((current) => ({ ...current, ...values }));
    if (fields.lineItems?.length && !editedFields.has("lineItems")) {
      const suggested = fields.lineItems.map((item) => ({ ...item }));
      setOriginalLineItems((current) => current || lineItems.map((item) => ({ ...item })));
      setAutoFilledLineItems(suggested);
      setLineItems(suggested);
      setLineItemsFallback(Boolean(fields.lineItemsFallback));
    }
  }
  async function submit(e: React.FormEvent) { e.preventDefault(); const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; const intent = submitter?.value === "draft" ? "draft" : "submit"; const enteredItems = lineItems.filter((item) => item.description.trim() || item.rate.trim()); if (enteredItems.some((item) => !item.description.trim() || !item.quantity || Number(item.quantity) <= 0 || !item.unit.trim() || item.rate === "" || Number(item.rate) < 0)) { setError("Complete or remove each material/work row before saving."); return; } if (intent === "submit" && !file) { setError("Please upload the bill document."); return; } const savedBillAmount = enteredItems.length ? billLineSubtotal(enteredItems).toFixed(2) : form.billAmount; if (intent === "submit" && Number(savedBillAmount) <= 0) { setError("Enter or scan a bill amount greater than zero."); return; } const submissionItems = intent === "submit" && !enteredItems.length ? [{ description: form.workCategory.trim() || "Materials / work as described in bill", quantity: "1", unit: "lot", rate: savedBillAmount }] : enteredItems; setPending(true); setError(""); try { const data = new FormData(); Object.entries({ ...form, billAmount: savedBillAmount, gstAmount }).forEach(([k, v]) => data.append(k, v)); data.append("lineItems", JSON.stringify(submissionItems)); data.append("intent", intent); if (file) data.append("document", file); const result = await api<{ bill: Bill }>("/api/bills", { method: "POST", body: data }); showToast(intent === "draft" ? "Draft saved." : "Bill submitted to Team 2 for verification."); onDone(result.bill.id); } catch (e) { const msg = (e as Error).message; setError(msg); showToast(msg); } finally { setPending(false); } }
  const alreadyPaid = duplicate?.isPaid;
  return <form className="form-card" onSubmit={submit}>
    {error && <div className="alert error">{error}</div>}
    {duplicate && <div className={`alert ${alreadyPaid ? "error" : "warning"}`}><strong>{alreadyPaid ? "ALREADY PAID" : "BILL ALREADY IN PROCESS"}</strong><br />Bill {duplicate.billNumber} · {duplicate.vendor} · {duplicate.project}<br />{alreadyPaid ? <>Paid {money(duplicate.paidAmount || 0)} on {shortDate(duplicate.paymentDate)}{duplicate.paymentReference ? ` · Reference ${duplicate.paymentReference}` : ""}{duplicate.paidBy ? ` · Paid by ${duplicate.paidBy}` : ""}</> : <>Current status: {duplicate.status?.replaceAll("_", " ")}</>}</div>}
    {duplicateLoading && <div className="field-hint" style={{ marginBottom: 10 }}>Checking bill number…</div>}
    <div className="form-section-title"><span>1</span> Bill and project details</div>
    <div className="form-grid">
      <Field label="Bill number *"><input required value={form.billNumber} onChange={(e) => change("billNumber", e.target.value)} placeholder="e.g. BL-2026-0042" /></Field>
      <Field label="Project *"><select required value={form.projectId} onChange={(e) => change("projectId", e.target.value)}><option value="">Select project</option>{projects.filter((p) => p.status === "ACTIVE").map((p) => <option key={p.id} value={p.id}>{p.name} · {p.code}</option>)}</select></Field>
      <Field label="Bill date *"><input required type="date" value={form.billDate} onChange={(e) => change("billDate", e.target.value)} /></Field>
      <Field label="Vendor / contractor *"><select required value={form.vendorId} onChange={(e) => change("vendorId", e.target.value)}><option value="">Select vendor</option>{vendors.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.name}{vendorHasGst(v) ? ` · ${v.gstin || "GST registered"}` : " · Non-GST"}</option>)}</select>{selectedVendor && (vendorHasGst(selectedVendor) ? selectedVendor.gstin && <GstinStatus value={selectedVendor.gstin} /> : <div className="alert warning" style={{ margin: 0 }}>Non-GST party selected. GST is set to ₹0 for this bill.</div>)}</Field>
      <Field label="Project location"><input value={form.projectLocation} onChange={(e) => change("projectLocation", e.target.value)} placeholder="Site location" /></Field>
      <Field label="Work / material category"><input value={form.workCategory} onChange={(e) => change("workCategory", e.target.value)} placeholder="Civil, electrical, materials…" /></Field>
      <Field label="Vendor contact number"><input value={form.vendorContact} onChange={(e) => change("vendorContact", e.target.value)} /></Field>
      <Field label="Vendor email"><input type="email" value={form.vendorEmail} onChange={(e) => change("vendorEmail", e.target.value)} /></Field>
      <Field label="Description" className="full"><textarea required value={form.description} onChange={(e) => change("description", e.target.value)} placeholder="Describe the work completed or materials supplied" /></Field>
    </div>
    <div className="form-section-title"><span>2</span> Material and work details</div>
    <BillLineItemsEditor items={lineItems} onChange={changeLineItems} />
    {lineItemsFallback && <div className="alert warning">OCR did not find a clear itemized table, so the scanned bill amount was added as one “lot” row. Edit this row with the actual material/work details when available.</div>}
    <div className="form-section-title"><span>3</span> Bill amount and documents</div>
    <div className="form-grid">
      <Field label="Bill amount / item subtotal (₹) *"><input required type="number" min="0.01" step="0.01" value={billAmount} readOnly={hasStartedItems} onChange={(e) => change("billAmount", e.target.value)} /></Field>
      <Field label="GST amount (₹)"><input type="number" min="0" step="0.01" value={gstAmount} onChange={(e) => change("gstAmount", e.target.value)} disabled={!!selectedVendor && !vendorHasGst(selectedVendor)} /><span className="field-hint">Non-GST vendors are billed with zero GST.</span></Field>
      <Field label="Other charges (₹)"><input type="number" min="0" step="0.01" value={form.otherCharges} onChange={(e) => change("otherCharges", e.target.value)} /></Field>
      <Field label="Remarks" className="full"><textarea value={form.remarks} onChange={(e) => change("remarks", e.target.value)} placeholder="Additional information for the verification team" /></Field>
    </div>
    {detectedGstin && validateGstin(detectedGstin).valid && (!matchedInvoiceVendor || selectedVendor?.id !== matchedInvoiceVendor.id) && <div className="alert warning"><strong>Confirm the invoice supplier.</strong> The invoice GSTIN {detectedGstin} {matchedInvoiceVendor ? `matches ${matchedInvoiceVendor.name}, but another vendor is selected` : "does not match an active vendor in your directory"}. Check the vendor before submitting.</div>}
    <InvoiceCapture file={file} onFile={setFile} onExtract={applyInvoiceSuggestions} />
    <div className="total-box"><span>Total bill amount · {selectedVendor?.name || "Vendor"} · {selectedProject?.name || "Project"}</span><strong>{money(total)}</strong></div>
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 17 }}><button type="button" className="button" onClick={onCancel}>Cancel</button><button type="submit" name="intent" value="draft" className="button" disabled={pending || (duplicate && alreadyPaid)}>{pending ? "Saving…" : "Save draft"}</button><button type="submit" name="intent" value="submit" className="button primary" disabled={pending || (duplicate && alreadyPaid)}><FileCheck2 size={14} />{pending ? "Submitting…" : "Submit bill"}</button></div>
  </form>;
}
function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) { return <div className={`field ${className}`}><label>{label}</label>{children}</div>; }

function ProjectsView({ projects, user, showToast, refresh }: { projects: Project[]; user: User; showToast: (m: string) => void; refresh: () => void }) {
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); setPending(true); const form = Object.fromEntries(new FormData(e.currentTarget).entries()); try { await api("/api/projects", { method: "POST", body: JSON.stringify(form) }); showToast("Project created."); setOpen(false); refresh(); } catch (err) { showToast((err as Error).message); } finally { setPending(false); } }
  async function toggleProject(p: Project) { try { await api(`/api/projects/${p.id}`, { method: "PATCH", body: JSON.stringify({ status: p.status === "ACTIVE" ? "ON_HOLD" : "ACTIVE" }) }); showToast("Project status updated."); refresh(); } catch (err) { showToast((err as Error).message); } }
  return <><section className="panel table-panel"><div className="panel-head"><div><h2 className="panel-title">Project directory</h2><p className="panel-caption">{projects.length} registered projects</p></div><div className="spacer" />{user.role === "ADMIN" && <button className="button primary" onClick={() => setOpen(true)}><Plus /> Add project</button>}</div><div className="table-wrap"><table><thead><tr><th>Project</th><th>Code</th><th>Location</th><th>Bills</th><th>Status</th>{user.role === "ADMIN" && <th />}</tr></thead><tbody>{projects.map((p) => <tr key={p.id}><td className="vendor-name">{p.name}</td><td>{p.code}</td><td>{p.location}</td><td>{p._count?.bills || 0}</td><td><span className={`status ${p.status === "ACTIVE" ? "paid" : "neutral"}`}>{p.status.replaceAll("_", " ")}</span></td>{user.role === "ADMIN" && <td><button className="button small" onClick={() => void toggleProject(p)}>{p.status === "ACTIVE" ? "Pause" : "Activate"}</button></td>}</tr>)}</tbody></table>{!projects.length && <div className="empty">No projects yet. Add the first project to start tracking bills.</div>}</div></section>{open && <Modal title="Add a project" close={() => setOpen(false)}><form onSubmit={submit} className="stack"><Field label="Project name *"><input name="name" required /></Field><Field label="Project code *"><input name="code" required placeholder="e.g. BLR-01" /></Field><Field label="Client name"><input name="clientName" /></Field><Field label="Location *"><input name="location" required /></Field><div className="form-grid" style={{ marginBottom: 0 }}><Field label="Start date"><input name="startDate" type="date" /></Field><Field label="Expected completion"><input name="expectedEndDate" type="date" /></Field></div><div style={{ display: "flex", justifyContent: "flex-end" }}><button className="button primary" disabled={pending}>Create project</button></div></form></Modal>}</>;
}

function VendorsView({ vendors, user, showToast, refresh }: { vendors: Vendor[]; user: User; showToast: (m: string) => void; refresh: () => void }) {
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [gstinValue, setGstinValue] = useState(""), [gstRegistered, setGstRegistered] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const normalizedGstin = gstRegistered ? gstinValue.trim().toUpperCase() : ""; if (gstRegistered && !normalizedGstin) { showToast("Enter the GSTIN or mark the party as non-GST."); return; } if (normalizedGstin && !validateGstin(normalizedGstin).valid) { showToast(validateGstin(normalizedGstin).message); return; } setPending(true); const form = Object.fromEntries(new FormData(e.currentTarget).entries()); try { await api("/api/vendors", { method: "POST", body: JSON.stringify({ ...form, gstRegistered, gstin: normalizedGstin, active: true }) }); showToast("Vendor added."); setOpen(false); setGstinValue(""); setGstRegistered(false); refresh(); } catch (err) { showToast((err as Error).message); } finally { setPending(false); } }
  async function toggleVendor(v: Vendor) { try { await api(`/api/vendors/${v.id}`, { method: "PATCH", body: JSON.stringify({ active: !v.active }) }); showToast("Vendor status updated."); refresh(); } catch (err) { showToast((err as Error).message); } }
  return <><section className="panel table-panel"><div className="panel-head"><div><h2 className="panel-title">Vendor directory</h2><p className="panel-caption">Bank details are restricted to authorized roles.</p></div><div className="spacer" />{user.role !== "TEAM_1" && <button className="button primary" onClick={() => { setGstinValue(""); setGstRegistered(false); setOpen(true); }}><Plus /> Add vendor</button>}</div><div className="table-wrap"><table><thead><tr><th>Vendor</th><th>GST registration</th><th>GSTIN</th><th>Contact</th><th>Email</th><th>Bills</th><th>Status</th>{user.role !== "TEAM_1" && <th />}</tr></thead><tbody>{vendors.map((v) => <tr key={v.id}><td><span className="vendor-name">{v.name}</span><span className="sub-cell">{v.companyName || "Contractor / supplier"}</span></td><td>{vendorHasGst(v) ? "Registered" : "Non-GST"}</td><td>{v.gstin || "—"}</td><td>{v.mobile || "—"}</td><td>{v.email || "—"}</td><td>{v._count?.bills || 0}</td><td><span className={`status ${v.active ? "paid" : "neutral"}`}>{v.active ? "Active" : "Inactive"}</span></td>{user.role !== "TEAM_1" && <td><button className="button small" onClick={() => void toggleVendor(v)}>{v.active ? "Deactivate" : "Activate"}</button></td>}</tr>)}</tbody></table>{!vendors.length && <div className="empty">No vendors found.</div>}</div></section>{open && <Modal title="Add a vendor" close={() => { setOpen(false); setGstinValue(""); }}><form onSubmit={submit} className="stack"><Field label="Vendor name *"><input name="name" required /></Field><Field label="Company name"><input name="companyName" /></Field><Field label="GST registration status *"><select value={gstRegistered ? "registered" : "non-gst"} onChange={(event) => { const registered = event.target.value === "registered"; setGstRegistered(registered); if (!registered) setGstinValue(""); }}><option value="non-gst">Non-GST / unregistered party</option><option value="registered">GST-registered party</option></select><span className="field-hint">Non-GST vendors can be added without a GSTIN; their bills use zero GST.</span></Field>{gstRegistered && <Field label="GSTIN *"><input name="gstin" required value={gstinValue} onChange={(event) => setGstinValue(event.target.value.toUpperCase())} autoComplete="off" /><GstinStatus value={gstinValue} /></Field>}<div className="form-grid" style={{ marginBottom: 0 }}><Field label="PAN"><input name="pan" /></Field><Field label="Mobile"><input name="mobile" /></Field><Field label="Email"><input name="email" type="email" /></Field></div><Field label="Address"><textarea name="address" /></Field><Field label="Bank details (restricted)"><textarea name="bankDetails" /></Field><div style={{ display: "flex", justifyContent: "flex-end" }}><button className="button primary" disabled={pending}>Add vendor</button></div></form></Modal>}</>;
}

function ReportsView({ projects }: { projects: Project[] }) {
  const [project, setProject] = useState(""), [summary, setSummary] = useState<any>(null);
  useEffect(() => { const q = project ? `?projectId=${project}` : ""; api(`/api/reports${q}`).then(setSummary).catch(() => undefined); }, [project]);
  function download(format: string) { window.open(`/api/reports?format=${format}${project ? `&projectId=${project}` : ""}`, "_blank"); }
  return <div className="stack"><section className="panel"><div className="panel-head"><div><h2 className="panel-title">Bill and payment report</h2><p className="panel-caption">Choose a project scope, then export the underlying bill register.</p></div><div className="spacer" /><select className="filter-control" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div style={{ padding: "5px 18px 20px" }}><div className="kpi-grid"><KpiMini label="Total bills" value={summary?.bills ?? "—"} /><KpiMini label="Total billed value" value={summary ? money(summary.total) : "—"} /><KpiMini label="Total paid" value={summary ? money(summary.paid) : "—"} /><KpiMini label="Pending value" value={summary ? money(Math.max(0, Number(summary.total) - Number(summary.paid))) : "—"} /></div><div className="table-wrap"><table><thead><tr><th>Status</th><th>Bill count</th><th>Bill value</th></tr></thead><tbody>{(summary?.rows || []).map((row: any) => <tr key={row.status}><td><Status value={row.status} /></td><td>{row.count}</td><td className="amount">{money(row.amount)}</td></tr>)}</tbody></table>{!summary && <div className="empty">Preparing report…</div>}</div></div></section><section className="panel table-panel"><div className="panel-head"><div><h2 className="panel-title">Project performance</h2><p className="panel-caption">Billed, approved, paid and pending totals per project.</p></div></div><div className="table-wrap"><table><thead><tr><th>Project</th><th>Bills</th><th>Total billed</th><th>Approved</th><th>Paid</th><th>Pending</th></tr></thead><tbody>{(summary?.projects || []).map((p: any) => <tr key={p.name}><td className="vendor-name">{p.name}</td><td>{p.count}</td><td>{money(p.total)}</td><td>{money(p.approved)}</td><td>{money(p.paid)}</td><td>{money(p.pending)}</td></tr>)}</tbody></table>{summary && !summary.projects?.length && <div className="empty">No project activity in this report scope.</div>}</div></section><section className="panel table-panel"><div className="panel-head"><div><h2 className="panel-title">Payments by vendor</h2><p className="panel-caption">Highest paid vendor totals in this report scope.</p></div></div><div className="table-wrap"><table><thead><tr><th>Vendor</th><th>Bill count</th><th>Total billed</th><th>Total paid</th></tr></thead><tbody>{(summary?.vendors || []).map((v: any) => <tr key={v.name}><td className="vendor-name">{v.name}</td><td>{v.count}</td><td>{money(v.total)}</td><td>{money(v.paid)}</td></tr>)}</tbody></table></div></section><section className="panel table-panel"><div className="panel-head"><div><h2 className="panel-title">Payments by month</h2><p className="panel-caption">Cash disbursed by transaction month.</p></div></div><div className="table-wrap"><table><thead><tr><th>Month</th><th>Paid total</th></tr></thead><tbody>{(summary?.paymentByMonth || []).map((row: any) => <tr key={row.month}><td>{row.month}</td><td className="amount">{money(row.amount)}</td></tr>)}</tbody></table>{summary && !summary.paymentByMonth?.length && <div className="empty">No completed payments in this report scope.</div>}</div></section><section className="panel"><div className="panel-head"><div><h2 className="panel-title">Export report</h2><p className="panel-caption">Download a complete bill and payment register in your preferred format.</p></div></div><div style={{ display: "flex", gap: 9, padding: "0 18px 19px", flexWrap: "wrap" }}>{[["csv", "CSV spreadsheet"], ["xlsx", "Excel workbook"], ["pdf", "PDF report"]].map(([format, label]) => <button key={format} className="button" onClick={() => download(format)}><Download />{label}</button>)}</div></section></div>;
}
function KpiMini({ label, value }: { label: string; value: string | number }) { return <div className="kpi-card"><div className="kpi-label">{label}</div><div className="kpi-value" style={{ fontSize: 17 }}>{value}</div></div>; }

function NotificationsView({ notifications, markAllRead }: { notifications: Notification[]; markAllRead: () => void }) { return <section className="panel"><div className="panel-head"><div><h2 className="panel-title">Recent updates</h2><p className="panel-caption">Notifications are personal to your account.</p></div><div className="spacer" /><button className="button small" onClick={markAllRead}><Check /> Mark all read</button></div><div style={{ padding: "0 16px 16px" }}>{notifications.map((n) => <Link href={n.href || "#"} key={n.id} className="notice-card" style={{ background: n.readAt ? "#fff" : "#f8fbf4" }}><span className="kpi-icon"><Bell size={15} /></span><div style={{ flex: 1 }}><strong style={{ fontSize: 10 }}>{n.title}</strong><p>{n.message}</p></div><time className="muted" style={{ fontSize: 8 }}>{shortDate(n.createdAt)}</time></Link>)}{!notifications.length && <div className="empty"><strong>You’re all caught up</strong>New bill updates will appear here.</div>}</div></section>; }

function NotificationDropdown({ notifications, markAllRead, go }: { notifications: Notification[]; markAllRead: () => void; go: (href?: string) => void }) { return <div className="notification-panel"><div className="notification-head"><span>Notifications</span><button className="button small" onClick={markAllRead}>Mark read</button></div>{notifications.slice(0, 6).map((n) => <button key={n.id} onClick={() => go(n.href)} className={`notification-item ${n.readAt ? "" : "unread"}`} style={{ width: "100%", textAlign: "left", border: 0, cursor: "pointer" }}><i className="notification-mark" /><span><strong>{n.title}</strong><p>{n.message}</p></span></button>)}{!notifications.length && <div className="empty" style={{ padding: 20 }}>No notifications yet.</div>}</div>; }

function UsersView({ users, showToast, refresh }: { users: any[]; showToast: (m: string) => void; refresh: () => void }) {
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); setPending(true); const form = Object.fromEntries(new FormData(e.currentTarget).entries()); try { await api("/api/users", { method: "POST", body: JSON.stringify({ ...form, active: true }) }); showToast("User account created."); setOpen(false); refresh(); } catch (err) { showToast((err as Error).message); } finally { setPending(false); } }
  async function toggleUser(u: any) { try { await api(`/api/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ active: !u.active }) }); showToast("User access updated."); refresh(); } catch (err) { showToast((err as Error).message); } }
  return <><section className="panel table-panel"><div className="panel-head"><div><h2 className="panel-title">Authorized users</h2><p className="panel-caption">Assign the minimum role needed for each responsibility.</p></div><div className="spacer" /><button className="button primary" onClick={() => setOpen(true)}><Plus /> Add user</button></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Mobile</th><th>Department</th><th>Role</th><th>Access</th><th /></tr></thead><tbody>{users.map((u) => <tr key={u.id}><td className="vendor-name">{u.name}</td><td>{u.email}</td><td>{u.mobile || "—"}</td><td>{u.department || "—"}</td><td>{roleLabel(u.role)}</td><td><span className={`status ${u.active ? "paid" : "neutral"}`}>{u.active ? "Active" : "Inactive"}</span></td><td><button className="button small" onClick={() => void toggleUser(u)}>{u.active ? "Deactivate" : "Activate"}</button></td></tr>)}</tbody></table></div></section>{open && <Modal title="Add a user" close={() => setOpen(false)}><form className="stack" onSubmit={submit}><Field label="Full name *"><input name="name" required /></Field><Field label="Email *"><input name="email" type="email" required /></Field><div className="form-grid" style={{ marginBottom: 0 }}><Field label="Mobile"><input name="mobile" /></Field><Field label="Department"><input name="department" /></Field></div><Field label="Role *"><select name="role" required><option value="TEAM_1">Team 1 · Bill entry</option><option value="TEAM_2">Team 2 · Verification & payment</option><option value="ADMIN">Admin · Final approval</option></select></Field><Field label="Initial password *"><input name="password" type="password" minLength={12} required /><span className="field-hint">Use at least 12 characters; share this through your company’s secure channel.</span></Field><div style={{ display: "flex", justifyContent: "flex-end" }}><button className="button primary" disabled={pending}>Create account</button></div></form></Modal>}</>;
}

function SettingsView({ settings, setSettings, showToast, onBrandingChange }: { settings: SettingsData; setSettings: (s: SettingsData) => void; showToast: (m: string) => void; onBrandingChange: (branding: Branding) => void }) {
  const [pending, setPending] = useState(false);
  async function save(e: React.FormEvent) { e.preventDefault(); setPending(true); try { const result = await api<{ settings: SettingsData }>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }); setSettings(result.settings); onBrandingChange({ companyName: result.settings.companyName, companyLogoUrl: result.settings.companyLogoUrl || defaultBranding.companyLogoUrl }); showToast("Company settings saved."); } catch (err) { showToast((err as Error).message); } finally { setPending(false); } }
  return <form className="form-card" onSubmit={save}><div className="form-section-title"><span>1</span> Company and billing defaults</div><div className="form-grid"><Field label="Company name"><input value={settings.companyName} onChange={(e) => setSettings({ ...settings, companyName: e.target.value })} required /></Field><Field label="Support email"><input type="email" value={settings.supportEmail} onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })} required /></Field><Field label="Company logo path or URL"><input type="text" value={settings.companyLogoUrl || ""} onChange={(e) => setSettings({ ...settings, companyLogoUrl: e.target.value })} placeholder="/jp-projects-logo.jpeg or https://…" /><span className="field-hint">Shown in the workspace and workflow emails.</span></Field><Field label="Currency"><select value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })}><option value="INR">INR · Indian Rupee</option><option value="USD">USD · US Dollar</option></select></Field><Field label="Bill number format"><input value={settings.billNumberFormat} onChange={(e) => setSettings({ ...settings, billNumberFormat: e.target.value })} /></Field></div><div className="form-section-title"><span>2</span> Workflow options</div><div className="stack" style={{ padding: "0 2px 18px" }}><label style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={settings.gstEnabled} onChange={(e) => setSettings({ ...settings, gstEnabled: e.target.checked })} /> Enable GST fields for submitted bills</label><label style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={settings.notificationsEnabled} onChange={(e) => setSettings({ ...settings, notificationsEnabled: e.target.checked })} /> Enable email and in-app notifications</label><p className="field-hint">SMTP and object storage credentials are set in the server environment file.</p></div><button className="button primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button></form>;
}

function AuditView({ logs }: { logs: Audit[] }) { return <section className="panel table-panel"><div className="panel-head"><div><h2 className="panel-title">Immutable activity history</h2><p className="panel-caption">Audit entries are append-only and cannot be edited or deleted through the app.</p></div></div><div className="table-wrap"><table><thead><tr><th>Time</th><th>Bill</th><th>Action</th><th>User</th><th>Role</th><th>Status change</th><th>Remarks</th><th>IP</th></tr></thead><tbody>{logs.map((l) => <tr key={l.id}><td>{new Date(l.createdAt).toLocaleString("en-IN")}</td><td>{l.bill?.billNumber || "—"}</td><td className="bill-number">{l.action.replaceAll("_", " ")}</td><td>{l.userName}</td><td>{l.role.replaceAll("_", " ")}</td><td>{l.previous ? `${l.previous} → ${l.next || "—"}` : l.next || "—"}</td><td style={{ maxWidth: 220, whiteSpace: "normal" }}>{l.remarks || "—"}</td><td>{l.ipAddress || "—"}</td></tr>)}</tbody></table>{!logs.length && <div className="empty">No audit events yet.</div>}</div></section>; }

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}><div className="modal"><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={close}><X /></button></div>{children}</div></div>; }
