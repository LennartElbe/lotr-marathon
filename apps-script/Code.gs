// Google Apps Script backend for the RSVP and snack signup forms.
// Bound to a Google Sheet. RSVPs go to the first tab; snack claims go to a "Snacks" tab;
// favorite character/scene answers go to a "Favorites" tab.

const RSVP_HEADERS = ["Timestamp", "Name", "Attending", "Dietary needs"];
const SNACK_HEADERS = ["Timestamp", "Name", "Item", "Ref", "Meal", "Custom"];
const FAV_HEADERS = ["Timestamp", "Name", "Favorite character", "Favorite scene", "Ref"];
// Keep in sync with MEALS in index.html.
const MEALS = ["Breakfast", "Second Breakfast", "Elevenses", "Luncheon", "Afternoon Tea", "Dinner", "Supper"];

function doPost(e) {
  const p = e.parameter;

  // Honeypot: bots fill the hidden field, humans don't.
  if (p.website) return text("ok");

  if (p.type === "snack") return claimSnack(p);
  if (p.type === "fav") return saveFavorite(p);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(RSVP_HEADERS);

  sheet.appendRow([
    new Date(),
    clean(p.name, 100),
    p.attending === "Yes" ? "Yes" : "No",
    clean(p.dietary, 500),
  ]);

  return text("ok");
}

// GET ?action=claims returns every snack claim as JSON so the page can gray out taken items.
function doGet(e) {
  if (e.parameter.action === "claims") {
    const rows = snackSheet().getDataRange().getValues().slice(1);
    const claims = rows.map((r) => ({ name: r[1], item: r[2], ref: r[3], meal: r[4], custom: r[5] }));
    return ContentService.createTextOutput(JSON.stringify({ claims }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (e.parameter.action === "favorites") {
    const rows = favSheet().getDataRange().getValues().slice(1);
    const favorites = rows.map((r) => ({ name: r[1], character: r[2], scene: r[3], ref: r[4] }));
    return ContentService.createTextOutput(JSON.stringify({ favorites }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return text("ok");
}

// One answer per name (case-insensitive): resubmitting with the same name replaces the old answer.
function saveFavorite(p) {
  const name = clean(p.name, 100);
  const character = clean(p.character, 60);
  const scene = clean(p.scene, 150);
  if (!name || !character || !scene) return text("invalid");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = favSheet();
    const row = [new Date(), name, character, scene, clean(p.ref, 40)];
    const names = sheet.getDataRange().getValues().map((r) => String(r[1]).toLowerCase());
    const existing = names.indexOf(name.toLowerCase(), 1); // index 0 is the header row
    if (existing > 0) sheet.getRange(existing + 1, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    return text("ok");
  } finally {
    lock.releaseLock();
  }
}

// First claim for an item wins. The lock stops two simultaneous submissions
// from both claiming the same item.
function claimSnack(p) {
  const item = String(p.item || "");
  if (!/^[a-z0-9-]{1,40}$/.test(item)) return text("invalid");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = snackSheet();
    const taken = sheet.getDataRange().getValues().slice(1).some((r) => r[2] === item);
    if (taken) return text("taken");

    const meal = MEALS.indexOf(p.meal) >= 0 ? p.meal : "Any";

    // Free-text claims ("other-<ref>") carry whatever the guest typed; catalog items never do.
    const isOther = item.indexOf("other-") === 0;
    const custom = isOther ? clean(p.custom, 80) : "";
    if (isOther && !custom) return text("invalid");

    sheet.appendRow([new Date(), clean(p.name, 100), item, clean(p.ref, 40), meal, custom]);
    return text("ok");
  } finally {
    lock.releaseLock();
  }
}

function snackSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Snacks");
  if (!sheet) {
    sheet = ss.insertSheet("Snacks");
    sheet.appendRow(SNACK_HEADERS);
  } else {
    // Tabs created before these columns existed get their headers filled in.
    if (sheet.getRange(1, 5).getValue() === "") sheet.getRange(1, 5).setValue("Meal");
    if (sheet.getRange(1, 6).getValue() === "") sheet.getRange(1, 6).setValue("Custom");
  }
  return sheet;
}

function favSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Favorites");
  if (!sheet) {
    sheet = ss.insertSheet("Favorites");
    sheet.appendRow(FAV_HEADERS);
  }
  return sheet;
}

function text(s) {
  return ContentService.createTextOutput(s);
}

// Prevent spreadsheet formula injection (cells starting with = + - @) and cap length.
function clean(value, max) {
  const s = String(value || "").trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
