// cf-api.ts 的 Node 单测：用假 fetch 覆盖请求构造、解析和错误处理。
// 不碰真实 Cloudflare API，不用真实令牌。
// 运行：node tests/cf-api.test.mjs （先由 esbuild 把 cf-api.ts 打包成 bundle）

import { execSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const bundlePath = "/tmp/orange-cf-api.bundle.mjs"
execSync(
  `npx esbuild /home/hatch/workspace/orange-cloud-scripting/cf-api.ts --bundle --format=esm --platform=node --outfile=${bundlePath} --log-level=error`,
  { stdio: "inherit" }
)
const api = await import(bundlePath)

// ---- 打桩 ----
globalThis.Data = { fromRawString: (s) => `DATA:${s.slice(0, 10)}` }

let calls = []
let nextResponses = []
function mockFetch(responses) {
  nextResponses = responses.slice()
  calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init?.method || "GET", headers: init?.headers || {}, body: init?.body })
    const r = nextResponses.shift()
    if (!r) throw new Error("mock fetch: 没有预设的响应 for " + url)
    return {
      status: r.status,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    }
  }
}

function jsonOk(result, extra) {
  return { status: 200, body: { success: true, errors: [], result, ...(extra || {}) } }
}
function jsonErr(status, message) {
  return { status, body: { success: false, errors: [{ message }], result: null } }
}

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) {
    passed++
    console.log(`  ok ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`)
  }
}
function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

const TOKEN = "test-token-123"
const ACCT = "acct-1"
const ZONE = "zone-1"

// ---------- cfCall / errText ----------
console.log("cfCall / errText")
mockFetch([jsonOk({ hello: "world" })])
let r = await api.cfCall(TOKEN, "/accounts")
check("URL 拼成 api.cloudflare.com/client/v4", calls[0].url === "https://api.cloudflare.com/client/v4/accounts", calls[0].url)
check("带 Bearer 头", calls[0].headers.Authorization === "Bearer " + TOKEN)
check("解析 JSON", eq(r.json.result, { hello: "world" }))
check("isOk 为 true", api.isOk(r) === true)

mockFetch([{ status: 200, body: "not json at all" }])
r = await api.cfCall(TOKEN, "/x")
check("非 JSON 正文返回 json null", r.json === null && r.text === "not json at all")

mockFetch([jsonErr(403, "No access to the specified resource")])
r = await api.cfCall(TOKEN, "/x")
check("errText 取 errors[0].message", api.errText(r) === "No access to the specified resource")
check("isOk 为 false", api.isOk(r) === false)

// ---------- verifyToken：401 不抛错、不代表令牌已死 ----------
console.log("verifyToken")
mockFetch([jsonErr(401, "Invalid token")])
let v = await api.verifyToken(TOKEN)
check("401 返回 active=false 不抛错", v.active === false && v.status === 401)
mockFetch([jsonOk({ status: "active", id: "tok-1" })])
v = await api.verifyToken(TOKEN)
check("200 active 返回 active=true", v.active === true)

// ---------- accounts / subdomain ----------
console.log("accounts / subdomain")
mockFetch([jsonOk([{ id: ACCT, name: "我的账号" }, { id: "acct-2", name: "第二个" }])])
let accts = await api.listAccounts(TOKEN)
check("解析账号列表", eq(accts, [{ id: ACCT, name: "我的账号" }, { id: "acct-2", name: "第二个" }]))

mockFetch([jsonErr(403, "forbidden")])
let threw = false
try {
  await api.listAccounts(TOKEN)
} catch (e) {
  threw = String(e).includes("读取账号失败")
}
check("账号接口失败时抛中文错误", threw)

mockFetch([jsonOk({ subdomain: "abc123" })])
check("子域名解析", (await api.getSubdomain(TOKEN, ACCT)) === "abc123")
mockFetch([jsonErr(404, "not found")])
check("查不到子域名返回空串", (await api.getSubdomain(TOKEN, ACCT)) === "")

