// Orange Cloud Scripting 版 v1.0.1
// iPhone 上的 Cloudflare 管理客户端（Scripting App，TypeScript + TSX）。
// 覆盖：账号检测、域名与 DNS（增删改查 + 代理开关）、Workers（列表、详情、部署）、
// Pages、存储（R2 / D1 / KV）、24 小时流量、WAF 规则集（只读）。
// v1.0.1：底部 Tab 栏（首页 / 域名 / Workers / 存储 / 流量），首页是指挥台——
// 问候 + 日期、域名 / Workers / DNS / R2 数量卡片、24 小时请求数、域名列表（字母头像）。
// 不做：OAuth 登录（改用 API Token，更简单）、实时日志流（WebSocket，Scripting 不支持）、
// Apple Watch、图表/折线图/用量圆环（Scripting 画不了图，横条用线性 ProgressView 代替）、
// WAF 规则编辑。
// 令牌只保存在本机钥匙串（和旧版部署脚本同一把钥匙 cf_api_token），
// 不会打印到日志，也不会上传到别处。
// 提醒：/user/tokens/verify 返回 401 不代表令牌已死，账号和列表接口能通就是有效。

import {
  useState,
  useEffect,
  useObservable,
  HStack,
  VStack,
  ZStack,
  Text,
  TextField,
  SecureField,
  Button,
  List,
  Section,
  NavigationStack,
  NavigationLink,
  Navigation,
  Script,
  TabView,
  Tab,
  ProgressView,
  Grid,
  GridRow,
  Circle,
} from "scripting"
import {
  Account,
  Zone,
  DnsRecord,
  WorkerScript,
  PageProject,
  R2Bucket,
  D1Database,
  KvNamespace,
  Ruleset,
  verifyToken,
  listAccounts,
  getSubdomain,
  listZones,
  listDnsRecords,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
  listRulesets,
  listWorkers,
  getWorker,
  deployWorker,
  listPages,
  listR2Buckets,
  listD1Databases,
  listKvNamespaces,
  zoneAnalytics24h,
  fmtNum,
  fmtTime,
  fmtDate,
} from "./cf-api"

// 注意：Keychain、Dialog、Pasteboard、EditorController、Safari、Data、
// FormData、DocumentPicker、FileManager 是 App 运行时提供的全局对象，
// 不能从 "scripting" 导入。fetch 同样是全局的。

const TOKEN_KEY = "cf_api_token"
const ACCOUNT_KEY = "cf_account_id"
const SUBDOMAIN_KEY = "cf_subdomain"
const TARGET_KEY = "cf_deploy_worker"
const CODE_PREVIEW_LINES = 12

const HELLO_WORKER = `export default {
  async fetch(request) {
    return new Response("Hello from Cloudflare Workers!", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  },
}
`

const DNS_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX"]

function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

function codeLineCount(code: string): number {
  return code === "" ? 0 : code.split("\n").length
}

function codePreview(code: string): string {
  const lines = code.split("\n").slice(0, CODE_PREVIEW_LINES)
  const more = codeLineCount(code) - lines.length
  return lines.join("\n") + (more > 0 ? `\n…（还有 ${more} 行）` : "")
}

function NeedToken() {
  return (
    <Section>
      <Text>还没有令牌。请先回首页，在“账号”里粘贴 API Token 并点“开始检测”。</Text>
      <Text font="caption">令牌获取：dash.cloudflare.com → 右上角头像 → API Tokens → Create Token（Edit Cloudflare Workers 模板权限最全；只想覆盖某个已有 Worker 的话，Individual Workers 只授权那一个也行）。</Text>
    </Section>
  )
}

// ---------- 域名 ----------

