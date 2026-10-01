# LOTR Marathon RSVP

Static site on GitHub Pages: https://lennartelbe.github.io/lotr-marathon/

## Connect the RSVP form to a Google Sheet

1. Create a new Google Sheet (any name, e.g. "LOTR RSVPs").
2. In the sheet: **Extensions → Apps Script**. Replace the contents of `Code.gs` with `apps-script/Code.gs` from this repo.
3. **Deploy → New deployment → type: Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Authorize when prompted, then copy the **Web app URL**.
5. In `index.html`, set `ENDPOINT` to that URL, commit, and push.

Responses appear as rows in the first sheet tab. If you edit `Code.gs` later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

## Still to fill in

- Event date, time, and address in `index.html` (marked `[... TBD]`).
