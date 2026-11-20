# Meow Meow Club adoption records

A private, sign-in-only website for recording cat adoptions and issuing numbered receipts (PDF or image), with photos, search and a monthly CSV export for the admin. Intended address: **records.meowmeowclub.org**.

- **Start here: [docs/SETUP.md](docs/SETUP.md)** (about an hour, no coding).
- `supabase/schema.sql` builds the database, receipt numbering, private photo store and access rules. `supabase/add-staff.sql` gives people access.
- `config.js` takes your Supabase address and public key.
- `docs/privacy-notice-draft.md` is a draft notice to adapt (not legal advice).

How it fits together: the page (`index.html`, `app.js`, `styles.css`) runs in the browser and signs volunteers in with Supabase. Records and photos stay in Supabase behind row-level security, so only people on the staff list can read them, and only the admin can delete. The site files themselves hold no records.

Receipt numbers look like `MMC-2026-0001` and are issued by the database, so two volunteers can never be given the same number.
