import express from "express"
import { connect } from "framer-api"

const app = express()
app.use(express.json({ limit: "10mb" }))

// ==================== CORNERGROUP KONFİGÜRASYONU ====================
const PROJECT_URL = "https://framer.com/projects/Corner-group--7qESOYgYF03Hz62fGaB9-78YRk"
const API_KEY = "fr_5qm5mhq9fd9wxb4d48jj780vtd"
const SECRET = "cornergroup2026"
const COLLECTION_NAME = "Articles"

// Cornergroup CMS field ID'leri (/inspect çıktısından alındı, hepsi gerçek)
const FIELDS = {
  title:       "mxtaaMQPw",  // Title (string)
  excerpt:     "XyBL7dh8D",  // Excerpt (formattedText)
  category:    "BryvG7EN5",  // Category (formattedText)
  publishedAt: "CvBbKbjn1",  // PublishedAt (date)
  author:      "dDa7nZcFD",  // Author (formattedText)
  coverImage:  "lHEfEQLTF",  // CoverImage (image)
  readingTime: "AM0ywAZ0Q",  // ReadingTime (number)
  content:     "Zf6oompEb",  // Content (formattedText)
  featured:    "eYXOke2TY",  // Featured (formattedText - "true"/"false" string olarak yazılıyor)
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

function toFormattedText(text) {
  if (!text) return ""
  if (text.includes("<p") || text.includes("<h") || text.includes("<div")) return text
  return text
    .split(/\n\n+/)
    .map(p => `<p dir="auto">${p.trim().replace(/\n/g, "<br/>")}</p>`)
    .join("")
}

function estimateReadingTime(content) {
  const text = (content || "").replace(/<[^>]+>/g, "")
  const words = text.trim().split(/\s+/).length
  return Math.max(1, Math.ceil(words / 200))
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
  collection: COLLECTION_NAME,
  endpoints: ["/inspect?secret=Y", "POST /sync-and-publish", "POST /publish-only"]
}))

app.get("/inspect", async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(401).json({ error: "Unauthorized" })

  let framer
  try {
    framer = await connect(PROJECT_URL, API_KEY)
    const collections = await framer.getCollections()
    const articles = collections.find(c => c.name === COLLECTION_NAME)
    if (!articles) {
      await framer.disconnect()
      return res.status(404).json({
        error: `"${COLLECTION_NAME}" collection bulunamadı`,
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

app.post("/sync-and-publish", async (req, res) => {
  if (req.headers["x-secret"] !== SECRET) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  res.json({ success: true, message: "Cornergroup blog kuyruğa alındı" })

  ;(async () => {
    let framer
    try {
      const title       = asString(req.body.title)
      const slug        = asString(req.body.slug)
      const content     = asString(req.body.content)
      const dateRaw     = asString(req.body.date)
      const image_url   = asString(req.body.image_url)
      const short_text  = asString(req.body.short_text)
      const category    = asString(req.body.category) || "Genel"
      const author      = asString(req.body.author) || "Corner Group"
      const featured    = req.body.featured === true || req.body.featured === "true"

      console.log("===== YENİ CORNERGROUP BLOG =====")
      console.log("Title:", title)
      console.log("Slug:", slug)

      if (!title || !slug || !content) throw new Error("Eksik alan: title/slug/content")

      console.log("→ Framer'a baglanılıyor...")
      framer = await connect(PROJECT_URL, API_KEY)
      console.log("✓ Baglandı")

      const collections = await framer.getCollections()
      const articles = collections.find(c => c.name === COLLECTION_NAME)
      if (!articles) throw new Error(`${COLLECTION_NAME} bulunamadı`)

      const existingItems = await articles.getItems()
      if (existingItems.find(item => item.slug === slug)) {
        console.log("⚠ Aynı slug zaten var, atlanıyor")
        await framer.disconnect()
        return
      }

      let isoDate
      try { isoDate = new Date(dateRaw || Date.now()).toISOString() }
      catch { isoDate = new Date().toISOString() }

      const formattedContent = toFormattedText(content)
      const excerptText = short_text || title.substring(0, 150)
      const readTime = estimateReadingTime(content)

      // Featured formattedText olduğu için string olarak yazıyoruz ("true"/"false")
      // Blog component'i bunu okurken includes("true") ile kontrol edebilir
      const featuredHtml = featured ? `<p dir="auto">true</p>` : `<p dir="auto">false</p>`

      const fieldData = {
        [FIELDS.title]:       { type: "string",        value: title },
        [FIELDS.excerpt]:     { type: "formattedText", value: toFormattedText(excerptText) },
        [FIELDS.category]:    { type: "formattedText", value: toFormattedText(category) },
        [FIELDS.publishedAt]: { type: "date",          value: isoDate },
        [FIELDS.author]:      { type: "formattedText", value: toFormattedText(author) },
        [FIELDS.readingTime]: { type: "number",        value: readTime },
        [FIELDS.content]:     { type: "formattedText", value: formattedContent },
        [FIELDS.featured]:    { type: "formattedText", value: featuredHtml },
      }

      if (image_url && image_url.startsWith("http")) {
        fieldData[FIELDS.coverImage] = { type: "image", value: image_url }
      }

      console.log("→ addItems çağrılıyor...")
      await articles.addItems([{ slug, fieldData }])
      console.log("✓ Item eklendi")

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
  console.log("Collection:", COLLECTION_NAME)
})
