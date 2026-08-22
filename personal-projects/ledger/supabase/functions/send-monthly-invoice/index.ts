import { createClient } from 'npm:@supabase/supabase-js@2'
import { PDFDocument, PDFPage, StandardFonts, rgb, RGB } from 'npm:pdf-lib@1.17.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

interface InvoiceRequestBody {
  year: number
  month: number // 0-indexed, matches JS Date.getMonth()
}

interface InvoiceTransaction {
  amount: number
  type: 'income' | 'expense'
  transaction_date: string
  note: string | null
  category_id: string | null
  categories: { name: string; color: string } | null
}

interface InvoiceCategory {
  id: string
  name: string
  category_type: 'income' | 'expense'
  monthly_goal: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization' }, 401)
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    })

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user?.email) {
      return jsonResponse({ error: 'Not authenticated' }, 401)
    }

    const { year, month }: InvoiceRequestBody = await req.json()
    const monthStart = new Date(Date.UTC(year, month, 1))
    const monthEnd = new Date(Date.UTC(year, month + 1, 1))
    const monthStartStr = monthStart.toISOString().slice(0, 10)
    const monthEndStr = monthEnd.toISOString().slice(0, 10)

    const [txResult, catResult] = await Promise.all([
      supabase
        .from('transactions')
        .select('amount, type, transaction_date, note, category_id, categories(name, color)')
        .gte('transaction_date', monthStartStr)
        .lt('transaction_date', monthEndStr)
        .order('transaction_date', { ascending: true }),
      supabase.from('categories').select('id, name, category_type, monthly_goal')
    ])

    if (txResult.error) throw txResult.error
    if (catResult.error) throw catResult.error

    const monthLabel = monthStart.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    })

    const pdfBytes = await buildInvoicePdf({
      monthLabel,
      transactions: (txResult.data ?? []) as unknown as InvoiceTransaction[],
      categories: (catResult.data ?? []) as InvoiceCategory[]
    })

    await sendInvoiceEmail({ to: user.email, monthLabel, pdfBytes })

    return jsonResponse({ success: true })
  } catch (error) {
    console.error(error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  })
}

// ---------------------------------------------------------------------------
// PDF generation
// Visual language mirrors apps/desktop/src/renderer/src/assets/main.css
// (@theme tokens) and the Card / StatTile / CategoriesSection components —
// dark surface panels, the same accent/positive/negative palette, and the
// same "category type decides the color" rule used in the app (not
// goal-met/goal-missed, which is a separate signal shown via the progress bar).
// ---------------------------------------------------------------------------

const COLOR_BG = rgb(0.0431, 0.051, 0.0706)
const COLOR_SURFACE = rgb(0.0706, 0.0824, 0.1137)
const COLOR_SURFACE_RAISED = rgb(0.0941, 0.1098, 0.149)
const COLOR_BORDER = rgb(0.1373, 0.1569, 0.2196)
const COLOR_TEXT = rgb(0.9059, 0.9176, 0.949)
const COLOR_MUTED = rgb(0.5412, 0.5725, 0.651)
const COLOR_ACCENT = rgb(1.0, 0.6039, 0.2392)
const COLOR_POSITIVE = rgb(0.2039, 0.8275, 0.6)
const COLOR_NEGATIVE = rgb(0.9647, 0.3529, 0.3529)

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 56
const PANEL_PAD = 20
const ROW_HEIGHT = 18

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 3) + '...' : value
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '')
  return rgb(
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255
  )
}

