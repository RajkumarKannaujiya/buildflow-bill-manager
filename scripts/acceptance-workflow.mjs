const baseUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const uniqueUtr = `UTR-ACCEPTANCE-${Date.now()}`;

async function request(path, { cookie, method = "GET", body, expectedStatus = 200 } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (response.status !== expectedStatus) throw new Error(`${method} ${path}: expected HTTP ${expectedStatus}, received ${response.status}: ${data.error || "no error detail"}`);
  return data;
}

async function login(email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Demo123!" }) });
  const data = await response.json();
  if (!response.ok) throw new Error(`Login failed for ${email}: ${data.error || response.status}`);
  const rawCookie = response.headers.get("set-cookie");
  if (!rawCookie) throw new Error("Login response did not set a session cookie.");
  return { cookie: rawCookie.split(";")[0], user: data.user };
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function hasNotification(rows, fragment) { return rows.some((n) => `${n.title} ${n.message}`.toLowerCase().includes(fragment.toLowerCase())); }
function createPaymentForm(utr) {
  const form = new FormData();
  Object.entries({ paymentDate: new Date().toISOString().slice(0, 10), paidAmount: "11800.00", paymentMethod: "BANK_TRANSFER", bankName: "Acceptance Bank", utrNumber: utr, paymentReference: `REF-${utr}`, paymentRemarks: "Automated acceptance payment" }).forEach(([k, v]) => form.append(k, v));
  return form;
}

async function main() {
  const team1 = await login("team11@buildflow.local");
  const team2 = await login("team21@buildflow.local");
  const admin = await login("admin@buildflow.local");
  const { projects } = await request("/api/projects", { cookie: team1.cookie });
  const { vendors } = await request("/api/vendors", { cookie: team1.cookie });
  const project = projects.find((p) => p.status === "ACTIVE"), vendor = vendors.find((v) => v.active);
  assert(project && vendor, "Seed an active project and vendor before acceptance verification.");

  const form = new FormData();
  Object.entries({ billNumber: "BILL-1001", vendorId: vendor.id, projectId: project.id, vendorContact: vendor.mobile || "", vendorEmail: vendor.email || "", projectLocation: project.location, workCategory: "Acceptance workflow", description: "End-to-end workflow verification", billDate: new Date().toISOString().slice(0, 10), billAmount: "10000.00", gstAmount: "1800.00", otherCharges: "0", remarks: "Automated acceptance scenario", intent: "submit" }).forEach(([k, v]) => form.append(k, v));
  form.append("lineItems", JSON.stringify([{ description: "Acceptance test material", quantity: "1", unit: "lot", rate: "10000.00" }]));
  form.append("document", new Blob(["%PDF-1.4\nAcceptance test document\n%%EOF\n"], { type: "application/pdf" }), "acceptance.pdf");
  const { bill } = await request("/api/bills", { cookie: team1.cookie, method: "POST", body: form, expectedStatus: 201 });
  console.log("1–4: Team 1 submitted BILL-1001.");
  let team2Notifications = (await request("/api/notifications", { cookie: team2.cookie })).notifications;
  assert(hasNotification(team2Notifications, "BILL-1001"), "Team 2 did not receive the submission notification.");
  console.log("5: Team 2 received the submission notification.");

  await request(`/api/bills/${bill.id}/verify`, { cookie: team2.cookie, method: "POST", body: { remarks: "Documents and totals verified." } });
  await request(`/api/bills/${bill.id}/send-to-admin`, { cookie: team2.cookie, method: "POST", body: { remarks: "Ready for approval." } });
  const adminNotifications = (await request("/api/notifications", { cookie: admin.cookie })).notifications;
  assert(hasNotification(adminNotifications, "BILL-1001"), "Admin did not receive the approval-queue notification.");
  console.log("6–9: Team 2 verified and forwarded the bill; Admin received the notification.");

  await request(`/api/bills/${bill.id}/approve`, { cookie: admin.cookie, method: "POST", body: { remarks: "Approved." } });
  team2Notifications = (await request("/api/notifications", { cookie: team2.cookie })).notifications;
  assert(hasNotification(team2Notifications, "approved"), "Team 2 did not receive the approval notification.");
  console.log("10–12: Admin approved the bill; Team 2 received the approval notification.");

  const paid = await request(`/api/bills/${bill.id}/payment`, { cookie: team2.cookie, method: "POST", body: createPaymentForm(uniqueUtr) });
  assert(paid.status === "PAID", "Payment did not set the bill status to PAID.");
  for (const [name, session] of [["Team 1", team1], ["Team 2", team2], ["Admin", admin]]) {
    const notifications = (await request("/api/notifications", { cookie: session.cookie })).notifications;
    assert(hasNotification(notifications, "payment completed"), `${name} did not receive the payment notification.`);
  }
  console.log("13–17: Team 2 paid the bill; the bill is PAID and all roles were notified.");

  const duplicate = new FormData();
  Object.entries({ billNumber: "BILL-1001", vendorId: vendor.id, projectId: project.id, vendorContact: vendor.mobile || "", vendorEmail: vendor.email || "", projectLocation: project.location, workCategory: "Acceptance workflow", description: "Duplicate attempt", billDate: new Date().toISOString().slice(0, 10), billAmount: "10000.00", gstAmount: "1800.00", otherCharges: "0", remarks: "Must be blocked", intent: "submit" }).forEach(([k, v]) => duplicate.append(k, v));
  duplicate.append("lineItems", JSON.stringify([{ description: "Acceptance test material", quantity: "1", unit: "lot", rate: "10000.00" }]));
  duplicate.append("document", new Blob(["%PDF-1.4\nAcceptance test duplicate\n%%EOF\n"], { type: "application/pdf" }), "duplicate.pdf");
  const blocked = await request("/api/bills", { cookie: team1.cookie, method: "POST", body: duplicate, expectedStatus: 409 });
  assert(blocked.error?.includes("ALREADY PAID"), "A second submission was not identified as already paid.");
  assert(blocked.duplicate?.paidAmount, "The duplicate response did not show the paid amount.");
  const secondPayment = await request(`/api/bills/${bill.id}/payment`, { cookie: team2.cookie, method: "POST", body: createPaymentForm(uniqueUtr), expectedStatus: 409 });
  assert(secondPayment.error === "PAYMENT ALREADY COMPLETED", "The second payment attempt was not blocked.");
  console.log("18–22: The paid duplicate and second payment were both blocked.");
  console.log("Acceptance workflow passed.");
}

main().catch((error) => { console.error(`Acceptance workflow failed: ${error.message}`); process.exitCode = 1; });
