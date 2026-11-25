#!/usr/bin/env node
// Fill in a Safari app's App Store Connect listing from store/<app>/app-store.md
// and its screenshots. It doesn't submit. Adapted from ice-queue's script of the
// same name.
//
//   scripts/app-store-listing.mjs fetch|dd             apply everything
//   scripts/app-store-listing.mjs fetch|dd --dry-run   show what would change
//   scripts/app-store-listing.mjs fetch|dd --only text,review,build,shots,pricing
//                                                      (also: info, age, rights)
//
// A screenshot folder that does not exist yet (Fetch's iPad set, until it is
// captured) is skipped with a note rather than failing the run.
//
// Safe to run again: text is only sent when it differs, and a screenshot set is
// only replaced when its files changed.
//
// Credentials: login Keychain items env/personal/ASC_KEY_ID, ASC_ISSUER_ID and
// ASC_KEY_BASE64 (synced from 1Password by secrets-sync), as for upload-apple.sh;
// ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH in the environment override them. Review contact: login Keychain items
// env/personal/APP_REVIEW_{FIRST_NAME,LAST_NAME,PHONE,EMAIL}, synced from
// 1Password by secrets-sync.
//
// Left for the website: the App Privacy answers ("Data Not Collected") and
// pressing Submit for Review.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPS = {
  fetch: {
    bundleId: "org.bridge-classroom.bridge-classroom-fetch",
    platforms: { MAC_OS: ["mac"], IOS: ["iphone", "ipad"] },
    shots: { mac: "store/fetch/screenshots/listing", iphone: "store/fetch/screenshots/ios/iphone", ipad: "store/fetch/screenshots/ios/ipad" },
  },
  dd: {
    bundleId: "org.bridge-classroom.bridge-craftwork-dd",
    platforms: { MAC_OS: ["mac"] },
    shots: { mac: "store/dd/screenshots" },
  },
};
const APP_KEY = process.argv[2];
const APP = APPS[APP_KEY];
if (!APP) { console.error("usage: scripts/app-store-listing.mjs fetch|dd [--dry-run] [--only steps]"); process.exit(2); }
const BUNDLE_ID = APP.bundleId;
const LOCALE = "en-US";
const PLATFORMS = APP.platforms;
const SHOT_TYPES = { iphone: "APP_IPHONE_67", ipad: "APP_IPAD_PRO_3GEN_129", mac: "APP_DESKTOP" };
// Utilities first, as both listings elsewhere; Productivity second.
const CATEGORIES = ["UTILITIES", "PRODUCTIVITY"];

const args = process.argv.slice(3);
const DRY = args.includes("--dry-run");
const onlyArg = args[args.indexOf("--only") + 1];
const ONLY = args.includes("--only") ? new Set(onlyArg.split(",")) : null;
const step = (name) => !ONLY || ONLY.has(name);

// ---------- store/<app>/app-store.md ----------

