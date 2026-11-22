// Orange Cloud Scripting 版 — Cloudflare API 层（cf-api.ts）
// 纯 TypeScript，不导入 "scripting"，也不用任何 Scripting 全局对象，
// 除了 deployWorker 用的 FormData / Data（Scripting 运行时提供；
// Node 测试里会打桩）。其余函数只用全局 fetch，方便在 Node 里单测。
// API：https://api.cloudflare.com/client/v4
// 注意：令牌作用域的坑——/user/tokens/verify 返回 401 不代表令牌已死，
// 只要 /accounts 和列表接口能返回 200，令牌就是有效的。

export const API_BASE = "https://api.cloudflare.com/client/v4"

export type CfResult = {
  status: number
  json: any | null
  text: string
}

export async function cfCall(
  token: string,
  path: string,
  init?: RequestInit
): Promise<CfResult> {
  const res = await fetch(API_BASE + path, {
    ...(init ?? {}),
    headers: {
      Authorization: "Bearer " + token,
      ...(init?.headers ?? {}),
    },
    timeout: 30,
  } as any)
  const text = await res.text()
  let json: any | null = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: res.status, json, text }
}

export function errText(r: CfResult): string {
  if (r.json && Array.isArray(r.json.errors) && r.json.errors.length > 0) {
    return r.json.errors.map((e: any) => e.message || e.code || "").join("; ")
  }
  return "HTTP " + r.status
}

export function isOk(r: CfResult): boolean {
  return r.status >= 200 && r.status < 300 && r.json?.success === true
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 数字加千分位，手机上好读。 */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return Math.round(n).toLocaleString("en-US")
}