// ---------- zones / DNS ----------
console.log("zones / DNS")
mockFetch([
  jsonOk([
    { id: ZONE, name: "example.com", status: "active", plan: { name: "Free" }, name_servers: ["ns1", "ns2"] },
  ]),
])
let zones = await api.listZones(TOKEN)
check("解析域名列表", zones.length === 1 && zones[0].planName === "Free" && zones[0].nameServers.length === 2)
check("zones 请求带 per_page", calls[0].url.includes("per_page=50"))

mockFetch([
  jsonOk([
    { id: "rec-1", type: "A", name: "www.example.com", content: "1.2.3.4", proxied: true, ttl: 1 },
    { id: "rec-2", type: "TXT", name: "example.com", content: "v=spf1", proxied: false, ttl: 300 },
  ]),
])
let recs = await api.listDnsRecords(TOKEN, ZONE)
check("解析 DNS 记录", recs.length === 2 && recs[0].proxied === true && recs[1].ttl === 300)

mockFetch([jsonOk({ id: "rec-9", type: "CNAME", name: "blog.example.com", content: "x.pages.dev", proxied: true, ttl: 1 })])
let created = await api.createDnsRecord(TOKEN, ZONE, { type: "CNAME", name: "blog", content: "x.pages.dev", proxied: true, ttl: 1 })
check("新建 DNS 用 POST", calls[0].method === "POST" && calls[0].url.includes(`/zones/${ZONE}/dns_records`))
check("新建 DNS 请求体带齐字段", (() => { const b = JSON.parse(calls[0].body); return b.type === "CNAME" && b.name === "blog" && b.proxied === true })())
check("新建 DNS 返回新记录", created.id === "rec-9")

mockFetch([jsonOk({ id: "rec-1" })])
await api.updateDnsRecord(TOKEN, ZONE, "rec-1", { content: "5.6.7.8", proxied: false })
check("改 DNS 用 PATCH", calls[0].method === "PATCH" && calls[0].url.endsWith("/dns_records/rec-1"))
check("改 DNS 请求体只含改的字段", (() => { const b = JSON.parse(calls[0].body); return b.content === "5.6.7.8" && b.proxied === false && !("type" in b) })())

mockFetch([jsonOk({ id: "rec-1" })])
await api.deleteDnsRecord(TOKEN, ZONE, "rec-1")
check("删 DNS 用 DELETE", calls[0].method === "DELETE" && calls[0].url.endsWith("/dns_records/rec-1"))

mockFetch([jsonErr(400, "bad record")])
threw = false
try {
  await api.createDnsRecord(TOKEN, ZONE, { type: "A", name: "@", content: "bad", proxied: false, ttl: 1 })
} catch (e) {
  threw = String(e).includes("新建 DNS 记录失败")
}
check("新建 DNS 失败抛中文错误", threw)

// ---------- rulesets ----------
console.log("rulesets")
mockFetch([jsonOk([{ id: "rs-1", name: "我的规则", phase: "http_request_firewall_custom", rules: [{}, {}] }])])
let rs = await api.listRulesets(TOKEN, ZONE)
check("解析 ruleset 规则数", rs.length === 1 && rs[0].ruleCount === 2 && rs[0].phase === "http_request_firewall_custom")

// ---------- workers ----------
console.log("workers")
mockFetch([
  jsonOk([
    { id: "one", created_on: "2026-01-01T00:00:00Z", modified_on: "2026-02-01T00:00:00Z", usage_model: "standard" },
    { id: "two", created_on: "2026-01-02T00:00:00Z", modified_on: "2026-02-02T00:00:00Z" },
  ]),
])
let workers = await api.listWorkers(TOKEN, ACCT)
check("解析 Workers 列表", workers.length === 2 && workers[0].usageModel === "standard" && workers[1].usageModel === undefined)

mockFetch([jsonOk({ id: "one", created_on: "2026-01-01T00:00:00Z", modified_on: "2026-03-01T00:00:00Z", usage_model: "bundled", logpush: true })])
let w = await api.getWorker(TOKEN, ACCT, "one")
check("解析 Worker 详情", w.logpush === true && w.modifiedOn.startsWith("2026-03-01"))

mockFetch([jsonOk({ id: "new-one" })])
let dep = await api.deployWorker(TOKEN, ACCT, "new-one", "export default {}", "abc123")
check("部署用 PUT 到脚本地址", calls[0].method === "PUT" && calls[0].url === `https://api.cloudflare.com/client/v4/accounts/${ACCT}/workers/scripts/new-one`)
check("部署成功返回 workers.dev 地址", dep.ok === true && dep.url === "https://new-one.abc123.workers.dev")

