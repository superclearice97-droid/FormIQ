# Legal review notes: FormIQ

Engineering notes, not legal advice. Last reviewed 10 October 2026. No one can guarantee a project won't be sued; these steps lower the risk. Fitness, food-health claims and camera body data are higher-risk areas, so a lawyer should read the terms before you publish widely or charge money.

## Risk map

| Area | Status | Keep doing / do next |
|---|---|---|
| Injury claims | Terms: exercise at your own risk, not medical advice, treadmill safety, medical conditions section | Keep safety warnings visible at first run; never make the app change treadmill speed |
| Medical-device / health claims | Wording says general feedback, no diagnosis | Don't say the app "prevents injury", "treats", "detects" a condition or "improves health" as a promise. Food "estimated health risks" must stay clearly general and sourced |
| Health-data laws (FTC Health Breach Notification Rule, Washington My Health My Data Act, similar state laws) | Data stays on device, nothing sold or shared, no accounts | Keep it that way. If you ever add accounts, cloud sync, analytics or ads, redo this review first: those laws apply to apps that collect health data even outside HIPAA |
| Camera and body data (BIPA-style biometric laws) | Pose landmarks only on device; no face recognition or templates | Do not add face identification or body-measurement storage without consent flows and legal review |
| AI photo analysis (user's own key) | Off by default; explicit tap; EXIF/GPS stripped; direct to provider | Keep the key local; note the provider's terms; warn that AI allergen/nutrient output can be wrong. Never present AI output as allergy-safe |
| Food data licences | Open Food Facts ODbL/DbCL, photos CC BY-SA 3.0, attribution in licenses.html | Keep attribution; share-alike applies if you publish a derived database |
| Strava and other integrations | User's own API app | Follow Strava's API Agreement (branding, no AI training on its data, data deletion on request); recheck before any public release |
| Health Connect / Play policies | Permissions declared; policy says limited use | Complete the Health Connect permissions declaration form if you publish on Play; the privacy policy URL must be public |
| Children | 13+; not directed at children | If it becomes popular with teens/kids, consider an age screen; COPPA's amended rule is in force for sites that knowingly collect from under-13s |
| Third-party code | licenses.html; vendor MANIFEST | Re-verify each licence text before each release |
| Android distribution | Signed APK on GitHub Releases | See below |

## Android developer verification

Google is rolling out developer verification for apps installed on certified Android devices outside Google Play: phase one starts 30 September 2026 in Brazil, Indonesia, Singapore and Thailand, with global rollout from 2027. Free "limited distribution" accounts exist for hobbyists sharing with up to 20 devices; wider public sideloading will need a verified developer account. Source: https://developer.android.com/developer-verification

## Before a wide launch

1. Trademark search for "FormIQ" (USPTO, EUIPO, Play Store).
2. Lawyer review of terms.html (limitation of liability and arbitration/governing-law clauses are jurisdiction-sensitive).
3. Keep dated copies of each policy version.
4. Decide whether you will ever charge money: that adds consumer-protection, tax and app-store rules.