/** ISO 时间转成本地短格式（月/日 时:分）。 */
export function fmtTime(iso: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const m = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${m}/${day} ${hh}:${mm}`
}

/** ISO 时间转成只有日期。 */
export function fmtDate(iso: string): string {
  if (!iso) return "—"
  return iso.slice(0, 10)
}

// ---------- 类型 ----------

export type Account = { id: string; name: string }
export type Zone = {
  id: string
  name: string
  status: string
  planName: string
  nameServers: string[]
}
export type DnsRecord = {
  id: string
  type: string
  name: string
  content: string
  proxied: boolean
  ttl: number
  comment?: string
}
export type WorkerScript = {
  id: string
  createdOn: string
  modifiedOn: string
  usageModel?: string
  logpush?: boolean
}
export type PageProject = {
  name: string
  productionBranch: string
  latestUrl?: string
  latestStatus?: string
  domains: string[]
}
export type R2Bucket = { name: string; creationDate: string }
export type D1Database = { uuid: string; name: string; createdAt: string }
export type KvNamespace = { id: string; title: string }
export type Ruleset = { id: string; name: string; phase: string; ruleCount: number }
export type AnalyticsPoint = { time: string; requests: number }
export type AnalyticsSummary = { total: number; points: AnalyticsPoint[] }

// ---------- 账号 ----------

/** 验证令牌。注意：返回 401 不代表令牌已死（见文件头说明）。 */
export async function verifyToken(
  token: string
): Promise<{ status: number; active: boolean; message: string }> {
  const r = await cfCall(token, "/user/tokens/verify")
  if (r.status === 200 && r.json?.result?.status === "active") {
    return { status: 200, active: true, message: "active" }
  }
  return { status: r.status, active: false, message: errText(r) }
}

export async function listAccounts(token: string): Promise<Account[]> {
  const r = await cfCall(token, "/accounts")
  if (r.status !== 200 || !Array.isArray(r.json?.result)) {
    throw new Error("读取账号失败：" + errText(r))
  }
  return r.json.result.map((a: any) => ({ id: String(a.id), name: String(a.name ?? "") }))
}

export async function getSubdomain(token: string, accountId: string): Promise<string> {
  const r = await cfCall(token, `/accounts/${accountId}/workers/subdomain`)
  if (r.status === 200 && r.json?.result?.subdomain) {
    return String(r.json.result.subdomain)
  }
  return ""
}

// ---------- 域名 ----------

export async function listZones(token: string): Promise<Zone[]> {
  const r = await cfCall(token, "/zones?per_page=50")
  if (r.status !== 200 || !Array.isArray(r.json?.result)) {
    throw new Error("读取域名失败：" + errText(r))
  }
  return r.json.result.map((z: any) => ({
    id: String(z.id),
    name: String(z.name),
    status: String(z.status ?? ""),
    planName: String(z.plan?.name ?? ""),
    nameServers: Array.isArray(z.name_servers) ? z.name_servers.map(String) : [],
  }))
}

export async function listDnsRecords(token: string, zoneId: string): Promise<DnsRecord[]> {
  const r = await cfCall(token, `/zones/${zoneId}/dns_records?per_page=100`)
  if (r.status !== 200 || !Array.isArray(r.json?.result)) {
    throw new Error("读取 DNS 记录失败：" + errText(r))
  }
  return r.json.result.map((d: any) => ({
    id: String(d.id),
    type: String(d.type),
    name: String(d.name),
    content: String(d.content),
    proxied: d.proxied === true,
    ttl: Number(d.ttl ?? 1),
    comment: d.comment ? String(d.comment) : undefined,
  }))
}

export type DnsRecordInput = {
  type: string
  name: string
  content: string
  proxied: boolean
  ttl: number
  comment?: string
}

export async function createDnsRecord(
  token: string,
  zoneId: string,
  rec: DnsRecordInput
): Promise<DnsRecord> {
  const r = await cfCall(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: rec.type,
      name: rec.name,
      content: rec.content,
      proxied: rec.proxied,
      ttl: rec.ttl,
      comment: rec.comment || undefined,
    }),
  })
  if (!isOk(r) || !r.json?.result) {
    throw new Error("新建 DNS 记录失败：" + errText(r))
  }
  const d = r.json.result
  return {
    id: String(d.id),
    type: String(d.type),
    name: String(d.name),
    content: String(d.content),
    proxied: d.proxied === true,
    ttl: Number(d.ttl ?? 1),
    comment: d.comment ? String(d.comment) : undefined,
  }
}

export async function updateDnsRecord(
  token: string,
  zoneId: string,
  recordId: string,
  patch: Partial<DnsRecordInput>
): Promise<void> {
  const r = await cfCall(token, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
  if (!isOk(r)) {
    throw new Error("保存 DNS 记录失败：" + errText(r))
  }
}

export async function deleteDnsRecord(
  token: string,
  zoneId: string,
  recordId: string
): Promise<void> {
  const r = await cfCall(token, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: "DELETE",
  })
  if (!isOk(r)) {
    throw new Error("删除 DNS 记录失败：" + errText(r))
  }
}

/** WAF 自定义规则所在 ruleset（只读列表）。 */
export async function listRulesets(token: string, zoneId: string): Promise<Ruleset[]> {
  const r = await cfCall(token, `/zones/${zoneId}/rulesets`)
  if (r.status !== 200 || !Array.isArray(r.json?.result)) {
    throw new Error("读取规则集失败：" + errText(r))
  }
  return r.json.result.map((s: any) => ({
    id: String(s.id),
    name: String(s.name ?? ""),
    phase: String(s.phase ?? ""),
    ruleCount: Array.isArray(s.rules) ? s.rules.length : 0,
  }))
}

// ---------- Workers ----------

export async function listWorkers(token: string, accountId: string): Promise<WorkerScript[]> {
  const r = await cfCall(token, `/accounts/${accountId}/workers/scripts`)
  if (r.status !== 200 || !Array.isArray(r.json?.result)) {
    throw new Error("列出 Workers 失败：" + errText(r))
  }
  return r.json.result.map((s: any) => ({
    id: String(s.id),
    createdOn: String(s.created_on ?? ""),
    modifiedOn: String(s.modified_on ?? ""),
    usageModel: s.usage_model ? String(s.usage_model) : undefined,
    logpush: s.logpush === true,
  }))
}

export async function getWorker(
  token: string,
  accountId: string,
  name: string
): Promise<WorkerScript> {
  const r = await cfCall(token, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`)
  if (r.status !== 200 || !r.json?.result) {
    throw new Error("读取 Worker 详情失败：" + errText(r))
  }
  const s = r.json.result
  return {
    id: String(s.id),
    createdOn: String(s.created_on ?? ""),
    modifiedOn: String(s.modified_on ?? ""),
    usageModel: s.usage_model ? String(s.usage_model) : undefined,
    logpush: s.logpush === true,
  }
}

export type DeployResult = { ok: boolean; message: string; url: string }

/**
 * 部署 Worker（新建和覆盖都是同一个 PUT 接口，和 Wrangler 走同一套）。
 * 成功返回 workers.dev 地址（需要 subdomain；没有就只返回名称）。
 * 注意：403 通常是令牌权限不足——单 Worker 授权的令牌只能覆盖它已授权的那个。
 */
