import express from "express"
import { connect } from "framer-api"

const app = express()
app.use(express.json({ limit: "10mb" }))

// ==================== CORNERGROUP KONFİGÜRASYONU ====================
// ⚠️  BURAYA CORNERGROUP FRAMER PROJESİNİN URL'İNİ YAPIŞTIR
const PROJECT_URL = "https://framer.com/projects/CORNERGROUP_PROJECT_URL_BURAYA"

// ⚠️  CORNERGROUP İÇİN AYRI BİR FRAMER API KEY OLUŞTUR (Framer Settings → API)
const API_KEY = "fr_CORNERGROUP_API_KEY_BURAYA"

// Webhook güvenliği — n8n'de header olarak gönderilecek
const SECRET = "cornergroup2026"

// ⚠️  CMS oluşturduktan sonra `/inspect` çağırıp field ID'lerini buraya yaz
const FIELDS = {
  title:     "FILL_ME",
  shortText: "FILL_ME",
  date:      "FILL_ME",
  content:   "FILL_ME",
  featured:  "FILL_ME",
  image:     "FILL_ME",
}

// ==================== HELPERS ====================
function asString(v) {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (typeof v === "object") {
    if (typeof v.value === "string") return v.value
    if (typeof v.name === "string") return v.name
    return ""
  }
  return String(v)
}

// ==================== ERROR HANDLERS ====================
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ UNHANDLED REJECTION:", reason)
})
process.on("uncaughtException", (err) => {
  console.error("⚠️ UNCAUGHT EXCEPTION:", err.message, err.stack)
})

// ==================== ROUTES ====================
app.get("/", (req, res) => res.json({
  status: "ok",
  service: "cornergroup-framer-publish",
  endpoints: ["/inspect?secret=Y", "POST /sync-and-publish", "POST /publish-only"]
}))

// /inspect — Framer collection'ın field ID'lerini öğrenmek için
// Kullanım: GET /inspect?secret=cornergroup2026
app.get("/inspect", async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(401).json({ error: "Unauthorized" })

  let framer
  try {
    framer = await connect(PROJECT_URL, API_KEY)
    const collections = await framer.getCollections()
    const articles = collections.find(c => c.name === "Articles")
    if (!articles) {
      await framer.disconnect()
      return res.status(404).json({
        error: "Articles collection bulunamadı",
        availableCollections: collections.map(c => c.name)
      })
    }
    const fields = await articles.getFields()
    const items = await articles.getItems()
    await framer.disconnect()
    res.json({
      collectionId: articles.id,
      itemCount: items.length,
      fields: fields.map(f => ({ id: f.id, name: f.name, type: f.type })),
      sampleItem: items[0],
    })
  } catch (e) {
    try { if (framer) await framer.disconnect() } catch(_) {}
    res.status(500).json({ error: e.message })
  }
})

// /sync-and-publish — n8n'den gelen blog yazısını Framer CMS'e ekler + publish eder
app.post("/sync-and-publish", async (req, res) => {
  if (req.headers["x-secret"] !== SECRET) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  res.json({ success: true, message: "Cornergroup blog kuyruğa alındı" })

  ;(async () => {
    let framer
    try {
      const title      = asString(req.body.title)
      const slug       = asString(req.body.slug)
      const content    = asString(req.body.content)
      const dateRaw    = asString(req.body.date)
      const image_url  = asString(req.body.image_url)
      const short_text = asString(req.body.short_text)

      console.log("===== YENİ CORNERGROUP BLOG =====")
      console.log("Title:", title)
      console.log("Slug:", slug)

      if (!title || !slug || !content) throw new Error("Eksik alan: title/slug/content")

      console.log("→ Framer'a baglanılıyor...")
      framer = await connect(PROJECT_URL, API_KEY)
      console.log("✓ Baglandı")

      const collections = await framer.getCollections()
      const articles = collections.find(c => c.name === "Articles")
      if (!articles) throw new Error("Articles bulunamadı")

      const existingItems = await articles.getItems()
      if (existingItems.find(item => item.slug === slug)) {
        console.log("⚠ Aynı slug zaten var, atlanıyor")
        await framer.disconnect()
        return
      }

      let isoDate
      try { isoDate = new Date(dateRaw || Date.now()).toISOString() }
      catch { isoDate = new Date().toISOString() }

      const fieldData = {
        [FIELDS.title]:     { type: "string",        value: title },
        [FIELDS.shortText]: { type: "string",        value: short_text || title.substring(0, 150) },
        [FIELDS.date]:      { type: "date",          value: isoDate },
        [FIELDS.content]:   { type: "formattedText", value: content },
        [FIELDS.featured]:  { type: "boolean",       value: false },
      }

      if (image_url && image_url.startsWith("http")) {
        fieldData[FIELDS.image] = { type: "image", value: image_url }
      }

      console.log("→ addItems çağrılıyor...")
      await articles.addItems([{ slug, fieldData }])
      console.log("✓ Item eklendi")

      // Framer'ın internal state senkronizasyonu için 2sn bekle
      await new Promise(r => setTimeout(r, 2000))
      console.log("→ Publish başlıyor...")

      const result = await Promise.race([
        framer.publish(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Publish timeout 5dk")), 300000))
      ])
      console.log("✓ Publish OK, deployment id:", result.deployment.id)

      console.log("→ Deploy çağrılıyor...")
      await Promise.race([
        framer.deploy(result.deployment.id),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Deploy timeout 5dk")), 300000))
      ])
      console.log("✓ Deploy tamamlandı")

      await framer.disconnect()
      console.log("===== CORNERGROUP TAMAM =====")
    } catch (error) {
      console.error("===== CORNERGROUP HATA =====")
      console.error("Message:", error.message)
      console.error("Stack:", error.stack)
      try { if (framer) await framer.disconnect() } catch(e) {}
    }
  })()
})

// /publish-only — Manuel publish tetikleyici
app.post("/publish-only", async (req, res) => {
  if (req.headers["x-secret"] !== SECRET) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  res.json({ success: true, message: "Cornergroup publish başlatıldı" })

  ;(async () => {
    let framer
    try {
      console.log("===== CORNERGROUP MANUEL PUBLISH =====")
      framer = await connect(PROJECT_URL, API_KEY)

      const result = await Promise.race([
        framer.publish(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Publish timeout 5dk")), 300000))
      ])
      console.log("✓ Publish OK, deployment id:", result.deployment.id)

      await Promise.race([
        framer.deploy(result.deployment.id),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Deploy timeout 5dk")), 300000))
      ])
      console.log("✓ Deploy tamamlandı")

      await framer.disconnect()
      console.log("===== CORNERGROUP PUBLISH TAMAM =====")
    } catch (error) {
      console.error("===== CORNERGROUP PUBLISH HATASI =====")
      console.error("Message:", error.message)
      try { if (framer) await framer.disconnect() } catch(e) {}
    }
  })()
})

app.listen(process.env.PORT || 3000, () => {
  console.log("Cornergroup server çalışıyor: port", process.env.PORT || 3000)
})
