// Google Apps Script backend for the RSVP and snack signup forms.
// Bound to a Google Sheet. RSVPs go to the first tab; snack claims go to a "Snacks" tab.

const RSVP_HEADERS = ["Timestamp", "Name", "Attending", "Dietary needs"];
const SNACK_HEADERS = ["Timestamp", "Name", "Item", "Ref", "Meal"];
// Keep in sync with MEALS in index.html.
const MEALS = ["Breakfast", "Second Breakfast", "Elevenses", "Luncheon", "Afternoon Tea", "Dinner", "Supper"];

function doPost(e) {
  const p = e.parameter;

  // Honeypot: bots fill the hidden field, humans don't.
  if (p.website) return text("ok");

  if (p.type === "snack") return claimSnack(p);

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
    const claims = rows.map((r) => ({ name: r[1], item: r[2], ref: r[3], meal: r[4] }));
    return ContentService.createTextOutput(JSON.stringify({ claims }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return text("ok");
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
    sheet.appendRow([new Date(), clean(p.name, 100), item, clean(p.ref, 40), meal]);
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
  } else if (sheet.getRange(1, 5).getValue() === "") {
    sheet.getRange(1, 5).setValue("Meal"); // tab created before the Meal column existed
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
