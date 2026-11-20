# Setting up records.meowmeowclub.org

This guide takes you from nothing to a working, private adoption-records site at **records.meowmeowclub.org**. Allow about an hour, most of it waiting for the domain to update. You do not need to write any code; you will copy, paste and click.

**What you are setting up**

- **Supabase** keeps the records, the photos and the logins. It is the "back room" and is not public.
- **GitHub Pages** shows the website. It is free, and it only holds the page itself, never the records.
- **Your domain** (meowmeowclub.org, at Namecheap or Wix) points the name `records` at that page.

Only people you add can see anything. Volunteers can add, view and edit records. Only you (the admin) can delete records or export the CSV.

---

## Part 1. Create the database (Supabase)

1. Go to **supabase.com** and create an account (use the club's email or your own; you will be the owner). Turn on two-step verification for this account afterwards.
2. Choose **New project**. Name it `meowmeowclub-records`. Set a long database password and save it in your password manager. For **Region**, choose **Southeast Asia (Singapore)** so the data stays in Singapore. Create the project and wait a minute or two.
3. In the left menu open **SQL Editor** and choose **New query**. Open the file `supabase/schema.sql` from this folder, copy everything in it, paste it into the editor and press **Run**. You should see "Success". This builds the tables, the receipt numbering, the private photo store and the access rules. It is safe to run a second time.
4. Turn off public sign-ups, so strangers cannot create accounts: **Authentication, then Sign In / Providers** (on some versions this sits under Settings), and switch **off** "Allow new users to sign up". Save.
5. Set the site address: **Authentication, then URL Configuration**. Set **Site URL** to `https://records.meowmeowclub.org`. Under **Redirect URLs** add `https://records.meowmeowclub.org/**`. Save. (This makes the "Forgot password" link land on your site.)

## Part 2. Add yourself and your volunteer

1. **Authentication, then Users, then Add user, then Create new user.** Enter your email and a strong password, and **tick "Auto Confirm User"**. Create it. Do the same for your volunteer.
2. Open **SQL Editor** again, **New query**, and open `supabase/add-staff.sql`. Replace the placeholders (your email, the volunteer's name and email) and run it. The first block makes you the admin; the second makes someone a volunteer. A user who is not on this list can sign in but sees "No access yet" and no records.
3. To add another volunteer later, repeat steps 1 and 2. To remove someone, run the "take access away" line at the bottom of the same file.

## Part 3. Connect the page to the database

1. In Supabase open **Project Settings, then API** (or **API Keys**). Copy the **Project URL** and the **anon / publishable** key.
2. Open `config.js` in this folder in any text editor (Notepad is fine). Paste the two values between the quotation marks, keeping the quotation marks:

   ```
   supabaseUrl: "https://abcdefgh.supabase.co",
   supabaseKey: "eyJ... or sb_publishable_...",
   ```
3. Optional: if the club has a privacy page on its website, put its address in `privacyUrl` (a draft notice to adapt is in `docs/privacy-notice-draft.md`).

The anon/publishable key is meant to be visible in a website; the database rules and the sign-in are what protect the records. **Never paste the "service_role" or "secret" key anywhere in this folder.**

## Part 4. Publish the page (GitHub Pages)

1. On **github.com** create a new repository called `meowmeowclub-records`. Make it **Public** (free Pages need this; see the note at the end about what is and is not public).
2. Choose **Add file, then Upload files**, and drag in **everything inside this folder** (not the folder itself): `index.html`, `app.js`, `styles.css`, `config.js`, `CNAME`, `.nojekyll`, and the `assets`, `vendor`, `supabase` and `docs` folders. Commit.
3. Open the repository's **Settings, then Pages**. Under **Build and deployment** choose **Deploy from a branch**, branch **main**, folder **/ (root)**, and Save.
4. Under **Custom domain** it should already show `records.meowmeowclub.org` (from the `CNAME` file). If not, type it and Save. Leave **Enforce HTTPS** ticked once it becomes available (it can take up to an hour after Part 5).

## Part 5. Point your domain at it

You need to add one DNS record. Where you add it depends on who currently controls your domain's DNS.

**Find out first.** Log in to **Namecheap, Domain List, Manage** next to meowmeowclub.org, and look at **Nameservers**. If it says **Namecheap BasicDNS** (or similar), add the record at Namecheap (option A). If it lists Wix nameservers (they contain "wixdns"), add it at Wix (option B).

**The record to add**

| Type | Host / Name | Value / Points to |
|---|---|---|
| CNAME | `records` | `chungchung-coding.github.io` |

(Use your own GitHub username in place of `chungchung-coding` if the repository lives under a different account. The value is always `<your-github-username>.github.io`, with nothing after it.)

- **Option A, Namecheap:** Domain List, Manage, **Advanced DNS**, **Add New Record**. Type CNAME, Host `records`, Value as above, Automatic TTL. Save.
- **Option B, Wix:** Domains, the three dots next to meowmeowclub.org, **Manage DNS records**, add a **CNAME** with Host `records` and Value as above. Save.

This does not touch your main website at www.meowmeowclub.org. Wait 10 to 60 minutes, then open `https://records.meowmeowclub.org`. If GitHub's Pages screen shows a DNS warning, wait a little and press **Check again**; then tick **Enforce HTTPS**.

## Part 6. Test it before real use

Please run through this once, with the volunteer's account as well as your own.

1. Open the site on your phone. You should see only the sign-in screen, with no records.
2. Sign in as the volunteer. Add a test adoption with a photo and tick both boxes. Check the receipt number is `MMC-2026-0001`, and that the PDF and image save correctly.
3. Edit the test record. Confirm the volunteer does **not** see a Delete button or Export CSV.
4. Sign in as yourself (admin). Confirm you see Delete and Export CSV, and that the CSV opens in Excel or Numbers.
5. Delete the test record. (Receipt numbers are never reused, so your first real receipt will be `-0002`. If that bothers you, in Supabase SQL Editor run `delete from public.receipt_counters;` once, before real use, while there are no records.)
6. Try "Forgot password" with the volunteer's email and confirm the email arrives and the link works.

## Part 7. Keeping it safe and running

- **Back up monthly.** The free Supabase plan does not keep downloadable backups for you. As admin, press **Export CSV** once a month and save it somewhere private (the club's own Drive or a locked folder). The CSV holds the details but not the photos.
- **The free plan pauses quiet projects.** Supabase pauses free projects that get very little use over a week, and sends a warning email first. A paused project is not lost: open the Supabase dashboard and choose **Resume project**. If the club will sometimes go quiet for weeks, either resume it when needed or consider the paid plan, which never pauses.
- **Password emails.** Supabase's built-in email sender is limited to a few messages an hour, which is plenty for a small club. If a volunteer is locked out and the email does not arrive, you can delete their user and add them again (Part 2, then re-run their line in `add-staff.sql`).
- **Turn on two-step verification** for your Supabase, GitHub and Namecheap/Wix accounts. Whoever controls these controls the data.
- **When a volunteer leaves,** remove their access (Part 2, step 3) and delete their user under Authentication, Users.
- **Shared phones.** Ask volunteers to sign out on any device that is not their own.

## What is public and what is not

The GitHub repository and the website's files (the page, the logo, the code) are public; they contain no records. Every record, photo and name lives in Supabase and is only released to a signed-in person on your staff list. Anyone can open the sign-in page, but cannot get past it.

## Personal data (Singapore PDPA)

Adopters' names, phone numbers, emails and addresses are personal data. The form asks the volunteer to confirm that the adopter has been told how their details are used and consents; the date is stored with the record. Please publish a short privacy notice (a draft is in `docs/privacy-notice-draft.md`), name a person responsible for data protection, keep access to the people who need it, and delete records you no longer need. This is general guidance and not legal advice; the PDPC's website has current guidance for organisations.

## If something goes wrong

| What you see | What to check |
|---|---|
| "This site is not connected to its database yet" | `config.js` still has the placeholder text, or the file was not uploaded after editing. |
| "That email or password is not right" | Password typed wrongly, or the user was not created with Auto Confirm ticked. |
| "No access yet" after signing in | The `add-staff.sql` line has not been run for that email, or the email was spelt differently. |
| Saving fails with "not allowed" | The `schema.sql` script was not run in full. Run it again. |
| The site shows a GitHub 404 page | Pages is not switched on, or the files were uploaded inside a folder instead of at the top level. |
| Browser says "not secure" | Wait for the DNS to settle, then tick **Enforce HTTPS** in GitHub Pages. |