function DnsEditView({
  token,
  zone,
  record,
}: {
  token: string
  zone: Zone
  record: DnsRecord
}) {
  const [content, setContent] = useState(record.content)
  const [ttl, setTtl] = useState(String(record.ttl))
  const [proxied, setProxied] = useState(record.proxied)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!content.trim()) {
      await Dialog.alert({ title: "内容为空", message: "记录内容不能为空。" })
      return
    }
    const ttlNum = parseInt(ttl, 10)
    setBusy(true)
    try {
      await updateDnsRecord(token, zone.id, record.id, {
        content: content.trim(),
        ttl: Number.isFinite(ttlNum) && ttlNum >= 1 ? ttlNum : 1,
        proxied,
      })
      await Dialog.alert({ title: "已保存", message: "返回上一页后点“刷新”就能看到新值。" })
    } catch (e) {
      await Dialog.alert({ title: "保存失败", message: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ok = await Dialog.confirm({
      title: "删除这条记录？",
      message: `${record.type} ${record.name} → ${record.content}`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteDnsRecord(token, zone.id, record.id)
      await Dialog.alert({ title: "已删除", message: "返回上一页后点“刷新”。" })
    } catch (e) {
      await Dialog.alert({ title: "删除失败", message: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <List navigationTitle={`${record.type} · ${record.name}`}>
      <Section header={<Text>记录内容</Text>}>
        <Text font="caption">类型：{record.type}</Text>
        <Text font="caption">名称：{record.name}</Text>
        <TextField title="内容" value={content} onChanged={setContent} prompt="记录内容，例如 1.2.3.4" />
        <TextField title="TTL（秒，1 = 自动）" value={ttl} onChanged={setTtl} prompt="1" />
        <Button
          title={proxied ? "● 已开启代理（橙色云）" : "○ 未开启代理（灰色云）"}
          action={() => setProxied(!proxied)}
        />
        <Text font="caption">开启代理后，访问会先过 Cloudflare（能挡攻击、能缓存）；关闭就是直接解析到源站。</Text>
      </Section>
      <Section>
        <Button title={busy ? "保存中…" : "保存修改"} action={save} />
        <Button title="删除这条记录" action={remove} role="destructive" />
      </Section>
    </List>
  )
}

function DnsAddView({ token, zone }: { token: string; zone: Zone }) {
  const [type, setType] = useState("A")
  const [name, setName] = useState("")
  const [content, setContent] = useState("")
  const [ttl, setTtl] = useState("1")
  const [proxied, setProxied] = useState(true)
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!name.trim() || !content.trim()) {
      await Dialog.alert({ title: "没填完", message: "名称和内容都要填。名称填 @ 表示根域名，填 www 表示 www 子域名。" })
      return
    }
    const ttlNum = parseInt(ttl, 10)
    setBusy(true)
    try {
      await createDnsRecord(token, zone.id, {
        type,
        name: name.trim(),
        content: content.trim(),
        proxied,
        ttl: Number.isFinite(ttlNum) && ttlNum >= 1 ? ttlNum : 1,
      })
      await Dialog.alert({ title: "已添加", message: "返回上一页后点“刷新”就能看到。" })
      setName("")
      setContent("")
    } catch (e) {
      await Dialog.alert({ title: "添加失败", message: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <List navigationTitle={`新建记录 · ${zone.name}`}>
      <Section header={<Text>类型（点一个）</Text>}>
        <HStack>
          {DNS_TYPES.map((t) => (
            <Button key={t} title={type === t ? `● ${t}` : t} action={() => setType(t)} />
          ))}
        </HStack>
        <Text font="caption">
          {type === "A"
            ? "A：把域名指向一个 IPv4 地址。"
            : type === "AAAA"
              ? "AAAA：把域名指向一个 IPv6 地址。"
              : type === "CNAME"
                ? "CNAME：把域名指向另一个域名（比如 Pages 的地址）。"
                : type === "TXT"
                  ? "TXT：放一段文字，常用来验证域名归属。"
                  : "MX：指定收这个域名邮件的服务器。"}
        </Text>
      </Section>
      <Section header={<Text>内容</Text>}>
        <TextField title="名称" value={name} onChanged={setName} prompt="@ 或 www 或子域名" />
        <TextField title="内容" value={content} onChanged={setContent} prompt="A 填 IP，CNAME 填域名" />
        <TextField title="TTL（秒，1 = 自动）" value={ttl} onChanged={setTtl} prompt="1" />
        <Button
          title={proxied ? "● 已开启代理（橙色云）" : "○ 未开启代理（灰色云）"}
          action={() => setProxied(!proxied)}
        />
      </Section>
      <Section>
        <Button title={busy ? "添加中…" : "添加记录"} action={add} />
      </Section>
    </List>
  )
}

function ZoneDetailView({ token, zone }: { token: string; zone: Zone }) {
  const [records, setRecords] = useState<DnsRecord[]>([])
  const [rulesets, setRulesets] = useState<Ruleset[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr("")
    ;(async () => {
      try {
        const [recs, sets] = await Promise.all([
          listDnsRecords(token, zone.id),
          listRulesets(token, zone.id).catch(() => [] as Ruleset[]),
        ])
        if (!alive) return
        setRecords(recs)
        setRulesets(sets)
      } catch (e) {
        if (alive) setErr(errText(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [zone.id, reloadKey])

  return (
    <List navigationTitle={zone.name}>
      <Section header={<Text>域名信息</Text>}>
        <Text font="caption">状态：{zone.status}</Text>
        <Text font="caption">套餐：{zone.planName || "—"}</Text>
        {zone.nameServers.length > 0 ? (
          <Text font="caption">域名服务器：{zone.nameServers.join("、")}</Text>
        ) : null}
        <Button title="刷新" action={() => setReloadKey((k) => k + 1)} />
      </Section>
      <Section
        header={
          <Text>
            {loading ? "DNS 记录加载中…" : err ? `加载失败：${err}` : `DNS 记录（${records.length} 条）`}
          </Text>
        }
      >
        <NavigationLink destination={<DnsAddView token={token} zone={zone} />}>
          <Text>＋ 新建记录</Text>
        </NavigationLink>
        {records.map((rec) => (
          <NavigationLink
            key={rec.id}
            destination={<DnsEditView token={token} zone={zone} record={rec} />}
          >
            <VStack>
              <Text>
                {rec.type} {rec.name}
              </Text>
              <Text font="caption">
                {rec.content}
                {rec.proxied ? " · 已代理" : " · 未代理"}
                {rec.ttl === 1 ? " · TTL 自动" : ` · TTL ${rec.ttl} 秒`}
              </Text>
            </VStack>
          </NavigationLink>
        ))}
      </Section>
      <Section header={<Text>WAF 规则集（只读，看一眼）</Text>}>
        {rulesets.length === 0 ? (
          <Text font="caption">没有规则集，或当前令牌看不到。</Text>
        ) : (
          rulesets.map((s) => (
            <Text key={s.id} font="caption">
              {s.name} · {s.phase} · {s.ruleCount} 条规则
            </Text>
          ))
        )}
        <Text font="caption">改规则要去 Cloudflare 面板，手机端这里只列出来给你确认。</Text>
      </Section>
    </List>
  )
}

function ZoneListView({ token }: { token: string }) {
  const [zones, setZones] = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")

  useEffect(() => {
    let alive = true
    if (!token) {
      setLoading(false)
      return
    }
    listZones(token)
      .then((z) => {
        if (alive) setZones(z)
      })
      .catch((e) => {
        if (alive) setErr(errText(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [token])

  if (!token) {
    return (
      <List navigationTitle="域名">
        <NeedToken />
      </List>
    )
  }

  return (
    <List navigationTitle="域名">
      <Section
        header={
          <Text>
            {loading ? "加载中…" : err ? `加载失败：${err}` : `共 ${zones.length} 个域名`}
          </Text>
        }
      >
        {zones.length === 0 && !loading && !err ? (
          <Text font="caption">这个账号下还没有域名。</Text>
        ) : null}
        {zones.map((z) => (
          <NavigationLink key={z.id} destination={<ZoneDetailView token={token} zone={z} />}>
            <VStack>
              <Text>{z.name}</Text>
              <Text font="caption">
                {z.status}
                {z.planName ? ` · ${z.planName}` : ""}
              </Text>
            </VStack>
          </NavigationLink>
        ))}
      </Section>
    </List>
  )
}

// ---------- Workers ----------

function WorkerDetailView({
  token,
  accountId,
  subdomain,
  name,
}: {
  token: string
  accountId: string
  subdomain: string
  name: string
}) {
  const [info, setInfo] = useState<WorkerScript | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [code, setCode] = useState(HELLO_WORKER)
  const [deploying, setDeploying] = useState(false)
  const [deployLines, setDeployLines] = useState<string[]>([])
  const [deployedUrl, setDeployedUrl] = useState("")

  useEffect(() => {
    let alive = true
    getWorker(token, accountId, name)
      .then((w) => {
        if (alive) setInfo(w)
      })
      .catch((e) => {
        if (alive) setErr(errText(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [token, accountId, name])

  function push(line: string) {
    setDeployLines((prev) => [...prev, line])
  }

  async function openEditor() {
    const editor = new EditorController({ content: code, ext: "js" })
    await editor.present({ navigationTitle: "编辑 Worker 代码" })
    if (editor.content.trim().length > 0) {
      setCode(editor.content)
    }
  }

  async function pasteCode() {
    const text = await Pasteboard.getString()
    if (text && text.trim().length > 0) {
      setCode(text)
    } else {
      await Dialog.alert({ title: "剪贴板是空的", message: "请先去复制 Worker 代码，再回来点粘贴。" })
    }
  }

  async function pickFile() {
    let picked: string[] | null = null
    try {
      picked = await DocumentPicker.pickFiles()
    } catch (e) {
      await Dialog.alert({ title: "选文件失败", message: String(e) })
      return
    }
    if (!picked || picked.length === 0) return
    const path = picked[0]
    const lower = path.toLowerCase()
    if (!lower.endsWith(".js") && !lower.endsWith(".mjs")) {
      await Dialog.alert({ title: "不是 JS 文件", message: "请选择 .js / .mjs 文件。" })
      return
    }
    try {
      const fileCode = FileManager.readAsStringSync(path)
      if (!fileCode.trim()) {
        await Dialog.alert({ title: "文件是空的", message: "选中的文件没有代码。" })
        return
      }
      setCode(fileCode)
    } catch (e) {
      await Dialog.alert({ title: "读取文件失败", message: String(e) })
    }
  }

  async function deploy() {
    const useCode = code.trim()
    if (!useCode) {
      await Dialog.alert({ title: "代码为空", message: "请先粘贴、编写或从文件选择 Worker 代码。" })
      return
    }
    setDeploying(true)
    setDeployLines([])
    setDeployedUrl("")
    try {
      push(`正在上传 ${name} …`)
      const res = await deployWorker(token, accountId, name, useCode, subdomain)
      if (res.ok) {
        push(`✅ 部署成功：${name}`)
        if (res.url) {
          setDeployedUrl(res.url)
          push(`地址：${res.url}`)
          try {
            const check = await fetch(res.url, { timeout: 20 })
            const body = await check.text()
            push(`✅ 实测访问：HTTP ${check.status}，返回 ${body.slice(0, 120)}`)
          } catch (e) {
            push(`⚠️ 地址已生成，但实测访问失败：${String(e)}（稍后在浏览器里再试一次）`)
          }
        }
      } else {
        push(`❌ 部署失败：${res.message}`)
        if (res.message.includes("403") || res.message.includes("No access")) {
          push("提示：403 通常是令牌权限不足。单 Worker 授权的令牌只能覆盖它已授权的那个 Worker。")
        }
      }
    } catch (e) {
      push(`❌ 部署出错：${String(e)}`)
    } finally {
      setDeploying(false)
    }
  }

  async function copyUrl() {
    if (!deployedUrl) return
    await Pasteboard.setString(deployedUrl)
    await Dialog.alert({ title: "已复制", message: deployedUrl })
  }

  return (
    <List navigationTitle={name}>
      <Section header={<Text>详情</Text>}>
        {loading ? (
          <Text>加载中…</Text>
        ) : err || !info ? (
          <Text>加载失败：{err || "未知错误"}</Text>
        ) : (
          <>
            <Text font="caption">创建：{fmtDate(info.createdOn)}</Text>
            <Text font="caption">最后修改：{fmtTime(info.modifiedOn)}</Text>
            {info.usageModel ? <Text font="caption">计费模式：{info.usageModel}</Text> : null}
            <Text font="caption">
              地址：{subdomain ? `https://${name}.${subdomain}.workers.dev` : "子域名未知"}
            </Text>
          </>
        )}
      </Section>
      <Section header={<Text>部署（覆盖这个 Worker）</Text>}>
        <Text font="caption">部署就是把下面的代码写进这个 Worker，旧代码会被替换。部署成功后 Worker 立刻按新代码跑。</Text>
        <Text font="headline">代码预览</Text>
        <Text font="caption">{`共 ${codeLineCount(code)} 行 / ${code.length} 字符`}</Text>
        <Text font="caption">{codePreview(code)}</Text>
        <HStack>
          <Button title="编辑代码" action={openEditor} />
          <Button title="从剪贴板粘贴" action={pasteCode} />
        </HStack>
        <Button title="从文件选择代码" action={pickFile} />
        <Button title={deploying ? "部署中…" : "部署 Worker"} action={deploy} />
      </Section>
      <Section header={<Text>部署结果</Text>}>
        {deployLines.length === 0 ? (
          <Text font="caption">尚未部署</Text>
        ) : (
          deployLines.map((line, i) => (
            <Text key={i} font="caption">{line}</Text>
          ))
        )}
        {deployedUrl ? (
          <HStack>
            <Button title="复制地址" action={copyUrl} />
            <Button
              title="应用内预览"
              action={async () => {
                await Safari.present(deployedUrl)
              }}
            />
            <Button
              title="浏览器打开"
              action={async () => {
                await Safari.openURL(deployedUrl)
              }}
            />
          </HStack>
        ) : null}
      </Section>
    </List>
  )
}

function WorkerCreateView({
  token,
  accountId,
  subdomain,
}: {
  token: string
  accountId: string
  subdomain: string
}) {
  const [name, setName] = useState("")
  const [code, setCode] = useState(HELLO_WORKER)
  const [deploying, setDeploying] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [url, setUrl] = useState("")

  function push(line: string) {
    setLines((prev) => [...prev, line])
  }

  async function deploy() {
    const n = name.trim()
    if (!/^[a-z0-9][a-z0-9-]*$/.test(n)) {
      await Dialog.alert({
        title: "名称不对",
        message: "Worker 名称只能用小写字母、数字和连字符，且以字母或数字开头。",
      })
      return
    }
    if (!code.trim()) {
      await Dialog.alert({ title: "代码为空", message: "请先写代码。" })
      return
    }
    setDeploying(true)
    setLines([])
    setUrl("")
    try {
      const res = await deployWorker(token, accountId, n, code.trim(), subdomain)
      if (res.ok) {
        push(`✅ 新建成功：${n}`)
        if (res.url) {
          setUrl(res.url)
          push(`地址：${res.url}`)
        }
      } else {
        push(`❌ 新建失败：${res.message}`)
        push("提示：新建需要账号级 Workers 权限。如果令牌只授权给了个别已有 Worker，会报 403，请改用列表里的“覆盖”方式。")
      }
    } catch (e) {
      push(`❌ 出错：${String(e)}`)
    } finally {
      setDeploying(false)
    }
  }

  async function openEditor() {
    const editor = new EditorController({ content: code, ext: "js" })
    await editor.present({ navigationTitle: "编辑 Worker 代码" })
    if (editor.content.trim().length > 0) {
      setCode(editor.content)
    }
  }

  return (
    <List navigationTitle="新建 Worker">
      <Section header={<Text>名称与代码</Text>}>
        <TextField title="Worker 名称" value={name} onChanged={setName} prompt="小写字母、数字、连字符" />
        <Text font="caption">{`共 ${codeLineCount(code)} 行 / ${code.length} 字符`}</Text>
        <Text font="caption">{codePreview(code)}</Text>
        <Button title="编辑代码" action={openEditor} />
        <Button title={deploying ? "新建中…" : "新建并部署"} action={deploy} />
      </Section>
      <Section header={<Text>结果</Text>}>
        {lines.length === 0 ? (
          <Text font="caption">尚未新建</Text>
        ) : (
          lines.map((line, i) => (
            <Text key={i} font="caption">{line}</Text>
          ))
        )}
        {url ? <Text font="caption">{url}</Text> : null}
      </Section>
    </List>
  )
}

function WorkerListView({
  token,
  accountId,
  subdomain,
}: {
  token: string
  accountId: string
  subdomain: string
}) {
  const [workers, setWorkers] = useState<WorkerScript[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    if (!token || !accountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    listWorkers(token, accountId)
      .then((w) => {
        if (alive) setWorkers(w)
      })
      .catch((e) => {
        if (alive) setErr(errText(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [token, accountId, reloadKey])

  if (!token || !accountId) {
    return (
      <List navigationTitle="Workers">
        <NeedToken />
      </List>
    )
  }

  return (
    <List navigationTitle="Workers">
      <Section>
        <NavigationLink
          destination={<WorkerCreateView token={token} accountId={accountId} subdomain={subdomain} />}
        >
          <Text>＋ 新建 Worker</Text>
        </NavigationLink>
        <Button title="刷新" action={() => setReloadKey((k) => k + 1)} />
      </Section>
      <Section
        header={
          <Text>
            {loading ? "加载中…" : err ? `加载失败：${err}` : `共 ${workers.length} 个 Worker`}
          </Text>
        }
      >
        {workers.length === 0 && !loading && !err ? (
          <Text font="caption">这个账号下还没有 Worker，点上面“新建 Worker”。</Text>
        ) : null}
        {workers.map((w) => (
          <NavigationLink
            key={w.id}
            destination={
              <WorkerDetailView token={token} accountId={accountId} subdomain={subdomain} name={w.id} />
            }
          >
            <VStack>
              <Text>{w.id}</Text>
              <Text font="caption">最后修改：{fmtTime(w.modifiedOn)}</Text>
            </VStack>
          </NavigationLink>
        ))}
      </Section>
      <Section header={<Text>Pages</Text>}>
        <NavigationLink destination={<PagesListView token={token} accountId={accountId} />}>
          <VStack>
            <Text>Pages 项目</Text>
            <Text font="caption">项目列表、最近一次部署状态</Text>
          </VStack>
        </NavigationLink>
      </Section>
      <Section>
        <Text font="caption">点一个 Worker 进去可以看详情、改代码、重新部署（覆盖）。实时日志流（wrangler tail 那种）Scripting 不支持，要看日志去 Cloudflare 面板。</Text>
      </Section>
    </List>
  )
}

// ---------- Pages ----------

function PagesListView({ token, accountId }: { token: string; accountId: string }) {
  const [pages, setPages] = useState<PageProject[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")

  useEffect(() => {
    let alive = true
    if (!token || !accountId) {
      setLoading(false)
      return
    }
    listPages(token, accountId)
      .then((p) => {
        if (alive) setPages(p)
      })
      .catch((e) => {
        if (alive) setErr(errText(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [token, accountId])

  if (!token || !accountId) {
    return (
      <List navigationTitle="Pages">
        <NeedToken />
      </List>
    )
  }

  return (
    <List navigationTitle="Pages">
      <Section
        header={
          <Text>
            {loading ? "加载中…" : err ? `加载失败：${err}` : `共 ${pages.length} 个项目`}
          </Text>
        }
      >
        {pages.length === 0 && !loading && !err ? (
          <Text font="caption">这个账号下还没有 Pages 项目。</Text>
        ) : null}
      </Section>
      {pages.map((p) => (
        <Section key={p.name} header={<Text>{p.name}</Text>}>
          <Text font="caption">生产分支：{p.productionBranch || "—"}</Text>
          {p.latestStatus ? <Text font="caption">最近一次部署：{p.latestStatus}</Text> : null}
          {p.latestUrl ? <Text font="caption">地址：{p.latestUrl}</Text> : null}
          {p.latestUrl ? (
            <Button
              title="浏览器打开"
              action={async () => {
                await Safari.openURL(p.latestUrl!)
              }}
            />
          ) : null}
          {p.domains.length > 0 ? (
            <Text font="caption">域名：{p.domains.join("、")}</Text>
          ) : null}
        </Section>
      ))}
      <Section>
        <Text font="caption">这里只列项目和最近一次部署状态。新建 Pages 项目要去 Cloudflare 面板（一般是连 GitHub 仓库自动部署）。</Text>
      </Section>
    </List>
  )
}

// ---------- 存储 ----------

function StorageView({ token, accountId }: { token: string; accountId: string }) {
  const [buckets, setBuckets] = useState<R2Bucket[]>([])
  const [dbs, setDbs] = useState<D1Database[]>([])
  const [kvs, setKvs] = useState<KvNamespace[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")

  useEffect(() => {
    let alive = true
    if (!token || !accountId) {
      setLoading(false)
      return
    }
    ;(async () => {
      try {
        const [b, d, k] = await Promise.all([
          listR2Buckets(token, accountId),
          listD1Databases(token, accountId),
          listKvNamespaces(token, accountId),
        ])
        if (!alive) return
        setBuckets(b)
        setDbs(d)
        setKvs(k)
      } catch (e) {
        if (alive) setErr(errText(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [token, accountId])

  if (!token || !accountId) {
    return (
      <List navigationTitle="存储">
        <NeedToken />
      </List>
    )
  }

  return (
    <List navigationTitle="存储">
      <Section header={<Text>{loading ? "加载中…" : err ? `加载失败：${err}` : "R2 存储桶"}</Text>}>
        {buckets.length === 0 && !loading ? (
          <Text font="caption">没有存储桶。</Text>
        ) : (
          buckets.map((b) => (
            <VStack key={b.name}>
              <Text>{b.name}</Text>
              {b.creationDate ? <Text font="caption">创建：{fmtDate(b.creationDate)}</Text> : null}
            </VStack>
          ))
        )}
      </Section>
      <Section header={<Text>D1 数据库</Text>}>
        {dbs.length === 0 && !loading ? (
          <Text font="caption">没有数据库。</Text>
        ) : (
          dbs.map((d) => (
            <VStack key={d.uuid}>
              <Text>{d.name}</Text>
              <Text font="caption">{d.uuid}</Text>
            </VStack>
          ))
        )}
      </Section>
      <Section header={<Text>KV 命名空间</Text>}>
        {kvs.length === 0 && !loading ? (
          <Text font="caption">没有命名空间。</Text>
        ) : (
          kvs.map((k) => (
            <VStack key={k.id}>
              <Text>{k.title}</Text>
              <Text font="caption">{k.id}</Text>
            </VStack>
          ))
        )}
      </Section>
      <Section>
        <Text font="caption">这里只列出来。新建存储桶 / 数据库 / 命名空间、删数据、跑 SQL，都去 Cloudflare 面板做，手机端改这些容易误操作。</Text>
      </Section>
    </List>
  )
}

// ---------- 流量 ----------

function AnalyticsView({ token }: { token: string }) {
  const [zones, setZones] = useState<Zone[]>([])
  const [zoneId, setZoneId] = useState("")
  const [total, setTotal] = useState(0)
  const [points, setPoints] = useState<Array<{ time: string; requests: number }>>([])
  const [loading, setLoading] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [err, setErr] = useState("")

  useEffect(() => {
    let alive = true
    if (!token) {
      setLoading(false)
      return
    }
    listZones(token)
      .then((z) => {
        if (alive) setZones(z)
      })
      .catch((e) => {
        if (alive) setErr(errText(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [token])

  async function loadData(id: string) {
    setZoneId(id)
    setLoadingData(true)
    setErr("")
    try {
      const r = await zoneAnalytics24h(token, id)
      setTotal(r.total)
      setPoints([...r.points].reverse())
    } catch (e) {
      setErr(errText(e))
      setTotal(0)
      setPoints([])
    } finally {
      setLoadingData(false)
    }
  }

  if (!token) {
    return (
      <List navigationTitle="流量">
        <NeedToken />
      </List>
    )
  }

  const zoneName = zones.find((z) => z.id === zoneId)?.name ?? ""

  return (
    <List navigationTitle="流量">
      <Section header={<Text>选一个域名</Text>}>
        {loading ? (
          <Text>加载域名中…</Text>
        ) : zones.length === 0 ? (
          <Text font="caption">这个账号下还没有域名。</Text>
        ) : (
          zones.map((z) => (
            <Button
              key={z.id}
              title={zoneId === z.id ? `● ${z.name}` : z.name}
              action={() => loadData(z.id)}
            />
          ))
        )}
      </Section>
      {zoneId ? (
        <Section header={<Text>{`${zoneName} · 最近 24 小时`}</Text>}>
          {loadingData ? (
            <Text>加载中…</Text>
          ) : err ? (
            <Text>加载失败：{err}</Text>
          ) : points.length === 0 ? (
            <Text font="caption">最近 24 小时没有请求，或者免费账号看不到这段数据。</Text>
          ) : (
            <>
              <Text font="headline">共 {fmtNum(total)} 次请求</Text>
              {points.map((p) => (
                <HStack key={p.time}>
                  <Text font="caption">{fmtTime(p.time)}</Text>
                  <Text font="caption">{fmtNum(p.requests)} 次</Text>
                </HStack>
              ))}
            </>
          )}
        </Section>
      ) : null}
      <Section>
        <Text font="caption">这里只显示按小时的请求数。更细的分析（7 天 / 30 天、按国家、按状态码）要去 Cloudflare 面板看。</Text>
      </Section>
    </List>
  )
}

// ---------- 首页（指挥台） ----------

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]
const AVATAR_COLORS = ["orange", "blue", "green", "purple", "red", "brown"]

function greeting(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return "早上好"
  if (h >= 12 && h < 18) return "下午好"
  return "晚上好"
}

function todayStr(): string {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
}

function avatarColor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function ZoneAvatar({ name }: { name: string }) {
  const letter = (name.trim()[0] || "?").toUpperCase()
  return (
    <ZStack>
      <Circle fill={avatarColor(name)} frame={{ width: 36, height: 36 }} />
      <Text fontWeight="bold" foregroundColor="white">
        {letter}
      </Text>
    </ZStack>
  )
}

function StatCell({ label, value }: { label: string; value: number | null }) {
  return (
    <VStack alignment="leading">
      <Text font="caption">{label}</Text>
      <Text font="title">{value === null ? "…" : fmtNum(value)}</Text>
    </VStack>
  )
}

type HomeProps = {
  token: string
  setToken: (v: string) => void
  accountId: string
  setAccountId: (v: string) => void
  accountName: string
  setAccountName: (v: string) => void
  accounts: Account[]
  setAccounts: (v: Account[]) => void
  subdomain: string
  setSubdomain: (v: string) => void
}

function HomeView({
  token,
  setToken,
  accountId,
  setAccountId,
  accountName,
  setAccountName,
  accounts,
  setAccounts,
  subdomain,
  setSubdomain,
}: HomeProps) {
  const [tokenSaved, setTokenSaved] = useState(false)
  const [detectLines, setDetectLines] = useState<string[]>([])
  const [detecting, setDetecting] = useState(false)
  const [zones, setZones] = useState<Zone[]>([])
  const [zoneCount, setZoneCount] = useState<number | null>(null)
  const [workerCount, setWorkerCount] = useState<number | null>(null)
  const [dnsCount, setDnsCount] = useState<number | null>(null)
  const [r2Count, setR2Count] = useState<number | null>(null)
  const [totalRequests, setTotalRequests] = useState<number | null>(null)
  const [perZoneReq, setPerZoneReq] = useState<Array<{ zone: Zone; requests: number }>>([])
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsErr, setStatsErr] = useState("")
  const [statsKey, setStatsKey] = useState(0)

  useEffect(() => {
    if (Keychain.get(TOKEN_KEY)) setTokenSaved(true)
  }, [])

  // 指挥台数据：域名数、Workers 数、DNS 总数、R2 桶数、24 小时请求数。
  // 每个接口单独兜底，某个失败不影响其他数字。
  useEffect(() => {
    let alive = true
    if (!token || !accountId) {
      setZones([])
      setZoneCount(null)
      setWorkerCount(null)
      setDnsCount(null)
      setR2Count(null)
      setTotalRequests(null)
      setPerZoneReq([])
      return
    }
    setStatsLoading(true)
    setStatsErr("")
    ;(async () => {
      try {
        const z = await listZones(token)
        if (!alive) return
        setZones(z)
        setZoneCount(z.length)
        const [workers, buckets] = await Promise.all([
          listWorkers(token, accountId).catch(() => [] as WorkerScript[]),
          listR2Buckets(token, accountId).catch(() => [] as R2Bucket[]),
        ])
        if (!alive) return
        setWorkerCount(workers.length)
        setR2Count(buckets.length)
        const perZone = await Promise.all(
          z.map(async (zone) => {
            const [recs, ana] = await Promise.all([
              listDnsRecords(token, zone.id).catch(() => [] as DnsRecord[]),
              zoneAnalytics24h(token, zone.id).catch(() => ({ total: 0, points: [] as any[] })),
            ])
            return { zone, dns: recs.length, requests: ana.total }
          })
        )
        if (!alive) return
        setDnsCount(perZone.reduce((s, p) => s + p.dns, 0))
        setTotalRequests(perZone.reduce((s, p) => s + p.requests, 0))
        setPerZoneReq(
          perZone
            .map((p) => ({ zone: p.zone, requests: p.requests }))
            .sort((a, b) => b.requests - a.requests)
        )
      } catch (e) {
        if (alive) setStatsErr(errText(e))
      } finally {
        if (alive) setStatsLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [token, accountId, statsKey])

  function push(line: string) {
    setDetectLines((prev) => [...prev, line])
  }

  async function saveToken() {
    const t = token.trim()
    if (!t) {
      await Dialog.alert({ title: "令牌为空", message: "请先输入 Cloudflare API Token。" })
      return
    }
    Keychain.set(TOKEN_KEY, t)
    setTokenSaved(true)
    await Dialog.alert({ title: "已保存", message: "令牌已存入本机钥匙串，下次打开自动填入。" })
  }

  function clearToken() {
    Keychain.remove(TOKEN_KEY)
    Keychain.remove(ACCOUNT_KEY)
    Keychain.remove(SUBDOMAIN_KEY)
    setToken("")
    setTokenSaved(false)
    setAccountId("")
    setAccountName("")
    setAccounts([])
    setSubdomain("")
    setDetectLines([])
  }

  async function runDetect() {
    const t = token.trim()
    if (!t) {
      await Dialog.alert({ title: "缺少令牌", message: "请先输入并保存 API Token。" })
      return
    }
    setDetecting(true)
    setDetectLines([])
    setAccounts([])
    try {
      const verify = await verifyToken(t)
      if (verify.active) {
        push("✅ Token 验证通过（active）")
      } else {
        push(`⚠️ Token 验证接口返回 ${verify.status}（${verify.message}），继续用账号接口判断`)
        push("提醒：个别作用域的令牌验证会 401，但账号接口能通就说明令牌是有效的。")
      }

      const list = await listAccounts(t)
      if (list.length === 0) {
        push("❌ 令牌下没有账号，请检查令牌权限。")
        return
      }
      setAccounts(list)
      const first = list[0]
      setAccountId(first.id)
      setAccountName(first.name ?? "")
      Keychain.set(ACCOUNT_KEY, first.id)
      push(`✅ 账号：${first.name ?? ""}（${first.id}）`)
      if (list.length > 1) {
        push(`ℹ️ 该令牌下有 ${list.length} 个账号，默认用第一个，点下面可以换`)
      }

      const sd = await getSubdomain(t, first.id)
      if (sd) {
        setSubdomain(sd)
        Keychain.set(SUBDOMAIN_KEY, sd)
        push(`✅ workers.dev 子域名：${sd}`)
      } else {
        push("⚠️ 查不到子域名，部署成功后仍可从返回里拿到地址")
      }
      push("—— 结论 ——")
      push("令牌有效，可以开始管理。下面点进各个页面就行。")
    } catch (e) {
      push(`❌ 检测出错：${errText(e)}`)
    } finally {
      setDetecting(false)
    }
  }

  function selectAccount(a: Account) {
    setAccountId(a.id)
    setAccountName(a.name ?? "")
    Keychain.set(ACCOUNT_KEY, a.id)
  }

  const ready = token.trim().length > 0 && accountId.length > 0
  const maxReq = perZoneReq.length > 0 ? perZoneReq[0].requests : 0

  return (
    <List navigationTitle="Orange Cloud">
      <Section>
        <Text font="largeTitle">
          {greeting()}
          {accountName ? `，${accountName}` : ""}
        </Text>
        <Text font="caption">{todayStr()}</Text>
        <Text font="caption">
          {ready
            ? `当前账号：${accountName || accountId}${subdomain ? ` · ${subdomain}.workers.dev` : ""}`
            : "先在下面保存令牌并点“开始检测”，拿到账号后指挥台和各页面才能用。"}
        </Text>
      </Section>

      {ready ? (
        <Section
          header={
            <Text>
              {statsLoading ? "概览加载中…" : statsErr ? `概览加载失败：${statsErr}` : "概览"}
            </Text>
          }
        >
          <Grid alignment="leading" horizontalSpacing={24} verticalSpacing={12}>
            <GridRow>
              <StatCell label="域名" value={zoneCount} />
              <StatCell label="Workers" value={workerCount} />
            </GridRow>
            <GridRow>
              <StatCell label="DNS 记录" value={dnsCount} />
              <StatCell label="R2 存储桶" value={r2Count} />
            </GridRow>
          </Grid>
          <Button title="刷新概览" action={() => setStatsKey((k) => k + 1)} />
        </Section>
      ) : null}

      {ready ? (
        <Section header={<Text>用量 · 最近 24 小时</Text>}>
          {totalRequests === null ? (
            <Text font="caption">加载中…</Text>
          ) : (
            <>
              <Text font="headline">共 {fmtNum(totalRequests)} 次请求</Text>
              <Text font="caption">横条是各域名请求数的对比（最长那条就是最多的）。没有圆环图：Scripting 画不了图，横条是代替它的。</Text>
              {maxReq > 0
                ? perZoneReq.slice(0, 5).map((p) => (
                    <VStack key={p.zone.id} alignment="leading">
                      <HStack>
                        <Text font="caption">{p.zone.name}</Text>
                        <Text font="caption">{fmtNum(p.requests)} 次</Text>
                      </HStack>
                      <ProgressView value={p.requests} total={maxReq} progressViewStyle="linear" />
                    </VStack>
                  ))
                : null}
            </>
          )}
        </Section>
      ) : null}

      {ready && zones.length > 0 ? (
        <Section header={<Text>{`域名（${zones.length} 个）`}</Text>}>
          {zones.map((z) => (
            <NavigationLink key={z.id} destination={<ZoneDetailView token={token} zone={z} />}>
              <HStack>
                <ZoneAvatar name={z.name} />
                <VStack alignment="leading">
                  <Text>{z.name}</Text>
                  <Text font="caption">
                    {z.status}
                    {z.planName ? ` · ${z.planName}` : ""}
                  </Text>
                </VStack>
              </HStack>
            </NavigationLink>
          ))}
        </Section>
      ) : null}

      <Section header={<Text>账号</Text>}>
        <SecureField
          title="API Token"
          value={token}
          onChanged={setToken}
          prompt="粘贴 Cloudflare API Token"
        />
        <HStack>
          <Button title="保存令牌" action={saveToken} />
          <Button title="清除令牌" action={clearToken} role="destructive" />
        </HStack>
        <Text font="caption">
          {tokenSaved ? "✅ 令牌已保存（下次自动填入，只存在本机钥匙串）" : "令牌只存在本机钥匙串，不会发给别人"}
        </Text>
        <Button title={detecting ? "检测中…" : "开始检测"} action={runDetect} />
        <Text font="caption">
          {accountName ? `当前账号：${accountName}` : "尚未检测到账号"}
        </Text>
        {accounts.length > 1 ? (
          <Text font="caption">切换账号（点一个）：</Text>
        ) : null}
        {accounts.map((a) => (
          <Button
            key={a.id}
            title={a.id === accountId ? `● ${a.name || a.id}` : a.name || a.id}
            action={() => selectAccount(a)}
          />
        ))}
        {detectLines.map((line, i) => (
          <Text key={i} font="caption">{line}</Text>
        ))}
      </Section>

      <Section header={<Text>说明</Text>}>
        <Text font="caption">这是 Orange Cloud 的 Scripting 版：不用侧载、不用 OAuth、不用搭回调服务器，令牌直接存在本机钥匙串里。</Text>
        <Text font="caption">不做的功能：实时日志流（Scripting 不支持 WebSocket）、WAF 规则编辑、新建存储桶 / 数据库、跑 SQL——这些去 Cloudflare 面板做。</Text>
        <Text font="caption">部署成功后，Worker 即使令牌过期也会继续运行。</Text>
      </Section>
    </List>
  )
}

function App() {
  const selection = useObservable<number>(0)
  const [token, setToken] = useState("")
  const [accountId, setAccountId] = useState("")
  const [accountName, setAccountName] = useState("")
  const [accounts, setAccounts] = useState<Account[]>([])
  const [subdomain, setSubdomain] = useState("")

  useEffect(() => {
    const savedToken = Keychain.get(TOKEN_KEY)
    if (savedToken) setToken(savedToken)
    const savedAccount = Keychain.get(ACCOUNT_KEY)
    if (savedAccount) setAccountId(savedAccount)
    const savedSubdomain = Keychain.get(SUBDOMAIN_KEY)
    if (savedSubdomain) setSubdomain(savedSubdomain)
  }, [])

  return (
    <TabView selection={selection}>
      <Tab title="首页" systemImage="house.fill" value={0}>
        <NavigationStack>
          <HomeView
            token={token}
            setToken={setToken}
            accountId={accountId}
            setAccountId={setAccountId}
            accountName={accountName}
            setAccountName={setAccountName}
            accounts={accounts}
            setAccounts={setAccounts}
            subdomain={subdomain}
            setSubdomain={setSubdomain}
          />
        </NavigationStack>
      </Tab>
      <Tab title="域名" systemImage="globe" value={1}>
        <NavigationStack>
          <ZoneListView token={token} />
        </NavigationStack>
      </Tab>
      <Tab title="Workers" systemImage="bolt.fill" value={2}>
        <NavigationStack>
          <WorkerListView token={token} accountId={accountId} subdomain={subdomain} />
        </NavigationStack>
      </Tab>
      <Tab title="存储" systemImage="externaldrive.fill" value={3}>
        <NavigationStack>
          <StorageView token={token} accountId={accountId} />
        </NavigationStack>
      </Tab>
      <Tab title="流量" systemImage="chart.bar.fill" value={4}>
        <NavigationStack>
          <AnalyticsView token={token} />
        </NavigationStack>
      </Tab>
    </TabView>
  )
}

async function run() {
  await Navigation.present({
    element: <App />,
    modalPresentationStyle: "pageSheet",
  })
  Script.exit()
}

run()
