// Google Apps Script backend for the RSVP form.
// Bound to a Google Sheet; appends one row per submission.

const HEADERS = ["Timestamp", "Name", "Attending", "Dietary needs"];

function doPost(e) {
  const p = e.parameter;

  // Honeypot: bots fill the hidden field, humans don't.
  if (p.website) return ContentService.createTextOutput("ok");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);

  sheet.appendRow([
    new Date(),
    clean(p.name),
    p.attending === "Yes" ? "Yes" : "No",
    clean(p.dietary),
  ]);

  return ContentService.createTextOutput("ok");
}

// Prevent spreadsheet formula injection (cells starting with = + - @) and cap length.
function clean(value) {
  const s = String(value || "").trim().slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
