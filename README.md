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

## Snack signup

The snack catalog (`CATALOG` in `index.html`) is grouped into savory snacks, sweet snacks, savory drinks, sweet drinks, and caffeine. Claims are stored in a `Snacks` tab that the script creates automatically. The page reads claims back, grays out taken items, and flags any category with no claims as "needed". The server rejects a second claim for the same item, so simultaneous submissions can't double up.

Guests also pick which hobbit meal their item is for (`MEALS` in `index.html`, mirrored in `Code.gs`), saved in a `Meal` column. Breakfast is 8:30 AM and Second Breakfast 9:30 AM; the rest follow the traditional schedule.

After changing `apps-script/Code.gs`, paste it into the Apps Script editor and use **Deploy → Manage deployments → Edit → New version**. The web app URL stays the same.

Keep item ids in `CATALOG` stable once guests have claimed things, since the sheet stores the id.

## Still to fill in

- Event address in `index.html` (marked `[ADDRESS TBD]`).
