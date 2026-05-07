# SHOPIFY_SETUP.md — Store Configuration Checklist
> Step-by-step checklist for launching The Blackout Drive on Shopify.

---

## 1. Account & Plan

- [ ] **Create Shopify account** at shopify.com (use Hutton Technologies business email)
- [ ] **Select plan:** Basic Shopify ($39/month) — sufficient for launch volume
- [ ] **Connect domain:** theblackoutdrive.com (point DNS in Cloudflare to Shopify's nameservers OR use Cloudflare CNAME flattening)
- [ ] **Enable custom domain SSL** (automatic with Shopify)

---

## 2. Theme & Design

### Theme Selection
- [ ] **Recommended theme:** Dawn (free) or Sense (free) — both support dark color schemes
- [ ] **Alternative paid theme:** Impulse by Archetype ($380) — built for single-product stores with strong visual storytelling
- [ ] If using Dawn: switch to **dark mode** in theme settings

### Design System (Dark/Tactical Aesthetic)
Apply these settings in Theme Editor → Settings:

| Setting | Value |
|---------|-------|
| **Background** | `#0a0c08` (near-black with slight green tint) |
| **Text** | `#e8e0d0` (warm off-white) |
| **Accent / Buttons** | `#c8a04a` (amber gold — matches BEACON UI) |
| **Secondary accent** | `#7ab88a` (muted forest green) |
| **Error / Alert** | `#e07777` (soft red) |
| **Heading font** | Inter (Google Fonts — clean, modern, tactical) |
| **Body font** | Inter or System default |
| **Button style** | Squared corners, uppercase text, letter-spacing: 2px |
| **Logo** | Text-only wordmark: "THE BLACKOUT DRIVE" in Inter Bold, amber gold |

### Key Pages to Customize
- [ ] **Homepage:** Hero image (drive on dark surface) + headline + single CTA button
- [ ] **Product page:** Use the copy from `marketing/copy/shopify_product_page.md`
- [ ] **Remove:** Blog section, "Collections" page, and any default placeholder content

### Imagery Guidelines
- Product photos should be **dark and moody** — matte black surfaces, warm side lighting
- Show the drive next to context items: flashlight, map, water bottle, go-bag
- **Never show the drive next to a phone or modern tech setup** — this is survival, not consumer electronics
- At minimum, you need:
  - [ ] 1× Hero shot (drive + sleeve, dark background)
  - [ ] 1× In-use shot (drive plugged into a laptop, BEACON screen visible)
  - [ ] 1× Contents shot (drive + card insert + Mylar sleeve laid out)
  - [ ] 1× Screen capture of the BEACON chat interface
  - [ ] 1× Screen capture of the Library browser

---

## 3. Product Listing

- [ ] **Product title:** The Blackout Drive — Basecamp Edition
- [ ] **Product type:** Electronics / USB Drive
- [ ] **Vendor:** Hutton Technologies
- [ ] **Price:** $79.00
- [ ] **Compare-at price:** Leave blank (no fake markdowns — trust is the brand)
- [ ] **SKU:** DD-01
- [ ] **Barcode:** Leave blank (not needed for DTC Shopify)
- [ ] **Inventory tracking:** ON — track quantity manually
- [ ] **Initial quantity:** Set to actual stock on hand
- [ ] **Weight:** 0.2 lb (drive + packaging, for shipping calculation)
- [ ] **Product description:** Paste full content from `marketing/copy/shopify_product_page.md`
- [ ] **SEO title:** The Blackout Drive — Offline AI on a USB Drive | No Internet Required
- [ ] **SEO description:** Plug-and-play USB drive with a fully offline AI and survival library. No internet, no cloud, no subscription. Runs on any Mac or Windows laptop. $79.

### Tags
```
offline AI, survival USB, prepper tech, emergency preparedness, portable AI,
grid down, EMP prep, off-grid AI, survival library, offline Bible, privacy AI,
blackout drive, USB AI, no internet AI, SHTF, bug out bag
```

---

## 4. Shipping Configuration

### Shipping Profile
- [ ] **Create shipping zone:** United States (domestic only at launch)
- [ ] **Shipping rate name:** USPS Ground Advantage
- [ ] **Rate:** $5.99 flat rate (absorb the ~$1.99 difference from actual ~$4.00 COGS as margin buffer) OR use calculated rates
- [ ] **Processing time:** 1-3 business days
- [ ] **Free shipping threshold:** Consider $0 (single-product store — bake shipping into the price psychologically at $79)

### Pirateship Integration (Recommended)
- [ ] **Create Pirateship account** at pirateship.com (free)
- [ ] **Connect to Shopify** via Pirateship app (auto-imports orders)
- [ ] **Default service:** USPS Ground Advantage (cheapest for <4oz packages)
- [ ] **Package preset:** Create a preset: "Blackout Drive" — 4oz, 6"×4"×1" padded mailer
- [ ] **Enable Commercial Base pricing** (automatic with Pirateship — saves ~15% on postage)

### Packaging Supplies
- [ ] Source: Matte black Mylar anti-static bags (USB size, ~$0.50/unit, Amazon or Uline)
- [ ] Source: Kraft card inserts — print quick-start guide (Canva → local print shop, ~$0.25/unit)
- [ ] Source: Small zip-seal poly mailer for outer shipping (4"×8" padded, ~$0.30/unit)

---

## 5. Payment Processing

- [ ] **Shopify Payments:** Enable (2.9% + $0.30 per transaction on Basic plan)
- [ ] **PayPal:** Enable as secondary payment method
- [ ] **Shop Pay:** Enable (increases conversion ~10% per Shopify data)
- [ ] **Apple Pay / Google Pay:** Enable via Shopify Payments (automatic)
- [ ] **Business bank account:** Connect Hutton Technologies business checking for payouts

---

## 6. Required Legal Pages

Shopify requires these for payment processing and trust. Create under Online Store → Pages:

### Refund Policy
- [ ] **Create page:** "Refund & Return Policy"
- [ ] **Content:**
  - 30-day satisfaction guarantee
  - If the product doesn't work on your hardware (meets minimum requirements), we'll troubleshoot or refund
  - Returns accepted for defective drives — contact support@theblackoutdrive.com
  - Refund processed within 5-7 business days to original payment method
  - Customer responsible for return shipping on non-defective returns

### Privacy Policy
- [ ] **Create page:** "Privacy Policy"
- [ ] **Content:**
  - We collect: name, email, shipping address, payment info (processed by Shopify Payments — we never see full card numbers)
  - We use this data ONLY to fulfill your order and send shipping notifications
  - We do NOT sell or share your data with third parties
  - The Blackout Drive itself collects ZERO data — everything runs locally on your machine
  - Email marketing: opt-in only (if you add email capture later)
  - Contact: privacy@theblackoutdrive.com

### Terms of Service
- [ ] **Create page:** "Terms of Service"
- [ ] **Content:**
  - Products sold by Hutton Technologies
  - The Blackout Drive is provided as-is — AI responses are for educational/informational purposes only
  - Not a substitute for professional medical, legal, or emergency advice
  - Minimum hardware requirements must be met (Windows 10+, macOS 11+, 8GB RAM, USB 3.0)
  - Chromebooks and tablets are not supported
  - We reserve the right to refuse service or cancel orders at our discretion

### Shipping Policy
- [ ] **Create page:** "Shipping Policy"
- [ ] **Content:**
  - Ships within 1-3 business days from the USA
  - USPS Ground Advantage (2-5 business day delivery)
  - Tracking number provided via email
  - US domestic shipping only at launch (international TBD)
  - PO Boxes accepted

### Medical Disclaimer
- [ ] **Create page:** "Medical Disclaimer" (or add to Terms of Service)
- [ ] **Content:**
  - AI-generated responses are for educational and informational purposes ONLY
  - Not a substitute for professional medical advice, diagnosis, or treatment
  - In a medical emergency, call 911 or your local emergency services
  - Medical content in the library (Where There Is No Doctor, etc.) is reference material — always seek qualified medical help when available

### Contact Page
- [ ] **Create page:** "Contact Us"
- [ ] **Content:**
  - Support email: support@theblackoutdrive.com
  - Response time: within 24-48 hours
  - For hardware issues, include: your operating system, RAM amount, and a description of the problem
  - Link to GitHub Issues for technical users

---

## 7. Analytics & Tracking

- [ ] **Google Analytics 4:** Create property, add Measurement ID to Shopify → Online Store → Preferences
- [ ] **Meta Pixel:** Install Facebook/Instagram pixel for retargeting (even if not running ads yet — collect data)
- [ ] **TikTok Pixel:** Install for TikTok Shop integration (Month 2)
- [ ] **Shopify native analytics:** Review daily — focus on conversion rate and traffic sources

---

## 8. Email Capture (Optional — Month 2)

- [ ] **App:** Klaviyo (free up to 250 contacts) or Shopify Email
- [ ] **Popup:** "Get 10% off your Blackout Drive" — collect email for abandoned cart recovery
- [ ] **Post-purchase email sequence:**
  1. Order confirmation (automatic via Shopify)
  2. Shipping notification (automatic via Pirateship)
  3. Day 3: "Getting started with your Blackout Drive" — link to setup video
  4. Day 14: "How are you liking BEACON?" — request a review
  5. Day 30: "Share The Blackout Drive" — referral/affiliate invite

---

## 9. Pre-Launch Checklist

Before going live:

- [ ] Place a test order (use Shopify Bogus Gateway for free test transactions)
- [ ] Verify shipping rate calculates correctly
- [ ] Verify order confirmation email sends and looks professional
- [ ] Test on mobile (80%+ of TikTok-driven traffic is mobile)
- [ ] Proofread every page — product description, FAQ, legal pages
- [ ] Verify all images load and are high quality (no blurry/pixelated photos)
- [ ] Remove Shopify branding from footer (powered-by badge) — set custom footer
- [ ] Set store password to OFF (Online Store → Preferences → remove password)
- [ ] Announce on social: "The Blackout Drive is live. Link in bio."

---

## 10. Post-Launch Priorities (Week 1)

- [ ] Pin the "What's Actually On This Drive" TikTok (transparency video)
- [ ] Post the "Internet Outage Demo" TikTok within 24 hours of store launch
- [ ] Cross-post all videos to Instagram Reels and YouTube Shorts
- [ ] List on **Etsy** (within Week 2 — secondary channel)
- [ ] Monitor Shopify analytics daily for conversion rate (target: 2-4%)
- [ ] Respond to ALL TikTok comments (algorithm rewards engagement)
- [ ] Ship first orders within 24 hours of purchase (fast shipping = good reviews)
