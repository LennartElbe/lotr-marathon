// Google Apps Script backend for the RSVP and snack signup forms.
// Bound to a Google Sheet. RSVPs go to the first tab; snack claims go to a "Snacks" tab;
// favorite character/scene answers go to a "Favorites" tab.

const RSVP_HEADERS = ["Timestamp", "Name", "Attending", "Dietary needs"];
const SNACK_HEADERS = ["Timestamp", "Name", "Item", "Ref", "Meal", "Custom", "Token"];
const MAX_CLAIMS = 3; // per guest name
const FAV_HEADERS = ["Timestamp", "Name", "Favorite character", "Favorite scene", "Ref", "Image ID"];
const UPLOAD_FOLDER = "LOTR Marathon uploads";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
// Keep in sync with MEALS in index.html.
const MEALS = ["Breakfast", "Second Breakfast", "Elevenses", "Luncheon", "Afternoon Tea", "Dinner", "Supper"];

function doPost(e) {
  // The favorites form sends JSON as text/plain (so it can carry an image); everything else is form-encoded.
  const isJson = e.postData && String(e.postData.type).indexOf("text/plain") === 0;
  const p = isJson ? JSON.parse(e.postData.contents) : e.parameter;

  // Honeypot: bots fill the hidden field, humans don't.
  if (p.website) return text("ok");

  if (p.type === "snack") return claimSnack(p);
  if (p.type === "release") return releaseSnack(p);
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
// The Token column is the claimer's secret for releasing a claim and is never sent out.
function doGet(e) {
  if (e.parameter.action === "claims") {
    const rows = snackSheet().getDataRange().getValues().slice(1);
    const claims = rows.map((r) => ({ name: r[1], item: r[2], ref: r[3], meal: r[4], custom: r[5] }));
    return ContentService.createTextOutput(JSON.stringify({ claims }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (e.parameter.action === "favorites") {
    const rows = favSheet().getDataRange().getValues().slice(1);
    const favorites = rows.map((r) => ({ name: r[1], character: r[2], scene: r[3], ref: r[4], image: r[5] }));
    return ContentService.createTextOutput(JSON.stringify({ favorites }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return text("ok");
}

// One answer per name (case-insensitive): resubmitting with the same name replaces the old answer.
// An optional image is stored in Drive; resubmitting without one keeps the earlier picture.
function saveFavorite(p) {
  const name = clean(p.name, 100);
  const character = clean(p.character, 60);
  const scene = clean(p.scene, 150);
  if (!name || !character || !scene) return text("invalid");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = favSheet();
    const values = sheet.getDataRange().getValues();
    const names = values.map((r) => String(r[1]).toLowerCase());
    const existing = names.indexOf(name.toLowerCase(), 1); // index 0 is the header row
    const oldImage = existing > 0 ? String(values[existing][5] || "") : "";

    let imageId = oldImage;
    if (p.image) {
      const saved = saveImage(String(p.image));
      if (!saved) return text("badimage");
      imageId = saved;
      if (oldImage) {
        try { DriveApp.getFileById(oldImage).setTrashed(true); } catch (err) {}
      }
    }

    const row = [new Date(), name, character, scene, clean(p.ref, 40), imageId];
    if (existing > 0) sheet.getRange(existing + 1, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    return text("ok");
  } finally {
    lock.releaseLock();
  }
}

// Validates by file signature (not the client's claimed type), stores in a Drive folder, returns the file id.
function saveImage(base64) {
  let bytes;
  try { bytes = Utilities.base64Decode(base64); } catch (err) { return null; }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;

  const type = sniffImage(bytes);
  if (!type) return null;

  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" }[type];
  const blob = Utilities.newBlob(bytes, type, "favorite-" + Date.now() + "." + ext);
  const file = uploadFolder().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getId();
}

function sniffImage(b) {
  const x = (i) => b[i] & 255; // Apps Script bytes are signed
  if (x(0) === 0xff && x(1) === 0xd8 && x(2) === 0xff) return "image/jpeg";
  if (x(0) === 0x89 && x(1) === 0x50 && x(2) === 0x4e && x(3) === 0x47) return "image/png";
  if (x(0) === 0x47 && x(1) === 0x49 && x(2) === 0x46 && x(3) === 0x38) return "image/gif";
  if (x(0) === 0x52 && x(1) === 0x49 && x(2) === 0x46 && x(3) === 0x46 &&
      x(8) === 0x57 && x(9) === 0x45 && x(10) === 0x42 && x(11) === 0x50) return "image/webp";
  return null;
}

function uploadFolder() {
  const found = DriveApp.getFoldersByName(UPLOAD_FOLDER);
  return found.hasNext() ? found.next() : DriveApp.createFolder(UPLOAD_FOLDER);
}

// True if the most recent RSVP row for this name says Yes.
function rsvpedYes(name) {
  const rows = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].getDataRange().getValues();
  const want = name.toLowerCase();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][1]).trim().toLowerCase() === want) return rows[i][2] === "Yes";
  }
  return false;
}

// First claim for an item wins. The lock stops two simultaneous submissions
// from both claiming the same item. Each name may hold up to MAX_CLAIMS and must have RSVPed Yes.
function claimSnack(p) {
  const item = String(p.item || "");
  if (!/^[a-z0-9-]{1,40}$/.test(item)) return text("invalid");
  const name = clean(p.name, 100);
  const token = String(p.token || "");
  if (!name || !/^[a-z0-9]{8,40}$/.test(token)) return text("invalid");
  if (!rsvpedYes(name)) return text("norsvp");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = snackSheet();
    const rows = sheet.getDataRange().getValues().slice(1);
    if (rows.some((r) => r[2] === item)) return text("taken");
    const mine = rows.filter((r) => String(r[1]).trim().toLowerCase() === name.toLowerCase()).length;
    if (mine >= MAX_CLAIMS) return text("limit");

    const meal = MEALS.indexOf(p.meal) >= 0 ? p.meal : "Any";

    // Free-text claims ("other-<ref>") carry whatever the guest typed; catalog items never do.
    const isOther = item.indexOf("other-") === 0;
    const custom = isOther ? clean(p.custom, 80) : "";
    if (isOther && !custom) return text("invalid");

    sheet.appendRow([new Date(), name, item, clean(p.ref, 40), meal, custom, token]);
    return text("ok");
  } finally {
    lock.releaseLock();
  }
}

// Deletes the claim whose ref and secret token both match, freeing the item.
function releaseSnack(p) {
  const ref = String(p.ref || "");
  const token = String(p.token || "");
  if (!ref || !token) return text("invalid");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = snackSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][3]) === ref && String(rows[i][6]) === token) {
        sheet.deleteRow(i + 1);
        return text("ok");
      }
    }
    return text("notfound");
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
    if (sheet.getRange(1, 7).getValue() === "") sheet.getRange(1, 7).setValue("Token");
  }
  return sheet;
}

function favSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Favorites");
  if (!sheet) {
    sheet = ss.insertSheet("Favorites");
    sheet.appendRow(FAV_HEADERS);
  } else if (sheet.getRange(1, 6).getValue() === "") {
    sheet.getRange(1, 6).setValue("Image ID"); // tab created before images existed
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