export async function deployWorker(
  token: string,
  accountId: string,
  name: string,
  code: string,
  subdomain: string
): Promise<DeployResult> {
  const form = new FormData()
  form.append(
    "metadata",
    JSON.stringify({
      main_module: "worker.js",
      compatibility_date: todayDate(),
      bindings: [],
    })
  )
  const scriptData = (globalThis as any).Data.fromRawString(code)
  if (!scriptData) {
    return { ok: false, message: "代码转码失败", url: "" }
  }
  form.append("script", scriptData, "application/javascript+module", "worker.js")

  const res = await fetch(
    `${API_BASE}/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: { Authorization: "Bearer " + token },
      body: form,
      timeout: 60,
    } as any
  )
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  if (res.status === 200 && json?.success) {
    const url = subdomain ? `https://${name}.${subdomain}.workers.dev` : ""
    return { ok: true, message: "部署成功", url }
  }
  const msg =
    json && Array.isArray(json.errors) && json.errors.length > 0
      ? json.errors.map((e: any) => e.message || e.code || "").join("; ")
      : `HTTP ${res.status}`
  return { ok: false, message: msg, url: "" }
}

// ---------- Pages ----------

export async function listPages(token: string, accountId: string): Promise<PageProject[]> {
  const r = await cfCall(token, `/accounts/${accountId}/pages/projects`)
  if (r.status !== 200 || !Array.isArray(r.json?.result)) {
    throw new Error("列出 Pages 失败：" + errText(r))
  }
  return r.json.result.map((p: any) => ({
    name: String(p.name),
    productionBranch: String(p.production_branch ?? ""),
    latestUrl: p.latest_deployment?.url ? String(p.latest_deployment.url) : undefined,
    latestStatus: p.latest_deployment?.latest_stage?.status
      ? String(p.latest_deployment.latest_stage.status)
      : undefined,
    domains: Array.isArray(p.domains) ? p.domains.map(String) : [],
  }))
}

// ---------- 存储 ----------

export async function listR2Buckets(token: string, accountId: string): Promise<R2Bucket[]> {
  const r = await cfCall(token, `/accounts/${accountId}/r2/buckets`)
  if (r.status !== 200 || !Array.isArray(r.json?.result)) {
    throw new Error("列出 R2 存储桶失败：" + errText(r))
  }
  return r.json.result.map((b: any) => ({
    name: String(b.name),
    creationDate: String(b.creation_date ?? ""),
  }))
}

export async function listD1Databases(token: string, accountId: string): Promise<D1Database[]> {
  const r = await cfCall(token, `/accounts/${accountId}/d1/database`)
  if (r.status !== 200 || !Array.isArray(r.json?.result)) {
    throw new Error("列出 D1 数据库失败：" + errText(r))
  }
  return r.json.result.map((d: any) => ({
    uuid: String(d.uuid),
    name: String(d.name),
    createdAt: String(d.created_at ?? ""),
  }))
}

export async function listKvNamespaces(token: string, accountId: string): Promise<KvNamespace[]> {
  const r = await cfCall(token, `/accounts/${accountId}/storage/kv/namespaces`)
  if (r.status !== 200 || !Array.isArray(r.json?.result)) {
    throw new Error("列出 KV 命名空间失败：" + errText(r))
  }
  return r.json.result.map((k: any) => ({
    id: String(k.id),
    title: String(k.title ?? ""),
  }))
}

// ---------- 流量 ----------

const ANALYTICS_QUERY = `query ZoneRequests($zoneTag: string, $since: Time, $until: Time) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequests1hGroups(limit: 24, filter: { datetime_geq: $since, datetime_leq: $until }) {
        dimensions { datetime }
        sum { requests }
      }
    }
  }
}`

/**
 * 最近 24 小时按小时的请求数（GraphQL）。免费账号的保留期有限，
 * 如果接口返回空组，就返回空列表，由界面提示。
 */
export async function zoneAnalytics24h(token: string, zoneId: string): Promise<AnalyticsSummary> {
  const now = new Date()
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const until = now.toISOString()
  const r = await cfCall(token, "/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: ANALYTICS_QUERY,
      variables: { zoneTag: zoneId, since, until },
    }),
  })
  if (r.status !== 200 || !r.json?.data) {
    throw new Error("读取流量失败：" + errText(r))
  }
  const groups = r.json.data?.viewer?.zones?.[0]?.httpRequests1hGroups
  if (!Array.isArray(groups)) {
    return { total: 0, points: [] }
  }
  const points: AnalyticsPoint[] = groups.map((g: any) => ({
    time: String(g.dimensions?.datetime ?? ""),
    requests: Number(g.sum?.requests ?? 0),
  }))
  const total = points.reduce((s, p) => s + p.requests, 0)
  return { total, points }
}