mockFetch([jsonErr(403, "No access to the specified resource")])
dep = await api.deployWorker(TOKEN, ACCT, "other", "export default {}", "")
check("部署 403 返回 ok=false 带原错误", dep.ok === false && dep.message.includes("No access"))

mockFetch([jsonOk({ id: "n" })])
dep = await api.deployWorker(TOKEN, ACCT, "n", "export default {}", "")
check("没有子域名时 url 为空但 ok=true", dep.ok === true && dep.url === "")

// ---------- pages / storage ----------
console.log("pages / storage")
mockFetch([
  jsonOk([
    { name: "mysite", production_branch: "main", latest_deployment: { url: "https://mysite.pages.dev", latest_stage: { status: "success" } }, domains: ["mysite.pages.dev"] },
  ]),
])
let pages = await api.listPages(TOKEN, ACCT)
check("解析 Pages 项目", pages.length === 1 && pages[0].latestUrl === "https://mysite.pages.dev" && pages[0].latestStatus === "success")

mockFetch([jsonOk([{ name: "bucket-a", creation_date: "2026-01-01T00:00:00Z" }])])
let buckets = await api.listR2Buckets(TOKEN, ACCT)
check("解析 R2 存储桶", buckets.length === 1 && buckets[0].name === "bucket-a")

mockFetch([jsonOk([{ uuid: "d1-1", name: "mydb", created_at: "2026-01-01T00:00:00Z" }])])
let dbs = await api.listD1Databases(TOKEN, ACCT)
check("解析 D1 数据库", dbs.length === 1 && dbs[0].uuid === "d1-1")

mockFetch([jsonOk([{ id: "kv-1", title: "my-kv" }])])
let kvs = await api.listKvNamespaces(TOKEN, ACCT)
check("解析 KV 命名空间", kvs.length === 1 && kvs[0].title === "my-kv")

// ---------- analytics ----------
console.log("analytics")
mockFetch([
  jsonOk(null, {
    data: {
      viewer: {
        zones: [
          {
            httpRequests1hGroups: [
              { dimensions: { datetime: "2026-11-23T00:00:00Z" }, sum: { requests: 100 } },
              { dimensions: { datetime: "2026-11-23T01:00:00Z" }, sum: { requests: 250 } },
            ],
          },
        ],
      },
    },
  }),
])
// 注意：上面 jsonOk 的 result 是 null，data 在 extra 里；GraphQL 返回 success 未必有，
// 这里直接用 data 分支。重新 mock 一次更贴近真实返回：
mockFetch([
  { status: 200, body: { success: true, errors: [], data: { viewer: { zones: [{ httpRequests1hGroups: [
    { dimensions: { datetime: "2026-11-23T00:00:00Z" }, sum: { requests: 100 } },
    { dimensions: { datetime: "2026-11-23T01:00:00Z" }, sum: { requests: 250 } },
  ] }] } } } },
])
let an = await api.zoneAnalytics24h(TOKEN, ZONE)
check("流量请求是 POST /graphql", calls[0].method === "POST" && calls[0].url.endsWith("/graphql"))
check("流量请求体带 zoneTag 变量", (() => { const b = JSON.parse(calls[0].body); return b.variables.zoneTag === ZONE && b.query.includes("httpRequests1hGroups") })())
check("流量总和相加正确", an.total === 350 && an.points.length === 2)

mockFetch([{ status: 200, body: { success: true, errors: [], data: { viewer: { zones: [{ httpRequests1hGroups: [] }] } } } }])
an = await api.zoneAnalytics24h(TOKEN, ZONE)
check("空流量组返回 total 0", an.total === 0 && an.points.length === 0)

// ---------- 格式化 ----------
console.log("formatting")
check("fmtNum 千分位", api.fmtNum(1234567) === "1,234,567")
check("fmtNum 非数字", api.fmtNum(NaN) === "—")
check("fmtTime 短格式", api.fmtTime("2026-11-23T08:05:00Z").includes("/23"))

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