async function buildInvoicePdf(input: {
  monthLabel: string
  transactions: InvoiceTransaction[]
  categories: InvoiceCategory[]
}): Promise<Uint8Array> {
  const { monthLabel, transactions, categories } = input

  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  let page: PDFPage
  let y = 0

  function fillBackground() {
    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: COLOR_BG })
  }

  function newPage() {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    fillBackground()
    y = PAGE_HEIGHT - MARGIN
  }

  newPage()

  function ensureSpace(height: number) {
    if (y - height < MARGIN) newPage()
  }

  function text(
    value: string,
    options: { size?: number; bold?: boolean; color?: RGB; x?: number } = {}
  ) {
    const { size = 10, bold = false, color = COLOR_TEXT, x = MARGIN } = options
    page.drawText(value, { x, y, size, font: bold ? fontBold : font, color })
  }

  function textWidth(value: string, { size = 10, bold = false }: { size?: number; bold?: boolean } = {}) {
    return (bold ? fontBold : font).widthOfTextAtSize(value, size)
  }

  function moveDown(amount: number) {
    y -= amount
  }

  function divider() {
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 1,
      color: COLOR_BORDER
    })
  }

  function drawPanelRect(topY: number, height: number) {
    page.drawRectangle({
      x: MARGIN - PANEL_PAD,
      y: topY - height,
      width: PAGE_WIDTH - (MARGIN - PANEL_PAD) * 2,
      height,
      color: COLOR_SURFACE,
      borderColor: COLOR_BORDER,
      borderWidth: 1
    })
  }

  // --------------------------------------------------------------------
  // Header
  // --------------------------------------------------------------------
  const wordmarkSize = 26
  const wordmarkWidth = textWidth('LEDGER', { size: wordmarkSize, bold: true })
  page.drawText('LEDGER', { x: MARGIN, y, size: wordmarkSize, font: fontBold, color: COLOR_TEXT })
  page.drawText('.', { x: MARGIN + wordmarkWidth, y, size: wordmarkSize, font: fontBold, color: COLOR_ACCENT })
  moveDown(34)
  text(`Monthly Report — ${monthLabel}`, { size: 15, bold: true })
  moveDown(18)
  const generatedLabel = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
  text(`Generated ${generatedLabel}`, { size: 9, color: COLOR_MUTED })
  moveDown(34)

  // --------------------------------------------------------------------
  // Aggregate totals
  // --------------------------------------------------------------------
  let income = 0
  let expenses = 0
  const byCategory = new Map<string, number>()

  for (const t of transactions) {
    if (t.type === 'income') income += t.amount
    else expenses += t.amount
    if (t.category_id) {
      byCategory.set(t.category_id, (byCategory.get(t.category_id) ?? 0) + t.amount)
    }
  }
  income = round2(income)
  expenses = round2(expenses)
  const balance = round2(income - expenses)

  // --------------------------------------------------------------------
  // Summary panel
  // --------------------------------------------------------------------
  const SUMMARY_PANEL_HEIGHT = 108
  ensureSpace(SUMMARY_PANEL_HEIGHT + PANEL_PAD * 2 + 24)
  const summaryPanelTop = y
  drawPanelRect(summaryPanelTop, SUMMARY_PANEL_HEIGHT)
  moveDown(PANEL_PAD + 6)
  text('Summary', { size: 13, bold: true })
  moveDown(28)
  const colWidth = (PAGE_WIDTH - MARGIN * 2) / 3
  text('INCOME', { size: 8, color: COLOR_MUTED, x: MARGIN })
  text('EXPENSES', { size: 8, color: COLOR_MUTED, x: MARGIN + colWidth })
  text('BALANCE', { size: 8, color: COLOR_MUTED, x: MARGIN + colWidth * 2 })
  moveDown(22)
  text(formatCurrency(income), { size: 20, bold: true, x: MARGIN })
  text(formatCurrency(expenses), { size: 20, bold: true, x: MARGIN + colWidth })
  text(formatCurrency(balance), {
    size: 20,
    bold: true,
    x: MARGIN + colWidth * 2,
    color: balance >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE
  })
  y = summaryPanelTop - SUMMARY_PANEL_HEIGHT - PANEL_PAD
  moveDown(36)

  // --------------------------------------------------------------------
  // Category goal progress panel
  // --------------------------------------------------------------------
  const incomeCategories = categories.filter((c) => c.category_type === 'income')
  const expenseCategories = categories.filter((c) => c.category_type === 'expense')

  // Per category row: moveDown(12) between name and bar, then moveDown(ROW_HEIGHT)
  // after the bar = 12 + ROW_HEIGHT per row. Per group: moveDown(20) after the
  // label, plus moveDown(4) trailing gap after the last row = 24 + count * (12 + ROW_HEIGHT).
  function groupHeight(group: InvoiceCategory[]): number {
    return group.length === 0 ? 0 : 24 + group.length * (12 + ROW_HEIGHT)
  }

  const CATEGORY_PANEL_TOP_PAD = PANEL_PAD + 6 + 28 // matches moveDown(PANEL_PAD+6) then moveDown(28) below
  const CATEGORY_PANEL_BOTTOM_PAD = 16
  const categoryContentHeight =
    incomeCategories.length === 0 && expenseCategories.length === 0
      ? 20
      : groupHeight(incomeCategories) + groupHeight(expenseCategories)
  const CATEGORY_PANEL_HEIGHT = CATEGORY_PANEL_TOP_PAD + categoryContentHeight + CATEGORY_PANEL_BOTTOM_PAD

  ensureSpace(CATEGORY_PANEL_HEIGHT + PANEL_PAD * 2 + 24)
  const categoryPanelTop = y
  drawPanelRect(categoryPanelTop, CATEGORY_PANEL_HEIGHT)
  moveDown(PANEL_PAD + 6)
  text('Category Goal Progress', { size: 13, bold: true })
  moveDown(28)

  function drawCategoryGroup(label: string, group: InvoiceCategory[], type: 'income' | 'expense') {
    if (group.length === 0) return
    text(label, { size: 9, bold: true, color: COLOR_MUTED })
    moveDown(20)
    // Color reflects category TYPE (income vs expense), same rule as
    // CategoriesSection.tsx — not goal-met status, which the bar carries.
    const toneColor = type === 'income' ? COLOR_POSITIVE : COLOR_NEGATIVE
    for (const category of group) {
      const actual = round2(byCategory.get(category.id) ?? 0)
      const goal = category.monthly_goal
      const fillPct = goal > 0 ? Math.min(actual / goal, 1) : 0

      text(truncate(category.name, 28), { size: 10, x: MARGIN })
      const amountLabel = `${formatCurrency(actual)}  of  ${formatCurrency(goal)} goal`
      const amountWidth = textWidth(amountLabel, { size: 10 })
      text(amountLabel, { size: 10, x: PAGE_WIDTH - MARGIN - amountWidth, color: toneColor })
      moveDown(12)

      const barWidth = PAGE_WIDTH - MARGIN * 2
      page.drawRectangle({ x: MARGIN, y, width: barWidth, height: 3, color: COLOR_SURFACE_RAISED })
      if (fillPct > 0) {
        page.drawRectangle({ x: MARGIN, y, width: barWidth * fillPct, height: 3, color: toneColor })
      }
      moveDown(ROW_HEIGHT)
    }
    moveDown(4)
  }

  if (incomeCategories.length === 0 && expenseCategories.length === 0) {
    text('No categories set up yet.', { size: 10, color: COLOR_MUTED })
  } else {
    drawCategoryGroup('INCOME', incomeCategories, 'income')
    drawCategoryGroup('EXPENSES', expenseCategories, 'expense')
  }

  y = categoryPanelTop - CATEGORY_PANEL_HEIGHT - PANEL_PAD
  moveDown(36)

  // --------------------------------------------------------------------
  // Transactions (unboxed ledger, bank-statement style)
  // --------------------------------------------------------------------
  ensureSpace(60)
  text('Transactions', { size: 13, bold: true })
  moveDown(24)

  if (transactions.length === 0) {
    text('No transactions recorded this month.', { size: 10, color: COLOR_MUTED })
  } else {
    const dateX = MARGIN
    const categoryX = MARGIN + 74
    const noteX = MARGIN + 230
    const amountX = PAGE_WIDTH - MARGIN - 80

    function drawTableHeader() {
      text('DATE', { size: 8, bold: true, color: COLOR_MUTED, x: dateX })
      text('CATEGORY', { size: 8, bold: true, color: COLOR_MUTED, x: categoryX })
      text('NOTE', { size: 8, bold: true, color: COLOR_MUTED, x: noteX })
      text('AMOUNT', { size: 8, bold: true, color: COLOR_MUTED, x: amountX })
      moveDown(12)
      divider()
      moveDown(14)
    }

    drawTableHeader()

    for (const t of transactions) {
      if (y - ROW_HEIGHT < MARGIN) {
        newPage()
        drawTableHeader()
      }
      if (t.categories?.color) {
        page.drawCircle({ x: dateX + 60, y: y + 3, size: 2.5, color: hexToRgb(t.categories.color) })
      }
      text(t.transaction_date, { size: 9, x: dateX })
      text(truncate(t.categories?.name ?? 'Uncategorized', 22), { size: 9, x: categoryX })
      text(truncate(t.note ?? '', 24), { size: 9, x: noteX, color: COLOR_MUTED })
      const amountLabel = `${t.type === 'income' ? '+' : '-'}${formatCurrency(t.amount)}`
      text(amountLabel, {
        size: 9,
        bold: true,
        x: amountX,
        color: t.type === 'income' ? COLOR_POSITIVE : COLOR_NEGATIVE
      })
      moveDown(ROW_HEIGHT)
    }
  }

  return pdfDoc.save()
}

// ---------------------------------------------------------------------------
// Email delivery
// ---------------------------------------------------------------------------

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function sendInvoiceEmail(input: { to: string; monthLabel: string; pdfBytes: Uint8Array }): Promise<void> {
  const { to, monthLabel, pdfBytes } = input
  const base64Pdf = encodeBase64(pdfBytes)
  const fileSlug = monthLabel.replace(/\s+/g, '-').toLowerCase()

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Ledger <onboarding@resend.dev>',
      to: [to],
      subject: `Your Ledger report for ${monthLabel}`,
      html: `<p>Your Ledger monthly report for <strong>${monthLabel}</strong> is attached.</p>`,
      attachments: [
        {
          filename: `ledger-${fileSlug}.pdf`,
          content: base64Pdf
        }
      ]
    })
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Resend API error (${response.status}): ${errorBody}`)
  }
}
