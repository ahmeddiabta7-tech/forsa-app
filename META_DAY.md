# Meta day — switching on Facebook publishing for Forsa's AI media buyer

Everything is built, tested and already deployed (switched off). This is the only part left. About 30 minutes.

## Ahmed (on a laptop, logged in to his own personal Facebook)
1. **developers.facebook.com** → *My Apps* → *Create app*.
   - App name: **Forsa** · contact email: Gmail for now (change to the domain email later).
   - Use case: **Create & manage ads with Marketing API**.
   - Business portfolio: **connect later / skip** if offered (if it is required, stop and tell Claude).
2. In the app: add the **Facebook Login for Business** product (it may already be added by the use case).
   - Settings → **Valid OAuth Redirect URIs**:
     `https://zkmbifplbpvwlvzbpnqc.supabase.co/functions/v1/meta-ads/callback`
   - If it asks to create a **Configuration**: choose *User access token*, add the permissions
     `ads_management, ads_read, pages_show_list, pages_read_engagement, pages_manage_ads, business_management`,
     save, and copy the **Configuration ID** (not secret).
3. **App settings → Basic**
   - Privacy Policy URL: `https://ahmeddiabta7-tech.github.io/forsa-app/#/privacy`
   - Terms of Service URL: `https://ahmeddiabta7-tech.github.io/forsa-app/#/terms`
   - User data deletion → Data deletion instructions URL: `https://ahmeddiabta7-tech.github.io/forsa-app/#/data-deletion`
   - Category: Business · App icon: Forsa logo. **Save**.
   - Copy the **App ID** → send it to Claude (not secret).
4. **Supabase → Edge Functions → Secrets** (Ahmed pastes them himself — never in the chat):
   - `META_APP_SECRET` = the App Secret (App settings → Basic → *Show*).
   - `META_APP_ID` = the App ID.
   - `META_LOGIN_CONFIG_ID` = the Configuration ID (only if step 2 made one).
5. Make sure your Facebook has an **ad account in EGP with a payment method** (Meta Ads Manager → Billing).

## Claude
6. Check the `meta-ads` function: **Verify JWT = OFF** (Facebook's login redirect has no Forsa login).
7. Put the App ID in `src/config.js` (`META_APP_ID`), test, publish the app.
8. Run `supabase/meta_day.sql` (daily AI review at 10:00 Cairo time) and check the job.
9. Live test with Ahmed: Services → Media buying → *Connect Facebook* → choose page + EGP ad account →
   make a small plan (e.g. EGP 50/day, 1 day) → approve → *Publish my ad now* → check it in Ads Manager →
   *Update results now* → stop it.
   - If Meta refuses because the app's business isn't verified: switch to the backup (Forsa requests partner access
     to the seller's page; the seller taps Approve once) — see REQUESTS.md.

## Pilot customers (testers, up to 50)
10. App dashboard → **App roles → Roles → Add people → Testers** → their Facebook name/profile.
11. Each tester accepts once: Facebook → *Settings & privacy → Settings → Apps and websites → Requests → Accept*
    (or the invite notification).
12. They open Forsa → Services → Media buying → *Connect Facebook*. Done.

## Later (official launch)
- Domain + Forsa page + Meta Business account with the domain email; connect the app to it.
- Business verification (commercial register + tax card) and App Review for `ads_management`, `ads_read`,
  `pages_manage_ads`, `pages_read_engagement`, `pages_show_list`, `business_management` (screen recording of the flow).
- Then every Forsa seller can connect, not only testers.