function readListing() {
  const md = fs.readFileSync(path.join(ROOT, "store", APP_KEY, "app-store.md"), "utf8");
  const sections = {};
  let current = null;
  for (const line of md.split("\n")) {
    const h = line.match(/^## (.+?)(?:\s*\[\d+\])?\s*$/);
    if (h) { current = h[1].trim(); sections[current] = []; continue; }
    if (current) sections[current].push(line);
  }
  const raw = (name) => {
    if (!sections[name]) throw new Error(`store/${APP_KEY}/app-store.md has no "## ${name}" section`);
    return sections[name].join("\n").trim();
  };
  // Join wrapped lines. A blank line ends a paragraph; a "• " or "1. " line, or
  // a line in capitals (a section heading), stands on its own line.
  const unwrap = (text) => {
    const out = [];
    const isHeading = (l) => /^[A-Z0-9 ,'&-]+$/.test(l) && /[A-Z]{3}/.test(l);
    let prevHeading = false;
    for (const line of text.split("\n")) {
      const l = line.trim();
      if (!l) { out.push(""); prevHeading = false; continue; }
      const last = out.length - 1;
      if (last < 0 || out[last] === "" || l.startsWith("• ") || /^\d+\. /.test(l) || isHeading(l) || prevHeading) out.push(l);
      else out[last] += " " + l;
      prevHeading = isHeading(l);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  };
  const url = (label) => raw("URLs").match(new RegExp(`${label}[^:]*:\\s*(https://\\S+)`))?.[1];
  const listing = {
    name: raw("Name"),
    subtitle: raw("Subtitle"),
    promotionalText: unwrap(raw("Promotional text")),
    description: unwrap(raw("Description")),
    keywords: raw("Keywords"),
    supportUrl: url("Support URL"),
    privacyPolicyUrl: url("Privacy policy URL"),
    copyright: raw("Copyright"),
    // One set of notes per platform: Safari's permission steps differ.
    reviewNotes: Object.fromEntries(Object.keys(PLATFORMS).map((p) =>
      [p, unwrap(raw(`App Review notes (${p === "IOS" ? "iOS" : "macOS"})`))])),
  };
  const limits = { name: 30, subtitle: 30, promotionalText: 170, description: 4000, keywords: 100 };
  for (const [k, max] of Object.entries(limits))
    if (listing[k].length > max) throw new Error(`${k} is ${listing[k].length} characters (limit ${max})`);
  for (const [p, notes] of Object.entries(listing.reviewNotes))
    if (notes.length > 4000) throw new Error(`${p} review notes are ${notes.length} characters (limit 4000)`);
  if (!listing.supportUrl || !listing.privacyPolicyUrl) throw new Error(`store/${APP_KEY}/app-store.md is missing a URL`);
  return listing;
}

// ---------- credentials ----------

function credentials() {
  const env = process.env;
  return {
    ASC_KEY_ID: env.ASC_KEY_ID || keychain("ASC_KEY_ID"),
    ASC_ISSUER_ID: env.ASC_ISSUER_ID || keychain("ASC_ISSUER_ID"),
    key: env.ASC_KEY_PATH ? fs.readFileSync(env.ASC_KEY_PATH) : Buffer.from(keychain("ASC_KEY_BASE64"), "base64"),
  };
}

function keychain(name) {
  try {
    return execFileSync("security", ["find-generic-password", "-a", os.userInfo().username, "-s", `env/personal/${name}`, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error(`Keychain item env/personal/${name} is missing; run secrets-sync`);
  }
}

// ---------- API ----------

const creds = credentials();
let token, tokenExpires = 0;
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  if (now < tokenExpires - 60) return token;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid: creds.ASC_KEY_ID, typ: "JWT" });
  const body = b64({ iss: creds.ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: "appstoreconnect-v1" });
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`),
    { key: creds.key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  tokenExpires = now + 1100;
  return (token = `${head}.${body}.${sig}`);
}

async function api(method, p, body) {
  const writes = method !== "GET";
  if (writes && DRY) { console.log(`    (dry run) ${method} ${p}`); return { data: body?.data ? { id: "dry-run", ...body.data } : null }; }
  const r = await fetch("https://api.appstoreconnect.apple.com" + p, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return {};
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = (json.errors || []).map((e) => `${e.title}: ${e.detail}${e.source?.pointer ? ` (${e.source.pointer})` : ""}`).join("; ");
    throw new Error(`${method} ${p} → ${r.status} ${detail}`);
  }
  return json;
}
const get = (p) => api("GET", p);

async function getAll(p) {
  let out = [], next = p;
  while (next) {
    const page = await get(next);
    out = out.concat(page.data || []);
    next = page.links?.next ? page.links.next.replace("https://api.appstoreconnect.apple.com", "") : null;
  }
  return out;
}

// Send only the attributes that differ.
async function patch(type, id, current, wanted, label) {
  const changed = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => current?.[k] !== v));
  if (!Object.keys(changed).length) { console.log(`  ${label}: up to date`); return; }
  console.log(`  ${label}: ${Object.keys(changed).join(", ")}`);
  await api("PATCH", `/v1/${type}/${id}`, { data: { type, id, attributes: changed } });
}

// ---------- steps ----------

async function appInfoStep(app, listing) {
  const infos = await get(`/v1/apps/${app.id}/appInfos`);
  // The editable one is the appInfo that isn't live yet.
  const info = infos.data.find((i) => i.attributes.state !== "READY_FOR_DISTRIBUTION") || infos.data[0];
  if (step("info")) {
    const locs = await get(`/v1/appInfos/${info.id}/appInfoLocalizations`);
    const loc = locs.data.find((l) => l.attributes.locale === LOCALE);
    await patch("appInfoLocalizations", loc.id, loc.attributes,
      { name: listing.name, subtitle: listing.subtitle, privacyPolicyUrl: listing.privacyPolicyUrl }, "name, subtitle, privacy URL");

    const cat = await get(`/v1/appInfos/${info.id}?include=primaryCategory,secondaryCategory`);
    const rel = cat.data.relationships;
    if (rel.primaryCategory?.data?.id === CATEGORIES[0] && rel.secondaryCategory?.data?.id === CATEGORIES[1]) console.log("  categories: up to date");
    else {
      console.log(`  categories: ${CATEGORIES.join(", ")}`);
      await api("PATCH", `/v1/appInfos/${info.id}`, { data: { type: "appInfos", id: info.id, relationships: {
        primaryCategory: { data: { type: "appCategories", id: CATEGORIES[0] } },
        secondaryCategory: { data: { type: "appCategories", id: CATEGORIES[1] } } } } });
    }
  }
  if (step("age")) {
    const decl = await get(`/v1/appInfos/${info.id}/ageRatingDeclaration`);
    const none = ["alcoholTobaccoOrDrugUseOrReferences", "contests", "gamblingSimulated", "gunsOrOtherWeapons",
      "horrorOrFearThemes", "matureOrSuggestiveThemes", "medicalOrTreatmentInformation", "profanityOrCrudeHumor",
      "sexualContentGraphicAndNudity", "sexualContentOrNudity", "violenceCartoonOrFantasy", "violenceRealistic",
      "violenceRealisticProlongedGraphicOrSadistic"];
    const no = ["advertising", "ageAssurance", "datingAndRelationships", "gambling", "healthOrWellnessTopics", "lootBox", "messagingAndChat",
      "parentalControls", "sharedLocation", "socialMedia", "unrestrictedWebAccess", "userGeneratedContent"];
    const attrs = decl.data.attributes;
    // Only the questions this account's API knows about (Apple adds them over time).
    const wanted = Object.fromEntries([...none.map((k) => [k, "NONE"]), ...no.map((k) => [k, false])].filter(([k]) => k in attrs));
    await patch("ageRatingDeclarations", decl.data.id, attrs, wanted, "age rating (all None/No → 4+)");
  }
}

async function versionStep(app, platform, listing) {
  const versions = await get(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=${platform}&limit=5`);
  const editable = ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"];
  const version = versions.data.find((v) => editable.includes(v.attributes.appStoreState));
  if (!version) { console.log(`  no editable ${platform} version (states: ${versions.data.map((v) => v.attributes.appStoreState).join(", ")})`); return; }
  const vs = version.attributes.versionString;
  console.log(` ${platform} ${vs} (${version.attributes.appStoreState})`);

  if (step("text")) {
    await patch("appStoreVersions", version.id, version.attributes, { copyright: listing.copyright }, "copyright");
    const locs = await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
    const loc = locs.data.find((l) => l.attributes.locale === LOCALE);
    await patch("appStoreVersionLocalizations", loc.id, loc.attributes, {
      description: listing.description, keywords: listing.keywords,
      promotionalText: listing.promotionalText, supportUrl: listing.supportUrl,
    }, "description, keywords, promotional text, support URL");
  }

  if (step("review")) {
    const wanted = {
      contactFirstName: keychain("APP_REVIEW_FIRST_NAME"), contactLastName: keychain("APP_REVIEW_LAST_NAME"),
      contactPhone: keychain("APP_REVIEW_PHONE"), contactEmail: keychain("APP_REVIEW_EMAIL"),
      demoAccountRequired: false, notes: listing.reviewNotes[platform],
    };
    const rd = await get(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => ({ data: null }));
    if (rd.data) await patch("appStoreReviewDetails", rd.data.id, rd.data.attributes, wanted, "review contact and notes");
    else {
      console.log("  review contact and notes: created");
      await api("POST", "/v1/appStoreReviewDetails", { data: { type: "appStoreReviewDetails", attributes: wanted,
        relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } });
    }
  }

  if (step("build")) {
    const builds = await get(`/v1/builds?filter[app]=${app.id}&filter[preReleaseVersion.platform]=${platform}` +
      `&filter[preReleaseVersion.version]=${vs}&filter[processingState]=VALID&filter[expired]=false&sort=-uploadedDate&limit=1`);
    const latest = builds.data[0];
    const current = await get(`/v1/appStoreVersions/${version.id}/build`);
    if (!latest) console.log(`  build: no processed ${vs} build yet`);
    else if (current.data?.id === latest.id) console.log(`  build: ${latest.attributes.version} (up to date)`);
    else {
      console.log(`  build: ${latest.attributes.version}${current.data ? ` (was ${current.data.attributes.version})` : ""}`);
      if (latest.attributes.usesNonExemptEncryption == null)
        await api("PATCH", `/v1/builds/${latest.id}`, { data: { type: "builds", id: latest.id, attributes: { usesNonExemptEncryption: false } } });
      await api("PATCH", `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: "builds", id: latest.id } });
    }
  }

  if (step("shots")) {
    const locs = await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
    const loc = locs.data.find((l) => l.attributes.locale === LOCALE);
    for (const device of PLATFORMS[platform]) await screenshotSet(loc.id, device);
  }
}

async function screenshotSet(locId, device) {
  const type = SHOT_TYPES[device];
  const dir = path.join(ROOT, APP.shots[device]);
  if (!fs.existsSync(dir)) { console.log(`  ${device} screenshots: none yet in ${APP.shots[device]}, skipped`); return; }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort().map((f) => {
    const data = fs.readFileSync(path.join(dir, f));
    return { name: f, data, md5: crypto.createHash("md5").update(data).digest("hex") };
  });
  const sets = await get(`/v1/appStoreVersionLocalizations/${locId}/appScreenshotSets?filter[screenshotDisplayType]=${type}`);
  let set = sets.data[0];
  const existing = set ? await getAll(`/v1/appScreenshotSets/${set.id}/appScreenshots`) : [];
  const same = existing.length === files.length && existing.every((s, i) =>
    s.attributes.fileName === files[i].name && s.attributes.sourceFileChecksum === files[i].md5 &&
    s.attributes.assetDeliveryState?.state === "COMPLETE");
  if (same) { console.log(`  ${device} screenshots: up to date`); return; }
  console.log(`  ${device} screenshots: uploading ${files.length}${existing.length ? ` (replacing ${existing.length})` : ""}`);
  for (const s of existing) await api("DELETE", `/v1/appScreenshots/${s.id}`);
  if (!set) set = (await api("POST", "/v1/appScreenshotSets", { data: { type: "appScreenshotSets",
    attributes: { screenshotDisplayType: type },
    relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: locId } } } } })).data;
  for (const f of files) {
    const shot = (await api("POST", "/v1/appScreenshots", { data: { type: "appScreenshots",
      attributes: { fileName: f.name, fileSize: f.data.length },
      relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } } } })).data;
    if (DRY) continue;
    for (const op of shot.attributes.uploadOperations) {
      const r = await fetch(op.url, { method: op.method, body: f.data.subarray(op.offset, op.offset + op.length),
        headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])) });
      if (!r.ok) throw new Error(`uploading ${device}/${f.name}: ${r.status}`);
    }
    await api("PATCH", `/v1/appScreenshots/${shot.id}`, { data: { type: "appScreenshots", id: shot.id,
      attributes: { uploaded: true, sourceFileChecksum: f.md5 } } });
    console.log(`    ${f.name}`);
  }
}

async function pricingStep(app) {
  // Free.
  const sched = await get(`/v1/apps/${app.id}/appPriceSchedule?include=manualPrices`).catch(() => null);
  if (sched?.data && sched.included?.length) console.log("  price: already set");
  else {
    const points = await get(`/v1/apps/${app.id}/appPricePoints?filter[territory]=USA&limit=200`);
    const free = points.data.find((p) => Number(p.attributes.customerPrice) === 0);
    console.log("  price: Free");
    await api("POST", "/v1/appPriceSchedules", {
      data: { type: "appPriceSchedules", relationships: {
        app: { data: { type: "apps", id: app.id } },
        baseTerritory: { data: { type: "territories", id: "USA" } },
        manualPrices: { data: [{ type: "appPrices", id: "${free}" }] } } },
      included: [{ type: "appPrices", id: "${free}", attributes: { startDate: null },
        relationships: { appPricePoint: { data: { type: "appPricePoints", id: free.id } } } }],
    });
  }
  // Every territory but China mainland, and new ones as Apple adds them. China
  // mainland needs a security assessment and an AI-content declaration before
  // review, so neither app is offered there.
  const excluded = new Set(["CHN"]);
  const avail = await get(`/v1/apps/${app.id}/appAvailabilityV2`).catch(() => null);
  if (avail?.data) {
    const rows = await getAll(`/v2/appAvailabilities/${avail.data.id}/territoryAvailabilities?include=territory&limit=200`);
    const off = rows.filter((r) => excluded.has(r.relationships.territory.data.id) && r.attributes.available);
    if (!off.length) console.log("  availability: already set");
    for (const r of off) {
      console.log(`  availability: removing ${r.relationships.territory.data.id}`);
      await api("PATCH", `/v1/territoryAvailabilities/${r.id}`,
        { data: { type: "territoryAvailabilities", id: r.id, attributes: { available: false } } });
    }
  } else {
    const territories = await getAll("/v1/territories?limit=200");
    console.log(`  availability: ${territories.length - excluded.size} territories (not ${[...excluded].join(", ")})`);
    await api("POST", "/v2/appAvailabilities", {
      data: { type: "appAvailabilities", attributes: { availableInNewTerritories: true }, relationships: {
        app: { data: { type: "apps", id: app.id } },
        territoryAvailabilities: { data: territories.map((t) => ({ type: "territoryAvailabilities", id: `\${${t.id}}` })) } } },
      included: territories.map((t) => ({ type: "territoryAvailabilities", id: `\${${t.id}}`,
        attributes: { available: !excluded.has(t.id) }, relationships: { territory: { data: { type: "territories", id: t.id } } } })),
    });
  }
}

// ---------- main ----------

const listing = readListing();
const apps = await get(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
const app = apps.data[0];
if (!app) throw new Error(`no app with bundle ID ${BUNDLE_ID}`);
console.log(`${app.attributes.name} (${app.id})${DRY ? " — dry run" : ""}`);

// Both read pages on third-party sites (ACBL, BBO) that the user is already
// viewing, so "uses third-party content", which states the rights to it.
if (step("rights"))
  await patch("apps", app.id, app.attributes, { contentRightsDeclaration: "USES_THIRD_PARTY_CONTENT" }, "content rights");
if (step("info") || step("age")) await appInfoStep(app, listing);
if (step("pricing")) await pricingStep(app);
for (const platform of Object.keys(PLATFORMS)) await versionStep(app, platform, listing);

console.log(DRY ? "\nDry run: nothing was changed." :
  "\nDone. Still on the website: App Privacy (Data Not Collected), then Add for Review → Submit.");
